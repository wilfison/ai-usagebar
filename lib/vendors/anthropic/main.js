import {readCreds, planLabel, needsRefresh, refresh, writeBack, TOKEN_URL} from '../../oauth/anthropic.js';
import {sanitizeUntrusted} from '../../format.js';
import {withMutex, runFetch, recordHttpError, errorResult as thrownError, CACHE_TTL_MS, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1';
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
// The usage endpoint 429s hard without a Claude Code User-Agent. The grants
// block also needs the CLI surface at >= 2.1.280: the old form is refused as
// `ineligible_reason: "surface"`, older versions as "cli_version".
export const USAGE_USER_AGENT = 'claude-cli/2.1.319 (external, cli)';
export {CACHE_TTL_MS};

// Refreshes an expiring token; a result means the fetch stops there.
async function authorize({cache, http, credsPath, oauth, endpoints, now, signal, errorResult}) {
    let authFailed = false;
    let authTransient = false;
    let authStatus = null;
    if (needsRefresh(Math.trunc(oauth.expiresAtMs / 1000), Math.trunc(now.getTime() / 1000))) {
        const rr = await refresh(http, oauth.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        if (rr.ok) {
            const rotated = Boolean(rr.refreshToken);
            oauth.accessToken = rr.accessToken;
            if (rotated)
                oauth.refreshToken = rr.refreshToken;
            oauth.expiresAtMs = now.getTime() + rr.expiresIn * 1000;
            const wb = await writeBack(credsPath, oauth);
            // Losing a rotated refresh token logs the user out on the next run;
            // a new access token alone is best-effort.
            if (!wb.ok && rotated) {
                cache.writeLastError(0, `refreshed token could not be saved (${wb.message}); ` +
                    'the rotated refresh token is lost; re-run `claude`');
                authFailed = true;
            }
        } else if (rr.kind === 'http') {
            recordHttpError(cache, rr.status, rr.body);
            authStatus = rr.status;
            authFailed = true;
        } else if (rr.kind === 'transport') {
            authFailed = true;
            authTransient = true;
        } else { // schema
            cache.writeLastError(0, rr.message);
            authFailed = true;
        }
    }

    if (authFailed) {
        return authTransient
            ? {ok: false, kind: 'loading'}
            : errorResult('token refresh failed; run `claude` to re-authenticate', authStatus);
    }

    // A blank token is a signed-out credentials file, not a rate limit: sent as
    // `Bearer `, its 429 would arm a backoff that outlives the next login.
    if (oauth.accessToken.trim() === '')
        return errorResult('no access token; run `claude` to log in');
    return null;
}

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let oauth;
    try {
        ({oauth} = await readCreds(credsPath));
    } catch (e) {
        return thrownError(e);
    }
    const plan = sanitizeUntrusted(planLabel(oauth), 64);
    // The plan comes from the credentials, not the response, so it is known
    // even when usage is not, and re-applied to a cached snapshot.
    const knownPlan = plan && !plan.startsWith('Unknown') ? {plan} : {};
    const errorResult = (message, status) => ({ok: false, kind: 'error', message, ...(status ? {status} : {}), ...knownPlan});

    return runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: bytes => ({...parseCacheJson(bytes), plan}),
        // Under a 429 backoff runFetch never gets here: no token refresh either.
        authorize: () => authorize({cache, http, credsPath, oauth, endpoints, now, signal, errorResult}),
        request: () => http({
            method: 'GET',
            url: endpoints.usage,
            headers: {
                Authorization: `Bearer ${oauth.accessToken}`,
                'anthropic-beta': USAGE_BETA_HEADER,
                'User-Agent': USAGE_USER_AGENT,
                'Content-Type': 'application/json',
            },
            timeoutMs: HTTP_TIMEOUT_MS,
            cancellable: signal,
        }),
        parse: res => parseUsage(res.bodyBytes, plan),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `usage request failed (HTTP ${status})`,
        errorExtras: knownPlan,
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'anthropic', () => doFetch(deps));
}

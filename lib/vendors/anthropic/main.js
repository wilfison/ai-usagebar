import {readCreds, planLabel, needsRefresh, refresh, writeBack, TOKEN_URL} from '../../oauth/anthropic.js';
import {sanitizeUntrusted} from '../../format.js';
import {withMutex, runFetch, settleRefresh, errorResult, redactedRun, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1';
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
// The usage endpoint 429s hard without a Claude Code User-Agent. The grants
// block also needs the CLI surface at >= 2.1.280: the old form is refused as
// `ineligible_reason: "surface"`, older versions as "cli_version".
export const USAGE_USER_AGENT = 'claude-cli/2.1.319 (external, cli)';
// Refreshes an expiring token; a result means the fetch stops there.
async function authorize({cache, http, credsPath, oauth, secrets, endpoints, now, signal, knownPlan}) {
    if (needsRefresh(Math.trunc(oauth.expiresAtMs / 1000), Math.trunc(now.getTime() / 1000))) {
        const rr = await refresh(http, oauth.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        const failure = await settleRefresh(rr, cache, {
            loginCommand: 'claude',
            apply: async () => {
                const rotated = Boolean(rr.refreshToken);
                secrets.push(rr.accessToken, rr.refreshToken);
                oauth.accessToken = rr.accessToken;
                if (rotated)
                    oauth.refreshToken = rr.refreshToken;
                oauth.expiresAtMs = now.getTime() + rr.expiresIn * 1000;
                return {rotated, saved: await writeBack(credsPath, oauth)};
            },
        });
        if (failure)
            return failure.kind === 'error' ? {...failure, ...knownPlan} : failure;
    }

    // A blank token is a signed-out credentials file, not a rate limit: sent as
    // `Bearer `, its 429 would arm a backoff that outlives the next login.
    if (oauth.accessToken.trim() === '')
        return {ok: false, kind: 'error', message: 'no access token; run `claude` to log in', ...knownPlan};
    return null;
}

async function doFetch(deps) {
    const {http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let oauth;
    try {
        ({oauth} = await readCreds(credsPath));
    } catch (e) {
        return errorResult(e);
    }
    const plan = sanitizeUntrusted(planLabel(oauth), 64);
    // The plan comes from the credentials, not the response, so it is known
    // even when usage is not, and re-applied to a cached snapshot.
    const knownPlan = plan && !plan.startsWith('Unknown') ? {plan} : {};

    const secrets = [oauth.accessToken, oauth.refreshToken];
    return redactedRun(secrets, deps.cache, cache => runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: bytes => ({...parseCacheJson(bytes), plan}),
        // Under a 429 backoff runFetch never gets here: no token refresh either.
        authorize: () => authorize({cache, http, credsPath, oauth, secrets, endpoints, now, signal, knownPlan}),
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
    }));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'anthropic', () => doFetch(deps));
}

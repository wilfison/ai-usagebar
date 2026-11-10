import {readCreds, planLabel, needsRefresh, refresh, writeBack, TOKEN_URL} from '../../oauth/anthropic.js';
import {sanitizeUntrusted} from '../../format.js';
import {withMutex, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1';
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
// The usage endpoint 429s hard without a Claude Code User-Agent. The grants
// block also needs the CLI surface at >= 2.1.280: the old form is refused as
// `ineligible_reason: "surface"`, older versions as "cli_version".
export const USAGE_USER_AGENT = 'claude-cli/2.1.319 (external, cli)';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let oauth;
    try {
        ({oauth} = await readCreds(credsPath));
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const plan = sanitizeUntrusted(planLabel(oauth), 64);
    // The plan comes from the credentials, not the response, so it is re-applied.
    const parseCached = (b) => ({...parseCacheJson(b), plan});
    const staleOr = (original) => staleResult(cache, parseCached, original);
    // The plan comes from the credentials, so it is known even when usage is not.
    const knownPlan = plan && !plan.startsWith('Unknown') ? {plan} : {};
    const errorResult = (message, status) => ({ok: false, kind: 'error', message, ...(status ? {status} : {}), ...knownPlan});

    const fresh = await cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseCached(fresh),
                stale: false,
                lastError: null,
                cacheAgeMs: await cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache (shouldn't happen: we only cache parseable
            // bodies). Fall through to a live fetch.
        }
    }

    // Under a 429 backoff no request is made at all, token refresh included.
    const backoffUntil = await underBackoff(cache, now);
    if (backoffUntil !== null)
        return backoffResult(cache, parseCached, backoffUntil, now);

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
        return staleOr(authTransient
            ? {ok: false, kind: 'loading'}
            : errorResult('token refresh failed; run `claude` to re-authenticate', authStatus));
    }

    const res = await http({
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
    });

    // Transport/timeout/cancelled → silent stale fall-back (no .last_error).
    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;

    // Success: parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes, plan);
        } catch (e) {
            // Schema drift: a 2xx body we can't parse. Never cached.
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr(errorResult(msg));
        }
        cache.writePayload(snapshotToCacheJson(snapshot)); // clears .stale/.last_error
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    return staleOr({...recordHttpError(cache, status, body, `usage request failed (HTTP ${status})`), ...knownPlan});
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'anthropic', () => doFetch(deps));
}

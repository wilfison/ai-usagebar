import {
    readAuth, expiresAtSecs, planType, needsRefresh, refresh, applyRefresh, writeBack, TOKEN_URL,
} from '../../oauth/openai.js';
import {withMutex, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseUsage, parseResetCredits, mergeResetCredits, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const USER_AGENT = 'codex-cli';

export function resetCreditsUrl(usageUrl) {
    return usageUrl.replace(/\/usage$/u, '/rate-limit-reset-credits');
}
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

// Optional detail: its failure never reaches the user, and its body is
// discarded so an account-identifying error never lands in a log.
async function withResetDetails(snapshot, http, url, headers, signal) {
    if (snapshot.resetCredits.available === 0)
        return snapshot;
    const res = await http({method: 'GET', url, headers, timeoutMs: HTTP_TIMEOUT_MS, cancellable: signal});
    if (res.error || res.status < 200 || res.status >= 300)
        return snapshot;
    try {
        return mergeResetCredits(snapshot, parseResetCredits(res.bodyBytes));
    } catch (_) {
        return snapshot;
    }
}

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let auth;
    try {
        auth = await readAuth(credsPath);
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const planHint = planType(auth.tokens);
    const parseCached = parseCacheJson;
    const staleOr = (original) => staleResult(cache, parseCached, original);

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
            // Corrupt fresh cache: fall through to a live fetch.
        }
    }

    // Under a 429 backoff no request is made at all, token refresh included.
    const backoffUntil = await underBackoff(cache, now);
    if (backoffUntil !== null)
        return backoffResult(cache, parseCached, backoffUntil, now);

    let authFailed = false;
    let authTransient = false;
    let authStatus = null;
    const nowSecs = Math.trunc(now.getTime() / 1000);
    // An empty refresh token (signed out, or a flow without one) is never
    // POSTed: the token endpoint would 400 and record an auth error.
    const haveRefresh = (auth.tokens.refreshToken ?? '').trim() !== '';
    if (haveRefresh && needsRefresh(expiresAtSecs(auth.tokens), nowSecs)) {
        const rr = await refresh(http, auth.tokens.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        if (rr.ok) {
            const {rotated} = applyRefresh(auth.tokens, rr, nowSecs);
            const wb = writeBack(credsPath, auth);
            // Losing a rotated refresh token logs the user out on the next run;
            // a new access token alone is best-effort.
            if (!wb.ok && rotated) {
                cache.writeLastError(0, `refreshed token could not be saved (${wb.message}); ` +
                    'the rotated refresh token is lost; re-run `codex login`');
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
            : {ok: false, kind: 'error', ...(authStatus ? {status: authStatus} : {}), message: 'token refresh failed; run `codex login` to re-authenticate'});
    }

    // A blank token is a signed-out credentials file, not a rate limit: sent as
    // `Bearer `, its 429 would arm a backoff that outlives the next login.
    if ((auth.tokens.accessToken ?? '').trim() === '')
        return staleOr({ok: false, kind: 'error', message: 'no access token; run `codex login` to log in'});

    const headers = {
        Authorization: `Bearer ${auth.tokens.accessToken}`,
        'User-Agent': USER_AGENT,
    };
    if (auth.tokens.accountId)
        headers['ChatGPT-Account-Id'] = auth.tokens.accountId;

    const res = await http({
        method: 'GET',
        url: endpoints.usage,
        headers,
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;

    // Success: parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes, planHint);
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr({ok: false, kind: 'error', message: msg});
        }
        snapshot = await withResetDetails(snapshot, http, resetCreditsUrl(endpoints.usage), headers, signal);
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    return staleOr(recordHttpError(cache, status, body, `usage request failed (HTTP ${status})`));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openai', () => doFetch(deps));
}

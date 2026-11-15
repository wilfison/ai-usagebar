import {
    readAuth, expiresAtSecs, planType, needsRefresh, refresh, applyRefresh, writeBack, TOKEN_URL,
} from '../../oauth/openai.js';
import {withMutex, runFetch, recordHttpError, isSuccess, errorResult, CACHE_TTL_MS, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseUsage, parseResetCredits, mergeResetCredits, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const USER_AGENT = 'codex-cli';

export function resetCreditsUrl(usageUrl) {
    return usageUrl.replace(/\/usage$/u, '/rate-limit-reset-credits');
}
export {CACHE_TTL_MS};

// Optional detail: its failure never reaches the user, and its body is
// discarded so an account-identifying error never lands in a log.
async function withResetDetails(snapshot, http, url, headers, signal) {
    if (!snapshot.resetCredits || snapshot.resetCredits.available === 0)
        return snapshot;
    const res = await http({method: 'GET', url, headers, timeoutMs: HTTP_TIMEOUT_MS, cancellable: signal});
    if (res.error || !isSuccess(res.status))
        return snapshot;
    try {
        return mergeResetCredits(snapshot, parseResetCredits(res.bodyBytes));
    } catch (_) {
        return snapshot;
    }
}

// Refreshes an expiring token; a result means the fetch stops there.
async function authorize({cache, http, credsPath, auth, endpoints, now, signal}) {
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
        return authTransient
            ? {ok: false, kind: 'loading'}
            : {ok: false, kind: 'error', ...(authStatus ? {status: authStatus} : {}), message: 'token refresh failed; run `codex login` to re-authenticate'};
    }

    // A blank token is a signed-out credentials file, not a rate limit: sent as
    // `Bearer `, its 429 would arm a backoff that outlives the next login.
    if ((auth.tokens.accessToken ?? '').trim() === '')
        return {ok: false, kind: 'error', message: 'no access token; run `codex login` to log in'};
    return null;
}

function usageHeaders(tokens) {
    const headers = {Authorization: `Bearer ${tokens.accessToken}`, 'User-Agent': USER_AGENT};
    if (tokens.accountId)
        headers['ChatGPT-Account-Id'] = tokens.accountId;
    return headers;
}

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let auth;
    try {
        auth = await readAuth(credsPath);
    } catch (e) {
        return errorResult(e);
    }
    const planHint = planType(auth.tokens);

    return runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // Under a 429 backoff runFetch never gets here: no token refresh either.
        authorize: () => authorize({cache, http, credsPath, auth, endpoints, now, signal}),
        request: () => http({method: 'GET', url: endpoints.usage, headers: usageHeaders(auth.tokens), timeoutMs: HTTP_TIMEOUT_MS, cancellable: signal}),
        parse: res => parseUsage(res.bodyBytes, planHint),
        enrich: snapshot => withResetDetails(snapshot, http, resetCreditsUrl(endpoints.usage), usageHeaders(auth.tokens), signal),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `usage request failed (HTTP ${status})`,
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openai', () => doFetch(deps));
}

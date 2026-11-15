import {
    readAuth, expiresAtSecs, planType, needsRefresh, refresh, applyRefresh, writeBack, TOKEN_URL,
} from '../../oauth/openai.js';
import {withMutex, runFetch, settleRefresh, errorResult, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {isSuccess} from '../../http-util.js';
import {parseUsage, parseResetCredits, mergeResetCredits, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const USER_AGENT = 'codex-cli';

export function resetCreditsUrl(usageUrl) {
    return usageUrl.replace(/\/usage$/u, '/rate-limit-reset-credits');
}
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
    const nowSecs = Math.trunc(now.getTime() / 1000);
    // An empty refresh token (signed out, or a flow without one) is never
    // POSTed: the token endpoint would 400 and record an auth error.
    const haveRefresh = (auth.tokens.refreshToken ?? '').trim() !== '';
    if (haveRefresh && needsRefresh(expiresAtSecs(auth.tokens), nowSecs)) {
        const rr = await refresh(http, auth.tokens.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        const failure = await settleRefresh(rr, cache, {
            loginCommand: 'codex login',
            apply: () => {
                const {rotated} = applyRefresh(auth.tokens, rr, nowSecs);
                return Promise.resolve({rotated, saved: writeBack(credsPath, auth)});
            },
        });
        if (failure)
            return failure;
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

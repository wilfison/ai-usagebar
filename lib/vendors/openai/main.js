import {
    readAuth, expiresAtSecs, planType, refresh, applyRefresh, writeBack, TOKEN_URL,
} from '../../oauth/openai.js';
import {withMutex, runFetch, authorizeOAuth, errorResult, redactedRun, HTTP_TIMEOUT_MS} from '../fetch-common.js';
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

function usageHeaders(tokens) {
    const headers = {Authorization: `Bearer ${tokens.accessToken}`, 'User-Agent': USER_AGENT};
    if (tokens.accountId)
        headers['ChatGPT-Account-Id'] = tokens.accountId;
    return headers;
}

async function doFetch(deps) {
    const {http, credsPath} = deps;
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

    const secrets = [auth.tokens.accessToken, auth.tokens.refreshToken, auth.tokens.idToken];
    return redactedRun(secrets, deps.cache, cache => runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // Under a 429 backoff runFetch never gets here: no token refresh either.
        authorize: () => authorizeOAuth({
            tokens: auth.tokens,
            expiresAtSecs: expiresAtSecs(auth.tokens),
            nowSecs: Math.trunc(now.getTime() / 1000),
            cache,
            loginCommand: 'codex login',
            refresh: token => refresh(http, token, {endpoint: endpoints.token, cancellable: signal}),
            apply: rr => {
                secrets.push(rr.accessToken, rr.refreshToken, rr.idToken);
                const {rotated} = applyRefresh(auth.tokens, rr, Math.trunc(now.getTime() / 1000));
                return Promise.resolve({rotated, saved: writeBack(credsPath, auth)});
            },
        }),
        request: () => http({method: 'GET', url: endpoints.usage, headers: usageHeaders(auth.tokens), timeoutMs: HTTP_TIMEOUT_MS, cancellable: signal}),
        parse: res => parseUsage(res.bodyBytes, planHint),
        enrich: snapshot => withResetDetails(snapshot, http, resetCreditsUrl(endpoints.usage), usageHeaders(auth.tokens), signal),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `usage request failed (HTTP ${status})`,
    }));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openai', () => doFetch(deps));
}

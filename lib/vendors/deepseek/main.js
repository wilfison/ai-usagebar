import {withMutex, redactedFetch, runFetch, CACHE_TTL_MS, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseBalance, snapshotToCacheJson, parseCacheJson} from './parser.js';

export {CACHE_TTL_MS};
export const BASE_URL = 'https://api.deepseek.com';
export const BALANCE_URL = `${BASE_URL}/user/balance`;

function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {balance: BALANCE_URL};
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        request: () => http({
            method: 'GET',
            url: endpoints.balance,
            headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
            timeoutMs: HTTP_TIMEOUT_MS,
            cancellable: deps.signal ?? undefined,
        }),
        parse: res => parseBalance(res.bodyBytes),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `balance request failed (HTTP ${status})`,
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'deepseek', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

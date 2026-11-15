import {vendorFetch, httpGet, runFetch} from '../fetch-common.js';
import {parseBalance, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const BASE_URL = 'https://api.deepseek.com';
export const BALANCE_URL = `${BASE_URL}/user/balance`;

function doFetch(deps) {
    const {cache, apiKey} = deps;
    const endpoints = deps.endpoints ?? {balance: BALANCE_URL};
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        request: () => httpGet(deps, endpoints.balance, {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'}),
        parse: res => parseBalance(res.bodyBytes),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `balance request failed (HTTP ${status})`,
    });
}

export const fetchSnapshot = vendorFetch('deepseek', deps => [deps.apiKey], doFetch);

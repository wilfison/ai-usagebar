import {withMutex, redactedFetch, runFetch, isSuccess, CACHE_TTL_MS, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseCredits, parseKey, combine, parseActivity, recentModels, snapshotToCacheJson, parseCacheJson} from './parser.js';

export {CACHE_TTL_MS};
export const BASE_URL = 'https://openrouter.ai/api/v1';

function get(deps, url, key = deps.apiKey) {
    return deps.http({
        method: 'GET',
        url,
        headers: {Authorization: `Bearer ${key}`},
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: deps.signal ?? undefined,
    });
}

// `/activity` answers to a management key only: without one it is not even
// requested, and the inference key never goes there. Any failure is an empty
// list, never a failed fetch.
async function recentModelsOf(deps, url) {
    if (!deps.managementKey)
        return [];
    const res = await get(deps, url, deps.managementKey);
    if (res.error || !isSuccess(res.status))
        return [];
    try {
        return recentModels(parseActivity(res.bodyBytes));
    } catch (_) {
        return [];
    }
}

function doFetch(deps) {
    const endpoints = {credits: `${BASE_URL}/credits`, key: `${BASE_URL}/key`, activity: `${BASE_URL}/activity`, ...deps.endpoints};
    let models = [];
    return runFetch({
        cache: deps.cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        request: async () => {
            const [credits, key, recent] = await Promise.all([
                get(deps, endpoints.credits),
                get(deps, endpoints.key),
                recentModelsOf(deps, endpoints.activity),
            ]);
            models = recent;
            return [credits, key];
        },
        parse: ([credits, key]) => combine(parseCredits(credits.bodyBytes), parseKey(key.bodyBytes), models),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `request failed (HTTP ${status})`,
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openrouter', () => redactedFetch([deps?.apiKey, deps?.managementKey], deps, doFetch));
}

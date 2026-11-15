import {vendorFetch, httpGet, optionalRequest, runFetch} from '../fetch-common.js';
import {parseCredits, parseKey, combine, parseActivity, recentModels, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const BASE_URL = 'https://openrouter.ai/api/v1';

function get(deps, url, key = deps.apiKey) {
    return httpGet(deps, url, {Authorization: `Bearer ${key}`});
}

// `/activity` answers to a management key only: without one it is not even
// requested, and the inference key never goes there. Any failure is an empty
// list, never a failed fetch.
function recentModelsOf(deps, url) {
    if (!deps.managementKey)
        return Promise.resolve([]);
    return optionalRequest(get(deps, url, deps.managementKey), res => recentModels(parseActivity(res.bodyBytes)), []);
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

export const fetchSnapshot = vendorFetch('openrouter', deps => [deps.apiKey, deps.managementKey], doFetch);

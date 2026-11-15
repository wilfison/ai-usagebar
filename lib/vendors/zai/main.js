import {vendorFetch, httpGet, runFetch} from '../fetch-common.js';
import {parseEnvelope, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';

function doFetch(deps) {
    const {cache, apiKey} = deps;
    const endpoints = deps.endpoints ?? {quota: QUOTA_URL};
    const tier = deps.configPlanTier ?? null;
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // Quota GET: bare key in Authorization (NO `Bearer`).
        request: () => httpGet(deps, endpoints.quota, {
            Authorization: apiKey,
            'Accept-Language': 'en-US,en',
            'Content-Type': 'application/json',
        }),
        parse: res => parseEnvelope(res.bodyBytes, tier),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `quota request failed (HTTP ${status})`,
    });
}

export const fetchSnapshot = vendorFetch('zai', deps => [deps.apiKey], doFetch);

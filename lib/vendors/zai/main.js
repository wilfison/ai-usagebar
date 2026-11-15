import {withMutex, redactedFetch, runFetch, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseEnvelope, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';

function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {quota: QUOTA_URL};
    const tier = deps.configPlanTier ?? null;
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // Quota GET: bare key in Authorization (NO `Bearer`).
        request: () => http({
            method: 'GET',
            url: endpoints.quota,
            headers: {
                Authorization: apiKey,
                'Accept-Language': 'en-US,en',
                'Content-Type': 'application/json',
            },
            timeoutMs: HTTP_TIMEOUT_MS,
            cancellable: deps.signal ?? undefined,
        }),
        parse: res => parseEnvelope(res.bodyBytes, tier),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `quota request failed (HTTP ${status})`,
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'zai', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

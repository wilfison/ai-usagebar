import {withMutex, redactedFetch, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseCredits, parseKey, combine, parseActivity, recentModels, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const BASE_URL = 'https://openrouter.ai/api/v1';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

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
    if (res.error || res.status < 200 || res.status >= 300)
        return [];
    try {
        return recentModels(parseActivity(res.bodyBytes));
    } catch (_) {
        return [];
    }
}

async function doFetch(deps) {
    const {cache} = deps;
    const endpoints = {credits: `${BASE_URL}/credits`, key: `${BASE_URL}/key`, activity: `${BASE_URL}/activity`, ...deps.endpoints};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const parseCached = parseCacheJson;
    const staleOr = (original) => staleResult(cache, parseCached, original);

    const fresh = await cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseCacheJson(fresh),
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

    const [creditsRes, keyRes, models] = await Promise.all([
        get(deps, endpoints.credits),
        get(deps, endpoints.key),
        recentModelsOf(deps, endpoints.activity),
    ]);

    // Either transport failure → silent stale fall-back.
    if (creditsRes.error || keyRes.error)
        return staleOr({ok: false, kind: 'loading'});

    // Either HTTP error → mark stale + record, fall back to cache.
    for (const r of [creditsRes, keyRes]) {
        if (r.status < 200 || r.status >= 300) {
            const body = new TextDecoder().decode(r.bodyBytes ?? new Uint8Array(0));
            cache.markStale();
            return staleOr(recordHttpError(cache, r.status, body, `request failed (HTTP ${r.status})`));
        }
    }

    // Both 2xx: combine, parse-before-cache, persist the normalized repr.
    let snapshot;
    try {
        snapshot = combine(parseCredits(creditsRes.bodyBytes), parseKey(keyRes.bodyBytes), models);
    } catch (e) {
        const msg = e?.message ?? String(e);
        cache.markStale();
        cache.writeLastError(0, msg);
        return staleOr({ok: false, kind: 'error', message: msg});
    }
    cache.writePayload(snapshotToCacheJson(snapshot));
    return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openrouter', () => redactedFetch([deps?.apiKey, deps?.managementKey], deps, doFetch));
}

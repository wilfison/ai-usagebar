import {parseEnvelope} from './parser.js';

export const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

const _locks = new Map();

function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

function cachedSnapshot(cache, tier) {
    const bytes = cache.maybePayload();
    if (bytes === null)
        return null;
    try {
        return parseEnvelope(bytes, tier);
    } catch (_) {
        return null;
    }
}

function staleOr(cache, tier, noCache) {
    const snapshot = cachedSnapshot(cache, tier);
    if (snapshot === null)
        return noCache;
    return {
        ok: true,
        snapshot,
        stale: true,
        lastError: cache.readLastError(),
        cacheAgeMs: cache.payloadAgeMs() ?? 0,
    };
}

async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {quota: QUOTA_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const tier = deps.configPlanTier ?? null;
    const signal = deps.signal ?? undefined;

    const fresh = cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseEnvelope(fresh, tier),
                stale: false,
                lastError: null,
                cacheAgeMs: cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache — fall through to a live fetch.
        }
    }

    // Quota GET — bare key in Authorization (NO `Bearer`).
    const res = await http({
        method: 'GET',
        url: endpoints.quota,
        headers: {
            Authorization: apiKey,
            'Accept-Language': 'en-US,en',
            'Content-Type': 'application/json',
        },
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, tier, {ok: false, kind: 'loading'});

    const status = res.status;

    // Success — parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseEnvelope(res.bodyBytes, tier);
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr(cache, tier, {ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(res.bodyBytes);
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, tier, {ok: false, kind: 'error', message: `quota request failed (HTTP ${status})`});
}

export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'zai';
    return withMutex(key, () => doFetch(deps));
}

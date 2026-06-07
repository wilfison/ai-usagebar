import {parseCredits, parseKey, combine, snapshotToCacheJson, parseCacheJson} from './openrouter-parse.js';

export const BASE_URL = 'https://openrouter.ai/api/v1';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

const _locks = new Map();

function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

function cachedSnapshot(cache) {
    const bytes = cache.maybePayload();
    if (bytes === null)
        return null;
    try {
        return parseCacheJson(bytes);
    } catch (_) {
        return null;
    }
}

function staleOr(cache, noCache) {
    const snapshot = cachedSnapshot(cache);
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

function get(deps, url) {
    return deps.http({
        method: 'GET',
        url,
        headers: {Authorization: `Bearer ${deps.apiKey}`},
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: deps.signal ?? undefined,
    });
}

async function doFetch(deps) {
    const {cache} = deps;
    const endpoints = deps.endpoints ?? {credits: `${BASE_URL}/credits`, key: `${BASE_URL}/key`};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;

    // 1. Fresh-cache fast path.
    const fresh = cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseCacheJson(fresh),
                stale: false,
                lastError: null,
                cacheAgeMs: cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache — fall through to a live fetch.
        }
    }

    // 2. Fetch both endpoints in parallel.
    const [creditsRes, keyRes] = await Promise.all([
        get(deps, endpoints.credits),
        get(deps, endpoints.key),
    ]);

    // 2a. Either transport failure → silent stale fall-back.
    if (creditsRes.error || keyRes.error)
        return staleOr(cache, {ok: false, kind: 'loading'});

    // 2b. Either HTTP error → mark stale + record, fall back to cache.
    for (const r of [creditsRes, keyRes]) {
        if (r.status < 200 || r.status >= 300) {
            const body = new TextDecoder().decode(r.bodyBytes ?? new Uint8Array(0));
            cache.markStale();
            cache.writeLastError(r.status, body);
            return staleOr(cache, {ok: false, kind: 'error', message: `request failed (HTTP ${r.status})`});
        }
    }

    // 2c. Both 2xx — combine, parse-before-cache, persist the normalized repr.
    let snapshot;
    try {
        snapshot = combine(parseCredits(creditsRes.bodyBytes), parseKey(keyRes.bodyBytes));
    } catch (e) {
        const msg = e?.message ?? String(e);
        cache.markStale();
        cache.writeLastError(0, msg);
        return staleOr(cache, {ok: false, kind: 'error', message: msg});
    }
    cache.writePayload(snapshotToCacheJson(snapshot));
    return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
}

export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'openrouter';
    return withMutex(key, () => doFetch(deps));
}

import {parseBalance, snapshotToCacheJson, parseCacheJson} from './deepseek-parse.js';

export const BASE_URL = 'https://api.deepseek.com';
export const BALANCE_URL = `${BASE_URL}/user/balance`;
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

async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {balance: BALANCE_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const signal = deps.signal ?? undefined;

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

    const res = await http({
        method: 'GET',
        url: endpoints.balance,
        headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, {ok: false, kind: 'loading'});

    const status = res.status;

    // Success — parse, cache the normalized repr, return non-stale.
    if (status >= 200 && status < 300) {
        const snapshot = parseBalance(res.bodyBytes);
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, {ok: false, kind: 'error', message: `balance request failed (HTTP ${status})`});
}

export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'deepseek';
    return withMutex(key, () => doFetch(deps));
}

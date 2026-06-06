/**
 * @file DeepSeek fetch state machine: GET `/user/balance` → cache the normalized
 * snapshot JSON, falling back to the cached repr on failure. Returns a
 * discriminated {@link FetchResult}; never throws.
 *
 * Concurrency is serialized by an in-process per-vendor mutex.
 */

import {parseBalance, snapshotToCacheJson, parseCacheJson} from './deepseek-parse.js';

/** @type {string} API base. */
export const BASE_URL = 'https://api.deepseek.com';
/** @type {string} Balance endpoint. */
export const BALANCE_URL = `${BASE_URL}/user/balance`;
/** @type {number} Fresh-cache TTL: skip the network when the payload is younger. */
export const CACHE_TTL_MS = 60_000;
/** @type {number} Per-request timeout. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * @typedef {import('./types.js').FetchResult} FetchResult
 */

/**
 * @typedef {object} FetchDeps
 * @property {import('../cache.js').Cache} cache
 * @property {(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 * @property {string} apiKey - already-resolved API key.
 * @property {{balance: string}} [endpoints] - defaults to the real URL.
 * @property {number} [cacheTtlMs=60000]
 * @property {import('gi://Gio').Cancellable} [signal]
 */

/** @type {Map<string, Promise<*>>} per-vendor promise queue (in-process mutex). */
const _locks = new Map();

/**
 * Serialize `fn` against any other call sharing `key`.
 * @param {string} key
 * @param {() => Promise<*>} fn
 * @returns {Promise<*>}
 */
function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

/**
 * Load + parse the cached snapshot repr, tolerating a missing/corrupt cache.
 * @param {import('../cache.js').Cache} cache
 * @returns {?import('./deepseek-parse.js').DeepseekSnapshot}
 */
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

/**
 * Fall back to the cached snapshot as a stale result, or `noCache` otherwise.
 * @param {import('../cache.js').Cache} cache
 * @param {FetchResult} noCache
 * @returns {FetchResult}
 */
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

/**
 * Core fetch logic (no mutex). Always resolves to a {@link FetchResult}.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>}
 */
async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {balance: BALANCE_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const signal = deps.signal ?? undefined;

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

    // 2. Balance GET.
    const res = await http({
        method: 'GET',
        url: endpoints.balance,
        headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // 2a. Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, {ok: false, kind: 'loading'});

    const status = res.status;

    // 2b. Success — parse, cache the normalized repr, return non-stale.
    if (status >= 200 && status < 300) {
        const snapshot = parseBalance(res.bodyBytes);
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // 2c. HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, {ok: false, kind: 'error', message: `balance request failed (HTTP ${status})`});
}

/**
 * Fetch the DeepSeek snapshot, serialized per vendor cache directory.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>} always resolves; never throws.
 */
export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'deepseek';
    return withMutex(key, () => doFetch(deps));
}

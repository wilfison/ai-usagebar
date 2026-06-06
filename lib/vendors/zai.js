/**
 * @file Z.AI fetch state machine: GET the monitor quota → cache, falling back to
 * the cached payload on failure. API-key auth, no OAuth. Returns a discriminated
 * {@link FetchResult}; never throws.
 *
 * Auth-header quirk: the key is sent as `Authorization: <KEY>` WITHOUT the
 * `Bearer` prefix — sending `Bearer …` returns 401.
 *
 * Concurrency is serialized by an in-process per-vendor mutex.
 */

import {parseEnvelope} from './zai-parse.js';

/** @type {string} Undocumented monitor quota endpoint. */
export const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';
/** @type {number} Fresh-cache TTL: skip the network when the payload is younger. */
export const CACHE_TTL_MS = 60_000;
/** @type {number} Per-request timeout for the quota GET. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * @typedef {import('./types.js').FetchResult} FetchResult
 */

/**
 * @typedef {object} FetchDeps
 * @property {import('../cache.js').Cache} cache
 * @property {(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 * @property {string} apiKey - already-resolved API key (bare, no `Bearer`).
 * @property {?string} [configPlanTier] - fallback plan tier when `level` is empty.
 * @property {{quota: string}} [endpoints] - defaults to the real URL.
 * @property {number} [cacheTtlMs=60000]
 * @property {Date} [now]
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
 * Load + parse the cached payload, tolerating a missing or corrupt cache.
 * @param {import('../cache.js').Cache} cache
 * @param {?string} tier
 * @returns {?import('./zai-parse.js').ZaiSnapshot}
 */
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

/**
 * Fall back to the cached payload as a stale result, or `noCache` otherwise.
 * @param {import('../cache.js').Cache} cache
 * @param {?string} tier
 * @param {FetchResult} noCache
 * @returns {FetchResult}
 */
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

/**
 * Core fetch logic (no mutex). Always resolves to a {@link FetchResult}.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>}
 */
async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {quota: QUOTA_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const tier = deps.configPlanTier ?? null;
    const signal = deps.signal ?? undefined;

    // 1. Fresh-cache fast path.
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

    // 2. Quota GET — bare key in Authorization (NO `Bearer`).
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

    // 2a. Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, tier, {ok: false, kind: 'loading'});

    const status = res.status;

    // 2b. Success — parse BEFORE caching; only a parseable body is persisted.
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

    // 2c. HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, tier, {ok: false, kind: 'error', message: `quota request failed (HTTP ${status})`});
}

/**
 * Fetch the Z.AI usage snapshot, serialized per vendor cache directory.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>} always resolves; never throws.
 */
export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'zai';
    return withMutex(key, () => doFetch(deps));
}

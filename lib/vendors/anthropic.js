/**
 * @file Anthropic fetch state machine: read creds → maybe-refresh token →
 * GET usage → cache, falling back to the cached payload on failure. Returns a
 * discriminated {@link FetchResult} the indicator renders; never throws.
 *
 * Concurrency is serialized by an in-process per-vendor mutex — no on-disk
 * `.fetch.lock` (multi-process flock interop is out of scope for the extension).
 */

import {readCreds, planLabel, needsRefresh, refresh, writeBack, TOKEN_URL} from '../oauth/anthropic.js';
import {parseUsage} from './anthropic-parse.js';

/** @type {string} Undocumented OAuth usage endpoint. */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** @type {string} Required `anthropic-beta` header value for the usage GET. */
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
/** @type {number} Fresh-cache TTL: skip the network when the payload is younger. */
export const CACHE_TTL_MS = 60_000;
/** @type {number} Per-request timeout for the usage GET. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * The discriminated fetch-result union, shared across vendors. On `ok:true` the
 * `snapshot` field is an {@link import('./anthropic-parse.js').AnthropicSnapshot}.
 * @typedef {import('./types.js').FetchResult} FetchResult
 */

/**
 * @typedef {object} FetchDeps
 * @property {import('../cache.js').Cache} cache
 * @property {(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 * @property {string} credsPath
 * @property {{usage: string, token: string}} [endpoints] - defaults to the real URLs.
 * @property {number} [cacheTtlMs=60000]
 * @property {Date} [now] - clock for the refresh-window check only.
 * @property {Gio.Cancellable} [signal] - threaded into every HTTP call.
 */

/** @type {Map<string, Promise<*>>} per-vendor promise queue (in-process mutex). */
const _locks = new Map();

/**
 * Serialize `fn` against any other call sharing `key`, regardless of outcome.
 * @param {string} key
 * @param {() => Promise<*>} fn
 * @returns {Promise<*>}
 */
function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    // Keep the chain alive (and unhandled-rejection-free) even if fn rejects.
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

/**
 * Load + parse the cached payload, tolerating a missing or corrupt cache.
 * @param {import('../cache.js').Cache} cache
 * @param {string} plan
 * @returns {?import('./anthropic-parse.js').AnthropicSnapshot} null when absent/corrupt.
 */
function cachedSnapshot(cache, plan) {
    const bytes = cache.maybePayload();
    if (bytes === null)
        return null;
    try {
        return parseUsage(bytes, plan);
    } catch (_) {
        return null;
    }
}

/**
 * Fall back to the cached payload as a stale result, or `noCache` when there is
 * no usable cache. `lastError` is read from the sidecar (may be from an earlier
 * failure on the silent/transient path).
 * @param {import('../cache.js').Cache} cache
 * @param {string} plan
 * @param {FetchResult} noCache - result to return when no cache is usable.
 * @returns {FetchResult}
 */
function staleOr(cache, plan, noCache) {
    const snapshot = cachedSnapshot(cache, plan);
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
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    // 1. Credentials — a missing/unparseable file is a hard error (no fetch).
    let oauth;
    try {
        ({oauth} = readCreds(credsPath));
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const plan = planLabel(oauth);

    // 2. Fresh-cache fast path — no HTTP when the payload is younger than the TTL.
    const fresh = cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseUsage(fresh, plan),
                stale: false,
                lastError: null,
                cacheAgeMs: cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache (shouldn't happen — we only cache parseable
            // bodies). Fall through to a live fetch.
        }
    }

    // 3. Proactive token refresh.
    let authFailed = false;
    let authTransient = false;
    if (needsRefresh(Math.trunc(oauth.expiresAtMs / 1000), Math.trunc(now.getTime() / 1000))) {
        const rr = await refresh(http, oauth.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        if (rr.ok) {
            oauth.accessToken = rr.accessToken;
            if (rr.refreshToken)
                oauth.refreshToken = rr.refreshToken;
            oauth.expiresAtMs = now.getTime() + rr.expiresIn * 1000;
            // Best-effort persistence — fresh tokens still serve even if write fails.
            writeBack(credsPath, oauth);
        } else if (rr.kind === 'http') {
            cache.writeLastError(rr.status, rr.body);
            authFailed = true;
        } else if (rr.kind === 'transport') {
            authFailed = true;
            authTransient = true;
        } else { // schema
            cache.writeLastError(0, rr.message);
            authFailed = true;
        }
    }

    // 4. On auth failure, serve stale cache or surface loading/error.
    if (authFailed) {
        return staleOr(cache, plan, authTransient
            ? {ok: false, kind: 'loading'}
            : {ok: false, kind: 'error', message: 'token refresh failed; run `claude` to re-authenticate'});
    }

    // 5. Usage GET.
    const res = await http({
        method: 'GET',
        url: endpoints.usage,
        headers: {
            Authorization: `Bearer ${oauth.accessToken}`,
            'anthropic-beta': USAGE_BETA_HEADER,
        },
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // 5a. Transport/timeout/cancelled → silent stale fall-back (no .last_error).
    if (res.error)
        return staleOr(cache, plan, {ok: false, kind: 'loading'});

    const status = res.status;

    // 5b. Success — parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes, plan);
        } catch (e) {
            // Schema drift: a 2xx body we can't parse. Never cached.
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr(cache, plan, {ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(res.bodyBytes); // clears .stale/.last_error
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // 5c. HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, plan, {ok: false, kind: 'error', message: `usage request failed (HTTP ${status})`});
}

/**
 * Fetch the Anthropic usage snapshot, serialized per vendor cache directory.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>} always resolves; never throws.
 */
export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'anthropic';
    return withMutex(key, () => doFetch(deps));
}

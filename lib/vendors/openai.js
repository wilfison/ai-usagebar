/**
 * @file OpenAI/Codex fetch state machine: read `~/.codex/auth.json` → maybe
 * refresh token → GET usage → cache, falling back to the cached payload on
 * failure. Returns a discriminated {@link FetchResult}; never throws. Mirrors the
 * Anthropic flow but over the Codex OAuth credentials.
 *
 * Concurrency is serialized by an in-process per-vendor mutex.
 */

import {
    readAuth, expiresAtSecs, planType, needsRefresh, refresh, writeBack, TOKEN_URL,
} from '../oauth/openai.js';
import {parseUsage} from './openai-parse.js';

/** @type {string} Undocumented Codex usage endpoint. */
export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
/** @type {string} User-Agent the usage endpoint expects. */
export const USER_AGENT = 'codex-cli';
/** @type {number} Fresh-cache TTL: skip the network when the payload is younger. */
export const CACHE_TTL_MS = 60_000;
/** @type {number} Per-request timeout for the usage GET. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * @typedef {import('./types.js').FetchResult} FetchResult
 */

/**
 * @typedef {object} FetchDeps
 * @property {import('../cache.js').Cache} cache
 * @property {(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 * @property {string} credsPath - resolved path to `auth.json`.
 * @property {{usage: string, token: string}} [endpoints] - defaults to the real URLs.
 * @property {number} [cacheTtlMs=60000]
 * @property {Date} [now] - clock for the refresh-window check only.
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
 * @param {?string} planHint
 * @returns {?import('./openai-parse.js').OpenAiSnapshot}
 */
function cachedSnapshot(cache, planHint) {
    const bytes = cache.maybePayload();
    if (bytes === null)
        return null;
    try {
        return parseUsage(bytes, planHint);
    } catch (_) {
        return null;
    }
}

/**
 * Fall back to the cached payload as a stale result, or `noCache` when there is
 * no usable cache.
 * @param {import('../cache.js').Cache} cache
 * @param {?string} planHint
 * @param {FetchResult} noCache
 * @returns {FetchResult}
 */
function staleOr(cache, planHint, noCache) {
    const snapshot = cachedSnapshot(cache, planHint);
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
    let auth;
    try {
        auth = readAuth(credsPath);
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const planHint = planType(auth.tokens);

    // 2. Fresh-cache fast path.
    const fresh = cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseUsage(fresh, planHint),
                stale: false,
                lastError: null,
                cacheAgeMs: cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache — fall through to a live fetch.
        }
    }

    // 3. Proactive token refresh (Codex CLI may not populate expires_at, so the
    // expiry comes from the id_token's exp claim).
    let authFailed = false;
    let authTransient = false;
    if (needsRefresh(expiresAtSecs(auth.tokens), Math.trunc(now.getTime() / 1000))) {
        const rr = await refresh(http, auth.tokens.refreshToken, {endpoint: endpoints.token, cancellable: signal});
        if (rr.ok) {
            auth.tokens.accessToken = rr.accessToken;
            if (rr.refreshToken)
                auth.tokens.refreshToken = rr.refreshToken;
            if (rr.idToken)
                auth.tokens.idToken = rr.idToken;
            writeBack(credsPath, auth); // best-effort
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
        return staleOr(cache, planHint, authTransient
            ? {ok: false, kind: 'loading'}
            : {ok: false, kind: 'error', message: 'token refresh failed; run `codex login` to re-authenticate'});
    }

    // 5. Usage GET.
    const headers = {
        Authorization: `Bearer ${auth.tokens.accessToken}`,
        'User-Agent': USER_AGENT,
    };
    if (auth.tokens.accountId)
        headers['ChatGPT-Account-Id'] = auth.tokens.accountId;

    const res = await http({
        method: 'GET',
        url: endpoints.usage,
        headers,
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // 5a. Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, planHint, {ok: false, kind: 'loading'});

    const status = res.status;

    // 5b. Success — parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes, planHint);
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr(cache, planHint, {ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(res.bodyBytes);
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // 5c. HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, planHint, {ok: false, kind: 'error', message: `usage request failed (HTTP ${status})`});
}

/**
 * Fetch the OpenAI usage snapshot, serialized per vendor cache directory.
 * @param {FetchDeps} deps
 * @returns {Promise<FetchResult>} always resolves; never throws.
 */
export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'openai';
    return withMutex(key, () => doFetch(deps));
}

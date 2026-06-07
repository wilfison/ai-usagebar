import {readCreds, planLabel, needsRefresh, refresh, writeBack, TOKEN_URL} from '../oauth/anthropic.js';
import {parseUsage} from './anthropic-parse.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

const _locks = new Map();

function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    // Keep the chain alive (and unhandled-rejection-free) even if fn rejects.
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

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

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let oauth;
    try {
        ({oauth} = readCreds(credsPath));
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const plan = planLabel(oauth);

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

    if (authFailed) {
        return staleOr(cache, plan, authTransient
            ? {ok: false, kind: 'loading'}
            : {ok: false, kind: 'error', message: 'token refresh failed; run `claude` to re-authenticate'});
    }

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

    // Transport/timeout/cancelled → silent stale fall-back (no .last_error).
    if (res.error)
        return staleOr(cache, plan, {ok: false, kind: 'loading'});

    const status = res.status;

    // Success — parse BEFORE caching; only a parseable body is persisted.
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

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, plan, {ok: false, kind: 'error', message: `usage request failed (HTTP ${status})`});
}

export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'anthropic';
    return withMutex(key, () => doFetch(deps));
}

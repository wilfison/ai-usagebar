import {
    readAuth, expiresAtSecs, planType, needsRefresh, refresh, writeBack, TOKEN_URL,
} from '../../oauth/openai.js';
import {parseUsage} from './parser.js';

export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const USER_AGENT = 'codex-cli';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

const _locks = new Map();

function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

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

async function doFetch(deps) {
    const {cache, http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let auth;
    try {
        auth = readAuth(credsPath);
    } catch (e) {
        return {ok: false, kind: 'error', message: e?.message ?? String(e)};
    }
    const planHint = planType(auth.tokens);

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

    // Proactive token refresh (Codex CLI may not populate expires_at, so the
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

    if (authFailed) {
        return staleOr(cache, planHint, authTransient
            ? {ok: false, kind: 'loading'}
            : {ok: false, kind: 'error', message: 'token refresh failed; run `codex login` to re-authenticate'});
    }

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

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr(cache, planHint, {ok: false, kind: 'loading'});

    const status = res.status;

    // Success — parse BEFORE caching; only a parseable body is persisted.
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

    // HTTP 4xx/5xx → mark stale + record the error, then fall back to cache.
    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    cache.writeLastError(status, body);
    return staleOr(cache, planHint, {ok: false, kind: 'error', message: `usage request failed (HTTP ${status})`});
}

export async function fetchSnapshot(deps) {
    const key = deps?.cache?.dir ?? 'openai';
    return withMutex(key, () => doFetch(deps));
}

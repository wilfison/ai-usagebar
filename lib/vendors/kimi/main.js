import {withMutex, staleResult} from '../fetch-common.js';
import {parseUsage} from './parser.js';

export const USAGES_URL = 'https://api.kimi.com/coding/v1/usages';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {usages: USAGES_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const signal = deps.signal ?? undefined;
    const staleOr = (noCache) => staleResult(cache, (b) => parseUsage(b), noCache);

    const fresh = await cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseUsage(fresh),
                stale: false,
                lastError: null,
                cacheAgeMs: await cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache — fall through to a live fetch.
        }
    }

    const res = await http({
        method: 'GET',
        url: endpoints.usages,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;

    // Success — parse BEFORE caching; only a parseable body is persisted.
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes);
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr({ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(res.bodyBytes);
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record a generic error, then fall back to
    // cache. Never surface the upstream/proxy body (it can carry the key or
    // arbitrary markup): a generic message is stored and returned.
    const message = (status === 401 || status === 403)
        ? 'Kimi authentication failed'
        : `Kimi API returned HTTP ${status}`;
    cache.markStale();
    cache.writeLastError(status, message);
    return staleOr({ok: false, kind: 'error', message});
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'kimi', () => doFetch(deps));
}

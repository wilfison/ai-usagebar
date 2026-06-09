import {withMutex, staleResult} from '../fetch-common.js';
import {parseCredits, parseKey, combine, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const BASE_URL = 'https://openrouter.ai/api/v1';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

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
    const staleOr = (noCache) => staleResult(cache, parseCacheJson, noCache);

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

    const [creditsRes, keyRes] = await Promise.all([
        get(deps, endpoints.credits),
        get(deps, endpoints.key),
    ]);

    // Either transport failure → silent stale fall-back.
    if (creditsRes.error || keyRes.error)
        return staleOr({ok: false, kind: 'loading'});

    // Either HTTP error → mark stale + record, fall back to cache.
    for (const r of [creditsRes, keyRes]) {
        if (r.status < 200 || r.status >= 300) {
            const body = new TextDecoder().decode(r.bodyBytes ?? new Uint8Array(0));
            cache.markStale();
            cache.writeLastError(r.status, body);
            return staleOr({ok: false, kind: 'error', message: `request failed (HTTP ${r.status})`});
        }
    }

    // Both 2xx — combine, parse-before-cache, persist the normalized repr.
    let snapshot;
    try {
        snapshot = combine(parseCredits(creditsRes.bodyBytes), parseKey(keyRes.bodyBytes));
    } catch (e) {
        const msg = e?.message ?? String(e);
        cache.markStale();
        cache.writeLastError(0, msg);
        return staleOr({ok: false, kind: 'error', message: msg});
    }
    cache.writePayload(snapshotToCacheJson(snapshot));
    return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'openrouter', () => doFetch(deps));
}

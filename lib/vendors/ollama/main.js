import {withMutex, redactedFetch, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson} from './parser.js';

// `/api/usage` now returns request and token history, not quota.
export const USAGE_URL = 'https://ollama.com/api/balance';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

// Only the API key authenticates this route; ~/.ollama/id_ed25519 is never read.
async function doFetch(deps) {
    const {cache, http, apiKey, plan} = deps;
    const url = deps.endpoints?.usage ?? USAGE_URL;
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;
    // The plan is a pref, so a cached snapshot shows the current one.
    const parseCached = bytes => ({...parseCacheJson(bytes), plan: plan || null});
    const staleOr = (original) => staleResult(cache, parseCached, original);

    const fresh = await cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {
                ok: true,
                snapshot: parseCached(fresh),
                stale: false,
                lastError: null,
                cacheAgeMs: await cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Corrupt fresh cache: fall through to a live fetch.
        }
    }

    const backoffUntil = await underBackoff(cache, now);
    if (backoffUntil !== null)
        return backoffResult(cache, parseCached, backoffUntil, now);

    const res = await http({
        method: 'GET',
        url,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });

    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = parseUsage(res.bodyBytes, plan);
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr({ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    const body = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    cache.markStale();
    return staleOr(recordHttpError(cache, status, body, `Ollama API returned HTTP ${status}`));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'ollama', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

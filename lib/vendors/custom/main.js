import {sanitizeUntrusted} from '../../format.js';
import {withMutex, redactedFetch, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseUsage, urlProblem, snapshotToCacheJson, parseCacheJson, MAX_STRING_CHARS} from './parser.js';

export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

async function doFetch(deps) {
    const {cache, http, url, allowHttp, headers, mapping, name} = deps;
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    const problem = urlProblem(url, allowHttp);
    if (problem !== null)
        return {ok: false, kind: 'error', message: problem};

    // The name is a pref, so a cached snapshot shows the current one.
    const parseCached = bytes => ({...parseCacheJson(bytes), name});
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

    const res = await http({method: 'GET', url: url.trim(), headers, timeoutMs: HTTP_TIMEOUT_MS, cancellable: signal});

    // Transport/timeout/cancelled → silent stale fall-back; the URL is never echoed.
    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;
    if (status >= 200 && status < 300) {
        let snapshot;
        try {
            snapshot = {...parseUsage(res.bodyBytes, mapping, now), name};
        } catch (e) {
            const msg = e?.message ?? String(e);
            cache.markStale();
            cache.writeLastError(0, msg);
            return staleOr({ok: false, kind: 'error', message: msg});
        }
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    const body = sanitizeUntrusted(new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0)), MAX_STRING_CHARS);
    cache.markStale();
    return staleOr(recordHttpError(cache, status, body, `custom provider returned HTTP ${status}`));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'custom', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

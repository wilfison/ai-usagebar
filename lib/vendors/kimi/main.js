import {withMutex, redactedFetch, staleResult, underBackoff, backoffResult, recordHttpError} from '../fetch-common.js';
import {parseUsage, planLabelFromMe, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGES_URL = 'https://api.kimi.com/coding/v1/usages';
export const ME_URL = 'https://api.kimi.com/coding/v1/me';
export const CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

async function planLabel(pending) {
    try {
        const res = await pending;
        if (res.error || res.status < 200 || res.status >= 300)
            return null;
        return planLabelFromMe(res.bodyBytes);
    } catch (_) {
        return null;
    }
}

async function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {usages: USAGES_URL, me: ME_URL};
    const cacheTtlMs = deps.cacheTtlMs ?? CACHE_TTL_MS;
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;
    const parseCached = parseCacheJson;
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

    // Under a 429 backoff no request is made at all, token refresh included.
    const backoffUntil = await underBackoff(cache, now);
    if (backoffUntil !== null)
        return backoffResult(cache, parseCached, backoffUntil, now);

    const get = (url) => http({
        method: 'GET',
        url,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: signal,
    });
    // /me only supplies the tier name; its failure must never cost the quota.
    const [res, label] = await Promise.all([get(endpoints.usages), planLabel(get(endpoints.me))]);

    // Transport/timeout/cancelled → silent stale fall-back.
    if (res.error)
        return staleOr({ok: false, kind: 'loading'});

    const status = res.status;

    // Success: parse BEFORE caching; only a parseable body is persisted.
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
        if (label !== null)
            snapshot.plan = label;
        cache.writePayload(snapshotToCacheJson(snapshot));
        return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
    }

    // HTTP 4xx/5xx → mark stale + record a generic error, then fall back to
    // cache. Never surface the upstream/proxy body (it can carry the key or
    // arbitrary markup): a generic message is stored and returned.
    const message = `Kimi API returned HTTP ${status}`;
    cache.markStale();
    return staleOr(recordHttpError(cache, status, message, message));
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'kimi', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

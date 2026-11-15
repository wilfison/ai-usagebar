import {sanitizeUntrusted} from '../../format.js';
import {withMutex, redactedFetch, runFetch, bodyText, CACHE_TTL_MS, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {parseUsage, urlProblem, snapshotToCacheJson, parseCacheJson, MAX_STRING_CHARS} from './parser.js';

export {CACHE_TTL_MS};

function doFetch(deps) {
    const {cache, http, url, allowHttp, headers, mapping, name} = deps;
    const now = deps.now ?? new Date();

    const problem = urlProblem(url, allowHttp);
    if (problem !== null)
        return Promise.resolve({ok: false, kind: 'error', message: problem});

    return runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        // The name is a pref, so a cached snapshot shows the current one.
        parseCached: bytes => ({...parseCacheJson(bytes), name}),
        request: () => http({method: 'GET', url: url.trim(), headers, timeoutMs: HTTP_TIMEOUT_MS, cancellable: deps.signal ?? undefined}),
        parse: res => ({...parseUsage(res.bodyBytes, mapping, now), name}),
        toCache: snapshotToCacheJson,
        // The URL is never echoed: only the status.
        httpErrorMessage: status => `custom provider returned HTTP ${status}`,
        httpErrorBody: res => sanitizeUntrusted(bodyText(res), MAX_STRING_CHARS),
    });
}

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'custom', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

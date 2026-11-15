import {sanitizeUntrusted} from '../../format.js';
import {vendorFetch, httpGet, runFetch} from '../fetch-common.js';
import {bodyText} from '../../http-util.js';
import {parseUsage, urlProblem, snapshotToCacheJson, parseCacheJson, MAX_STRING_CHARS} from './parser.js';

function doFetch(deps) {
    const {cache, url, allowHttp, headers, mapping, name} = deps;
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
        request: () => httpGet(deps, url.trim(), headers),
        parse: res => ({...parseUsage(res.bodyBytes, mapping, now), name}),
        toCache: snapshotToCacheJson,
        // The URL is never echoed: only the status.
        httpErrorMessage: status => `custom provider returned HTTP ${status}`,
        httpErrorBody: res => sanitizeUntrusted(bodyText(res), MAX_STRING_CHARS),
    });
}

export const fetchSnapshot = vendorFetch('custom', deps => [deps.apiKey], doFetch);

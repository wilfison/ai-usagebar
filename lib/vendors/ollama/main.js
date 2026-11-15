import {vendorFetch, httpGet, runFetch} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson} from './parser.js';

// `/api/usage` now returns request and token history, not quota.
export const USAGE_URL = 'https://ollama.com/api/balance';

// Only the API key authenticates this route; ~/.ollama/id_ed25519 is never read.
function doFetch(deps) {
    const {cache, apiKey, plan} = deps;
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        // The plan is a pref, so a cached snapshot shows the current one.
        parseCached: bytes => ({...parseCacheJson(bytes), plan: plan || null}),
        request: () => httpGet(deps, deps.endpoints?.usage ?? USAGE_URL, {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'}),
        parse: res => parseUsage(res.bodyBytes, plan),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `Ollama API returned HTTP ${status}`,
    });
}

export const fetchSnapshot = vendorFetch('ollama', deps => [deps.apiKey], doFetch);

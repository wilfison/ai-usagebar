import {vendorFetch, httpGet, optionalRequest, runFetch} from '../fetch-common.js';
import {parseUsage, planLabelFromMe, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGES_URL = 'https://api.kimi.com/coding/v1/usages';
export const ME_URL = 'https://api.kimi.com/coding/v1/me';

const errorMessage = status => `Kimi API returned HTTP ${status}`;

function doFetch(deps) {
    const {cache, apiKey} = deps;
    const endpoints = deps.endpoints ?? {usages: USAGES_URL, me: ME_URL};
    const get = url => httpGet(deps, url, {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'});
    let label = null;
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // /me only supplies the tier name; its failure must never cost the quota.
        request: async () => {
            const [res, me] = await Promise.all([get(endpoints.usages), optionalRequest(get(endpoints.me), res => planLabelFromMe(res.bodyBytes), null)]);
            label = me;
            return res;
        },
        parse: res => parseUsage(res.bodyBytes),
        enrich: snapshot => (label === null ? snapshot : {...snapshot, plan: label}),
        toCache: snapshotToCacheJson,
        // The upstream/proxy body can carry the key or arbitrary markup, so a
        // generic message is stored instead.
        httpErrorMessage: errorMessage,
        httpErrorBody: res => errorMessage(res.status),
    });
}

export const fetchSnapshot = vendorFetch('kimi', deps => [deps.apiKey], doFetch);

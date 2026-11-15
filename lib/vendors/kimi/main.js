import {withMutex, redactedFetch, runFetch, HTTP_TIMEOUT_MS} from '../fetch-common.js';
import {isSuccess} from '../../http-util.js';
import {parseUsage, planLabelFromMe, snapshotToCacheJson, parseCacheJson} from './parser.js';

export const USAGES_URL = 'https://api.kimi.com/coding/v1/usages';
export const ME_URL = 'https://api.kimi.com/coding/v1/me';

async function planLabel(pending) {
    try {
        const res = await pending;
        if (res.error || !isSuccess(res.status))
            return null;
        return planLabelFromMe(res.bodyBytes);
    } catch (_) {
        return null;
    }
}

const errorMessage = status => `Kimi API returned HTTP ${status}`;

function doFetch(deps) {
    const {cache, http, apiKey} = deps;
    const endpoints = deps.endpoints ?? {usages: USAGES_URL, me: ME_URL};
    const get = url => http({
        method: 'GET',
        url,
        headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
        timeoutMs: HTTP_TIMEOUT_MS,
        cancellable: deps.signal ?? undefined,
    });
    let label = null;
    return runFetch({
        cache,
        now: deps.now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: parseCacheJson,
        // /me only supplies the tier name; its failure must never cost the quota.
        request: async () => {
            const [res, me] = await Promise.all([get(endpoints.usages), planLabel(get(endpoints.me))]);
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

export async function fetchSnapshot(deps) {
    return withMutex(deps?.cache?.dir ?? 'kimi', () => redactedFetch([deps?.apiKey], deps, doFetch));
}

// Builders for the uniform vendor Adapter. Pure: `getenv` is injected.
import {resolveApiKey} from '../config-resolve.js';
import {severityFor} from '../severity.js';
import {vendorLabel} from '../vendors.js';
import {errorResult} from './fetch-common.js';

// `severity` defaults to the peak window's; a balance vendor passes its own.
export function vendorAdapter({id, parser, peakUsage, severity = s => severityFor(peakUsage(s).percent ?? 0), buildSection, fetchSnapshot, extra = {}}) {
    const adapter = {
        id,
        cacheId: id,
        icon: parser.ICON,
        vendorShort: parser.VENDOR_SHORT,
        fetchSnapshot,
        severity,
        peakUsage,
        placeholders: parser.placeholders,
        notifyRows: parser.notifyRows,
        resetCredits: parser.resetCredits,
        buildSection,
    };
    if (parser.fakeSnapshot)
        adapter.fakeSnapshot = parser.fakeSnapshot;
    return Object.assign(adapter, extra);
}

// `prepare(ctx)` derives the vendor's own deps from the config; when it
// throws (no key, no path) the fetch resolves to that error instead.
export function guardedFetch(prepare, fetchSnapshot) {
    return ctx => {
        let deps;
        try {
            deps = prepare(ctx);
        } catch (e) {
            return Promise.resolve(errorResult(e));
        }
        return fetchSnapshot({cache: ctx.cache, http: ctx.http, signal: ctx.signal, now: ctx.now, ...deps});
    };
}

// A vendor keyed by an API key, env var first; `extra(cfg, getenv)` adds
// what else its fetch needs from `config.vendors[vendor]`. Errors name the
// vendor by its display label unless `label` is given.
export function apiKeyFetch({label = null, vendor, fetchSnapshot, getenv, extra = () => ({})}) {
    return guardedFetch(ctx => {
        const cfg = ctx.config.vendors[vendor];
        return {apiKey: resolveApiKey(label ?? vendorLabel(vendor), cfg.apiKeyEnv, cfg.apiKey, getenv), ...extra(cfg, getenv)};
    }, fetchSnapshot);
}

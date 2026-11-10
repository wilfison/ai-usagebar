import GLib from 'gi://GLib';

import {INVALID_MAPPING} from '../fetch-common.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    customSeverity,
    customPeakUsage,
    notifyRows,
    resetCredits,
    requestHeaders,
    shortCode,
} from './parser.js';
import {buildSection} from './section.js';

// Only the inline key when no env var is named.
function apiKeyOf(cfg) {
    const fromEnv = cfg.apiKeyEnv ? GLib.getenv(cfg.apiKeyEnv) : null;
    return fromEnv || cfg.apiKey || null;
}

export const customAdapter = {
    id: 'custom',
    cacheId: 'custom',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.custom;
        if (cfg.mapping === null || cfg.extraHeaders === null)
            return Promise.resolve({ok: false, kind: 'error', code: INVALID_MAPPING, message: 'custom provider: invalid mapping or extra headers'});
        const apiKey = apiKeyOf(cfg);
        return fetchSnapshot({
            cache: ctx.cache,
            http: ctx.http,
            url: cfg.url,
            allowHttp: cfg.allowHttp,
            headers: requestHeaders(cfg, apiKey),
            apiKey,
            mapping: cfg.mapping,
            name: cfg.name,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: customSeverity,
    peakUsage: customPeakUsage,
    placeholders,
    notifyRows,
    resetCredits,
    buildSection,
    shortCode: config => shortCode(config.vendors.custom.name),
};

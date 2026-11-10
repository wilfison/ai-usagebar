import GLib from 'gi://GLib';

import {resolveApiKey, resolveOptionalKey} from '../../config-resolve.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    openrouterSeverity,
    openrouterPeakUsage,
    fakeSnapshot,
    notifyRows,
    resetCredits,
} from './parser.js';
import {buildSection} from './section.js';

export const openrouterAdapter = {
    id: 'openrouter',
    cacheId: 'openrouter',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.openrouter;
        let apiKey;
        try {
            apiKey = resolveApiKey('OpenRouter', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        const managementKey = resolveOptionalKey(cfg.managementKeyEnv, cfg.managementKey, GLib.getenv);
        return fetchSnapshot({cache: ctx.cache, http: ctx.http, apiKey, managementKey, signal: ctx.signal});
    },
    severity: openrouterSeverity,
    peakUsage: openrouterPeakUsage,
    placeholders,
    notifyRows,
    resetCredits,
    buildSection,
    fakeSnapshot,
};

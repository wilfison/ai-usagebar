import GLib from 'gi://GLib';

import {resolveApiKey} from '../../config-resolve.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    zaiSeverity,
    zaiPeakUsage,
} from './parser.js';
import {buildSection} from './section.js';

export const zaiAdapter = {
    id: 'zai',
    cacheId: 'zai',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.zai;
        let apiKey;
        try {
            apiKey = resolveApiKey('Z.AI', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return fetchSnapshot({
            cache: ctx.cache,
            http: ctx.http,
            apiKey,
            configPlanTier: cfg.planTier,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: zaiSeverity,
    peakUsage: zaiPeakUsage,
    placeholders,
    buildSection,
};

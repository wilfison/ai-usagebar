import GLib from 'gi://GLib';

import {resolveApiKey} from '../../config-resolve.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    kimiSeverity,
    kimiPeakUsage,
    fakeSnapshot,
} from './parser.js';
import {buildSection} from './section.js';

export const kimiAdapter = {
    id: 'kimi',
    cacheId: 'kimi',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.kimi;
        let apiKey;
        try {
            apiKey = resolveApiKey('Kimi', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return fetchSnapshot({
            cache: ctx.cache,
            http: ctx.http,
            apiKey,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: kimiSeverity,
    peakUsage: kimiPeakUsage,
    placeholders,
    buildSection,
    fakeSnapshot,
};

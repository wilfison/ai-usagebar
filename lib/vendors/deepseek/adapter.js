import GLib from 'gi://GLib';

import {resolveApiKey} from '../../config-resolve.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    deepseekSeverity,
    deepseekPeakUsage,
    fakeSnapshot,
} from './parser.js';
import {buildSection} from './section.js';

export const deepseekAdapter = {
    id: 'deepseek',
    cacheId: 'deepseek',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.deepseek;
        let apiKey;
        try {
            apiKey = resolveApiKey('DeepSeek', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return fetchSnapshot({cache: ctx.cache, http: ctx.http, apiKey, signal: ctx.signal});
    },
    severity: deepseekSeverity,
    peakUsage: deepseekPeakUsage,
    placeholders,
    buildSection,
    fakeSnapshot,
};

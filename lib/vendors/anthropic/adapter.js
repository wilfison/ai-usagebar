import {anthropicCredsPath} from '../../config.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    anthropicSeverity,
    anthropicPeakUsage,
    fakeSnapshot,
} from './parser.js';
import {buildSection} from './section.js';

export const anthropicAdapter = {
    id: 'anthropic',
    cacheId: 'anthropic',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        let credsPath;
        try {
            credsPath = anthropicCredsPath(ctx.config);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return fetchSnapshot({
            cache: ctx.cache,
            http: ctx.http,
            credsPath,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: anthropicSeverity,
    peakUsage: anthropicPeakUsage,
    placeholders,
    buildSection,
    fakeSnapshot,
};

import {codexAuthPath} from '../../config.js';
import {fetchSnapshot} from './main.js';
import {
    ICON,
    VENDOR_SHORT,
    placeholders,
    openaiSeverity,
    openaiPeakUsage,
    fakeSnapshot,
} from './parser.js';
import {buildSection} from './section.js';

export const openaiAdapter = {
    id: 'openai',
    cacheId: 'openai',
    icon: ICON,
    vendorShort: VENDOR_SHORT,
    fetchSnapshot(ctx) {
        let credsPath;
        try {
            credsPath = codexAuthPath(ctx.config);
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
    severity: openaiSeverity,
    peakUsage: openaiPeakUsage,
    placeholders,
    buildSection,
    fakeSnapshot,
};

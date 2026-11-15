import GLib from 'gi://GLib';

import {resolveOptionalKey} from '../../config-resolve.js';
import {INVALID_MAPPING} from '../fetch-common.js';
import {vendorAdapter} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

// No key is fine here: the endpoint may need none.
function fetchCustom(ctx) {
    const cfg = ctx.config.vendors.custom;
    if (cfg.mapping === null || cfg.extraHeaders === null)
        return Promise.resolve({ok: false, kind: 'error', code: INVALID_MAPPING, message: 'custom provider: invalid mapping or extra headers'});
    const apiKey = resolveOptionalKey(cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
    return fetchSnapshot({
        cache: ctx.cache,
        http: ctx.http,
        url: cfg.url,
        allowHttp: cfg.allowHttp,
        headers: parser.requestHeaders(cfg, apiKey),
        apiKey,
        mapping: cfg.mapping,
        name: cfg.name,
        signal: ctx.signal,
        now: ctx.now,
    });
}

export const customAdapter = vendorAdapter({
    id: 'custom',
    parser,
    peakUsage: parser.customPeakUsage,
    buildSection,
    fetchSnapshot: fetchCustom,
    extra: {
        fakeSnapshot: (pct, now, config) => ({...parser.fakeSnapshot(pct, now), name: config.vendors.custom.name}),
        shortCode: config => parser.shortCode(config.vendors.custom.name),
    },
});

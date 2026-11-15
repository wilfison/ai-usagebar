import GLib from 'gi://GLib';

import {resolveOptionalKey} from '../../config-resolve.js';
import {vendorAdapter, apiKeyFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const openrouterAdapter = vendorAdapter({
    id: 'openrouter',
    parser,
    severity: parser.openrouterSeverity,
    peakUsage: parser.openrouterPeakUsage,
    buildSection,
    fetchSnapshot: apiKeyFetch({
        label: 'OpenRouter',
        vendor: 'openrouter',
        fetchSnapshot,
        getenv: GLib.getenv,
        extra: (cfg, getenv) => ({managementKey: resolveOptionalKey(cfg.managementKeyEnv, cfg.managementKey, getenv)}),
    }),
});

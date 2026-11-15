import GLib from 'gi://GLib';

import {vendorAdapter, apiKeyFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const zaiAdapter = vendorAdapter({
    id: 'zai',
    parser,
    peakUsage: parser.zaiPeakUsage,
    buildSection,
    fetchSnapshot: apiKeyFetch({vendor: 'zai', fetchSnapshot, getenv: GLib.getenv, extra: cfg => ({configPlanTier: cfg.planTier})}),
});

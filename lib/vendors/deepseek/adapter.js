import GLib from 'gi://GLib';

import {vendorAdapter, apiKeyFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const deepseekAdapter = vendorAdapter({
    id: 'deepseek',
    parser,
    severity: parser.deepseekSeverity,
    peakUsage: parser.deepseekPeakUsage,
    buildSection,
    fetchSnapshot: apiKeyFetch({label: 'DeepSeek', vendor: 'deepseek', fetchSnapshot, getenv: GLib.getenv}),
});

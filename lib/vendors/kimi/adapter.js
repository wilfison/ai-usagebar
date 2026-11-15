import GLib from 'gi://GLib';

import {vendorAdapter, apiKeyFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const kimiAdapter = vendorAdapter({
    id: 'kimi',
    parser,
    peakUsage: parser.kimiPeakUsage,
    buildSection,
    fetchSnapshot: apiKeyFetch({vendor: 'kimi', fetchSnapshot, getenv: GLib.getenv}),
});

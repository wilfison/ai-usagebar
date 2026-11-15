import GLib from 'gi://GLib';

import {vendorAdapter, apiKeyFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const ollamaAdapter = vendorAdapter({
    id: 'ollama',
    parser,
    peakUsage: parser.ollamaPeakUsage,
    buildSection,
    fetchSnapshot: apiKeyFetch({label: 'Ollama', vendor: 'ollama', fetchSnapshot, getenv: GLib.getenv, extra: cfg => ({plan: cfg.plan})}),
});

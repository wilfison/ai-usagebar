import {anthropicCredsPath} from '../../config.js';
import {vendorAdapter, guardedFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const anthropicAdapter = vendorAdapter({
    id: 'anthropic',
    parser,
    severity: parser.anthropicSeverity,
    peakUsage: parser.anthropicPeakUsage,
    buildSection,
    fetchSnapshot: guardedFetch(ctx => ({credsPath: anthropicCredsPath(ctx.config)}), fetchSnapshot),
});

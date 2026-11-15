import {codexAuthPath} from '../../config.js';
import {vendorAdapter, guardedFetch} from '../adapter-common.js';
import {fetchSnapshot} from './main.js';
import * as parser from './parser.js';
import {buildSection} from './section.js';

export const openaiAdapter = vendorAdapter({
    id: 'openai',
    parser,
    severity: parser.openaiSeverity,
    peakUsage: parser.openaiPeakUsage,
    buildSection,
    fetchSnapshot: guardedFetch(ctx => ({credsPath: codexAuthPath(ctx.config)}), fetchSnapshot),
});

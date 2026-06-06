import system from 'system';

import {VENDOR_IDS, VENDOR_LABELS, isVendorId} from '../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

describe('VENDOR_IDS — canonical order', () => {
    it('lists vendors in fixed order', () =>
        assertDeepEqual(
            [...VENDOR_IDS],
            ['anthropic', 'openai', 'zai', 'openrouter', 'deepseek']
        ));
    it('is frozen', () => assertEqual(Object.isFrozen(VENDOR_IDS), true));
});

describe('VENDOR_LABELS', () => {
    it('aligns length with VENDOR_IDS', () =>
        assertEqual(VENDOR_LABELS.length, VENDOR_IDS.length));
    it('is frozen', () => assertEqual(Object.isFrozen(VENDOR_LABELS), true));
    it('is ordered to match VENDOR_IDS', () =>
        assertDeepEqual(
            [...VENDOR_LABELS],
            ['Anthropic', 'OpenAI', 'Z.AI', 'OpenRouter', 'DeepSeek']
        ));
});

describe('isVendorId', () => {
    it('accepts a known id', () => assertEqual(isVendorId('zai'), true));
    it('rejects an unknown id', () => assertEqual(isVendorId('gemini'), false));
    it('rejects non-strings', () => assertEqual(isVendorId(null), false));
});

system.exit(summary());

import system from 'system';

import {VENDOR_IDS, isVendorId} from '../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

describe('VENDOR_IDS — canonical order', () => {
    it('lists vendors in fixed order', () =>
        assertDeepEqual(
            [...VENDOR_IDS],
            ['anthropic', 'openai', 'zai', 'openrouter', 'deepseek'],
        ));
    it('is frozen', () => assertEqual(Object.isFrozen(VENDOR_IDS), true));
});

describe('isVendorId', () => {
    it('accepts a known id', () => assertEqual(isVendorId('zai'), true));
    it('rejects an unknown id', () => assertEqual(isVendorId('gemini'), false));
    it('rejects non-strings', () => assertEqual(isVendorId(null), false));
});

system.exit(summary());

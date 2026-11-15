import system from 'system';

import {VENDORS, VENDOR_IDS, VENDOR_LABELS, isVendorId, vendorLabel, vendorIconName, configuredNames} from '../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

describe('VENDOR_IDS: canonical order', () => {
    it('lists vendors in fixed order', () =>
        assertDeepEqual(
            [...VENDOR_IDS],
            ['anthropic', 'openai', 'zai', 'openrouter', 'deepseek', 'kimi', 'ollama', 'custom']
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
            ['Anthropic', 'OpenAI', 'Z.AI', 'OpenRouter', 'DeepSeek', 'Kimi', 'Ollama', 'Custom']
        ));
});

describe('isVendorId', () => {
    it('accepts a known id', () => assertEqual(isVendorId('zai'), true));
    it('rejects an unknown id', () => assertEqual(isVendorId('gemini'), false));
    it('rejects non-strings', () => assertEqual(isVendorId(null), false));
});

describe('vendorLabel', () => {
    it('maps a known id to its display name', () =>
        assertEqual(vendorLabel('anthropic'), 'Anthropic'));
    it('maps each id to its aligned label', () =>
        assertDeepEqual(VENDOR_IDS.map(vendorLabel), [...VENDOR_LABELS]));
    it('falls back to the id for an unknown vendor', () =>
        assertEqual(vendorLabel('gemini'), 'gemini'));
});

describe('vendorLabel: custom provider', () => {
    const config = {vendors: {custom: {name: 'My Tool'}}};
    it('uses the configured name', () => assertEqual(vendorLabel('custom', config), 'My Tool'));
    it('falls back to Custom without a config', () => assertEqual(vendorLabel('custom'), 'Custom'));
    it('leaves other vendors alone', () => assertEqual(vendorLabel('openai', config), 'OpenAI'));
});

describe('vendorIconName', () => {
    it('a vendor with a mark', () => assertEqual(vendorIconName('ollama'), 'ollama-symbolic'));
    it('the custom provider falls back to the generic mark', () => assertEqual(vendorIconName('custom'), 'ai-symbolic'));
    it('an unknown id falls back too', () => assertEqual(vendorIconName('gemini'), 'ai-symbolic'));
});

describe('VENDORS: the one table', () => {
    it('ids and labels are read from it', () => {
        assertDeepEqual(VENDORS.map(v => v.id), [...VENDOR_IDS]);
        assertDeepEqual(VENDORS.map(v => v.label), [...VENDOR_LABELS]);
    });
    it('is frozen, rows included', () => assertEqual(VENDORS.every(Object.isFrozen) && Object.isFrozen(VENDORS), true));
});

describe('configuredNames', () => {
    it('lists the names users gave their vendors', () =>
        assertDeepEqual(configuredNames({vendors: {custom: {name: 'My Tool'}}}), ['My Tool']));
});

system.exit(summary());

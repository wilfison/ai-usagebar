import system from 'system';

import {
    emptyToNull,
    resolveApiKey,
    resolveOptionalKey,
    isEnabled,
    enabledVendors,
    normalizePrimary,
    normalizeActive,
    cycleVendor,
    isPinnedMode,
    panelVendors,
    pollVendors,
    withPinned,
} from '../lib/config-resolve.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

function snapshot(overrides = {}) {
    const enabled = {
        anthropic: true,
        openai: true,
        zai: true,
        openrouter: true,
        deepseek: false,
        ...overrides.enabled,
    };
    return {
        primaryVendor: overrides.primaryVendor ?? 'anthropic',
        activeVendor: overrides.activeVendor ?? '',
        panelVendors: overrides.panelVendors ?? [],
        vendors: {
            anthropic: {enabled: enabled.anthropic},
            openai: {enabled: enabled.openai},
            zai: {enabled: enabled.zai},
            openrouter: {enabled: enabled.openrouter},
            deepseek: {enabled: enabled.deepseek},
        },
    };
}

function fakeGetenv(map) {
    return name => (name in map ? map[name] : null);
}

describe('emptyToNull', () => {
    it("'' → null", () => assertEqual(emptyToNull(''), null));
    it('non-empty passes through', () => assertEqual(emptyToNull('x'), 'x'));
});

describe('isEnabled / enabledVendors: defaults', () => {
    it('defaults enable all but DeepSeek', () => {
        const s = snapshot();
        assertEqual(isEnabled(s, 'anthropic'), true);
        assertEqual(isEnabled(s, 'openai'), true);
        assertEqual(isEnabled(s, 'zai'), true);
        assertEqual(isEnabled(s, 'openrouter'), true);
        assertEqual(isEnabled(s, 'deepseek'), false);
    });
    it('enabledVendors preserves canonical order, omits DeepSeek', () =>
        assertDeepEqual(
            enabledVendors(snapshot()),
            ['anthropic', 'openai', 'zai', 'openrouter']
        ));
    it('DeepSeek appears when enabled', () =>
        assertDeepEqual(
            enabledVendors(snapshot({enabled: {deepseek: true}})),
            ['anthropic', 'openai', 'zai', 'openrouter', 'deepseek']
        ));
});

describe('resolveApiKey', () => {
    it('prefers env over inline', () =>
        assertEqual(
            resolveApiKey('Z.AI', 'ZAI_API_KEY', 'inline-key', fakeGetenv({ZAI_API_KEY: 'from-env'})),
            'from-env'
        ));
    it('falls back to inline when env unset', () =>
        assertEqual(
            resolveApiKey('Z.AI', 'ZAI_API_KEY', 'inline-key', fakeGetenv({})),
            'inline-key'
        ));
    it('treats empty env as unset', () =>
        assertEqual(
            resolveApiKey('OpenRouter', 'OR_KEY', 'inline', fakeGetenv({OR_KEY: ''})),
            'inline'
        ));
    it('throws naming the env var and the API key when both missing', () => {
        let msg = null;
        try {
            resolveApiKey('Z.AI', 'ZAI_API_KEY', null, fakeGetenv({}));
        } catch (e) {
            msg = e.message;
        }
        assertEqual(msg !== null, true, 'expected throw');
        assertEqual(msg.includes('ZAI_API_KEY'), true, 'names env var');
        assertEqual(msg.includes('API key'), true, 'names API key');
    });
});

describe('normalizePrimary', () => {
    it('returns the primary when it is enabled', () =>
        assertEqual(normalizePrimary(snapshot({primaryVendor: 'zai'})), 'zai'));
    it('falls back to first enabled when primary disabled', () =>
        assertEqual(
            normalizePrimary(snapshot({primaryVendor: 'openai', enabled: {anthropic: false, openai: false}})),
            'zai'
        ));
    it('falls back to anthropic when nothing is enabled', () =>
        assertEqual(
            normalizePrimary(snapshot({
                primaryVendor: 'openai',
                enabled: {anthropic: false, openai: false, zai: false, openrouter: false, deepseek: false},
            })),
            'anthropic'
        ));
});

describe('normalizeActive', () => {
    it('returns the active vendor when it is enabled', () =>
        assertEqual(
            normalizeActive(snapshot({primaryVendor: 'anthropic', activeVendor: 'zai'})),
            'zai'
        ));
    it('falls back to primary when the active vendor is disabled', () =>
        assertEqual(
            normalizeActive(snapshot({
                primaryVendor: 'openai',
                activeVendor: 'deepseek',
            })),
            'openai'
        ));
    it('falls back through normalizePrimary when both active and primary are disabled', () =>
        assertEqual(
            normalizeActive(snapshot({
                primaryVendor: 'openai',
                activeVendor: 'deepseek',
                enabled: {openai: false},
            })),
            'anthropic'
        ));
    it('falls back to primary when active is unset (empty string)', () =>
        assertEqual(
            normalizeActive(snapshot({primaryVendor: 'zai', activeVendor: ''})),
            'zai'
        ));
});

describe('cycleVendor', () => {
    const list = ['anthropic', 'openai', 'zai'];
    it('steps forward', () => assertEqual(cycleVendor(list, 'anthropic', +1), 'openai'));
    it('steps backward', () => assertEqual(cycleVendor(list, 'openai', -1), 'anthropic'));
    it('wraps forward past the end', () => assertEqual(cycleVendor(list, 'zai', +1), 'anthropic'));
    it('wraps backward past the start', () => assertEqual(cycleVendor(list, 'anthropic', -1), 'zai'));
    it('returns the first element for +1 when current is absent', () =>
        assertEqual(cycleVendor(list, 'deepseek', +1), 'anthropic'));
    it('returns the last element for -1 when current is absent', () =>
        assertEqual(cycleVendor(list, 'deepseek', -1), 'zai'));
    it('single-element list returns itself', () =>
        assertEqual(cycleVendor(['zai'], 'zai', +1), 'zai'));
    it('empty list returns current unchanged', () =>
        assertEqual(cycleVendor([], 'zai', +1), 'zai'));
});


describe('resolveOptionalKey', () => {
    const env = {MGMT: 'from-env'};
    const getenv = k => env[k] ?? null;
    it('env wins over inline', () => assertEqual(resolveOptionalKey('MGMT', 'inline', getenv), 'from-env'));
    it('inline when the env var is unset', () => assertEqual(resolveOptionalKey('UNSET', 'inline', getenv), 'inline'));
    it('null, never an error, when neither is set', () => assertEqual(resolveOptionalKey('UNSET', null, getenv), null));
    it('an empty env var name reads only the inline key', () => assertEqual(resolveOptionalKey('', null, getenv), null));
});

describe('panelVendors / isPinnedMode / pollVendors', () => {
    it('nothing pinned: single mode, the active vendor alone', () => {
        const s = snapshot({activeVendor: 'openai'});
        assertEqual(isPinnedMode(s), false);
        assertDeepEqual(panelVendors(s), ['openai']);
        assertDeepEqual(pollVendors(s), ['openai']);
    });
    it('a pinned but disabled vendor is skipped', () => {
        const s = snapshot({panelVendors: ['openai', 'deepseek']});
        assertDeepEqual(panelVendors(s), ['openai']);
    });
    it('every pinned vendor disabled falls back to single mode', () => {
        const s = snapshot({panelVendors: ['deepseek'], activeVendor: 'zai'});
        assertEqual(isPinnedMode(s), false);
        assertDeepEqual(panelVendors(s), ['zai']);
    });
    it('segments follow VENDOR_IDS order, not the stored order', () => {
        const s = snapshot({panelVendors: ['openrouter', 'anthropic', 'zai']});
        assertEqual(isPinnedMode(s), true);
        assertDeepEqual(panelVendors(s), ['anthropic', 'zai', 'openrouter']);
    });
    it('an unpinned active vendor is polled but gets no segment', () => {
        const s = snapshot({panelVendors: ['openai', 'zai'], activeVendor: 'anthropic'});
        assertDeepEqual(panelVendors(s), ['openai', 'zai']);
        assertDeepEqual(pollVendors(s), ['openai', 'zai', 'anthropic']);
    });
    it('a pinned active vendor is polled once', () => {
        const s = snapshot({panelVendors: ['openai', 'zai'], activeVendor: 'zai'});
        assertDeepEqual(pollVendors(s), ['openai', 'zai']);
    });
});

describe('withPinned', () => {
    it('adds in VENDOR_IDS order', () => assertDeepEqual(withPinned(['zai'], 'anthropic', true), ['anthropic', 'zai']));
    it('removes', () => assertDeepEqual(withPinned(['anthropic', 'zai'], 'zai', false), ['anthropic']));
    it('is idempotent', () => {
        assertDeepEqual(withPinned(['zai'], 'zai', true), ['zai']);
        assertDeepEqual(withPinned(['zai'], 'openai', false), ['zai']);
    });
    it('drops unknown and repeated ids', () => assertDeepEqual(withPinned(['zai', 'zai', 'nope'], 'kimi', true), ['zai', 'kimi']));
});

system.exit(summary());

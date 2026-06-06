import system from 'system';

import {
    emptyToNull,
    resolveApiKey,
    isEnabled,
    enabledVendors,
    normalizePrimary,
} from '../lib/config-resolve.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

/**
 * Build a snapshot-like object with the given per-vendor enabled flags. Defaults
 * mirror the GSettings defaults: every vendor enabled except DeepSeek.
 */
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
        vendors: {
            anthropic: {enabled: enabled.anthropic},
            openai: {enabled: enabled.openai},
            zai: {enabled: enabled.zai},
            openrouter: {enabled: enabled.openrouter},
            deepseek: {enabled: enabled.deepseek},
        },
    };
}

/** Fake getenv backed by a plain object. Missing keys return null. */
function fakeGetenv(map) {
    return name => (name in map ? map[name] : null);
}

describe('emptyToNull', () => {
    it("'' → null", () => assertEqual(emptyToNull(''), null));
    it('non-empty passes through', () => assertEqual(emptyToNull('x'), 'x'));
});

describe('isEnabled / enabledVendors — defaults', () => {
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
            ['anthropic', 'openai', 'zai', 'openrouter'],
        ));
    it('DeepSeek appears when enabled', () =>
        assertDeepEqual(
            enabledVendors(snapshot({enabled: {deepseek: true}})),
            ['anthropic', 'openai', 'zai', 'openrouter', 'deepseek'],
        ));
});

describe('resolveApiKey', () => {
    it('prefers env over inline', () =>
        assertEqual(
            resolveApiKey('Z.AI', 'ZAI_API_KEY', 'inline-key', fakeGetenv({ZAI_API_KEY: 'from-env'})),
            'from-env',
        ));
    it('falls back to inline when env unset', () =>
        assertEqual(
            resolveApiKey('Z.AI', 'ZAI_API_KEY', 'inline-key', fakeGetenv({})),
            'inline-key',
        ));
    it('treats empty env as unset', () =>
        assertEqual(
            resolveApiKey('OpenRouter', 'OR_KEY', 'inline', fakeGetenv({OR_KEY: ''})),
            'inline',
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
            'zai',
        ));
    it('falls back to anthropic when nothing is enabled', () =>
        assertEqual(
            normalizePrimary(snapshot({
                primaryVendor: 'openai',
                enabled: {anthropic: false, openai: false, zai: false, openrouter: false, deepseek: false},
            })),
            'anthropic',
        ));
});

system.exit(summary());

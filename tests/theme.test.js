import system from 'system';

import {defaultTheme, withOverrides, hexBlend} from '../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, assertThrows, summary} from './_assert.js';

describe('defaultTheme', () => {
    it('exposes exactly the 9 expected keys', () => {
        const t = defaultTheme();
        const keys = Object.keys(t).sort();
        assertDeepEqual(
            keys,
            ['barEmpty', 'blue', 'dim', 'fg', 'green', 'marker', 'orange', 'red', 'yellow']
        );
    });

    it('matches the One-Dark palette byte-for-byte', () => {
        const t = defaultTheme();
        assertEqual(t.green, '#98c379');
        assertEqual(t.yellow, '#e5c07b');
        assertEqual(t.orange, '#d19a66');
        assertEqual(t.red, '#e06c75');
        assertEqual(t.blue, '#61afef');
        assertEqual(t.dim, '#5c6370');
        assertEqual(t.fg, '#abb2bf');
        assertEqual(t.barEmpty, '#3e4451');
        assertEqual(t.marker, '#d19a66');
    });

    it('is frozen', () => {
        const t = defaultTheme();
        assertThrows(() => { t.green = '#000000'; }, 'expected mutation of frozen theme to throw');
    });
});

describe('withOverrides', () => {
    it('mid maps to yellow', () => {
        const before = defaultTheme();
        const after = withOverrides(before, {mid: '#abcdef'});
        assertEqual(after.yellow, '#abcdef');
        // original unchanged
        assertEqual(before.yellow, '#e5c07b');
    });

    it('low/mid/high/critical map to green/yellow/orange/red', () => {
        const t = withOverrides(defaultTheme(), {
            low: '#111111',
            mid: '#222222',
            high: '#333333',
            critical: '#444444',
        });
        assertEqual(t.green, '#111111');
        assertEqual(t.yellow, '#222222');
        assertEqual(t.orange, '#333333');
        assertEqual(t.red, '#444444');
    });

    it('ignores null and undefined fields', () => {
        const before = defaultTheme();
        const after = withOverrides(before, {low: null, high: undefined, critical: '#000000'});
        assertEqual(after.green, before.green);
        assertEqual(after.orange, before.orange);
        assertEqual(after.red, '#000000');
    });

    it('returns a frozen palette', () => {
        const t = withOverrides(defaultTheme(), {mid: '#abcdef'});
        assertThrows(() => { t.yellow = '#000000'; });
    });

    it('no overrides arg returns a fresh palette equal to input', () => {
        const before = defaultTheme();
        const after = withOverrides(before);
        assertEqual(after.green, before.green);
        assertEqual(after.barEmpty, before.barEmpty);
    });
});

describe('hexBlend', () => {
    it('#000000 + #ffffff → #7f7f7f', () => {
        assertEqual(hexBlend('#000000', '#ffffff'), '#7f7f7f');
    });

    it('#ff0000 + #0000ff → #7f007f', () => {
        assertEqual(hexBlend('#ff0000', '#0000ff'), '#7f007f');
    });

    it('strips optional leading #', () => {
        assertEqual(hexBlend('000000', 'ffffff'), '#7f7f7f');
    });

    it('non-hex input returns null', () => {
        assertEqual(hexBlend('not-hex', '#000000'), null);
    });

    it('wrong length returns null', () => {
        assertEqual(hexBlend('#ff00', '#000000'), null);
        assertEqual(hexBlend('#fff', '#000000'), null);
    });

    it('non-string input returns null', () => {
        assertEqual(hexBlend(null, '#000000'), null);
        assertEqual(hexBlend('#000000', undefined), null);
    });
});

describe('indicator color resolution (config.colors)', () => {
    // Mirrors ui/indicator.js._rebuildTheme(): withOverrides(defaultTheme(),
    // config.colors), where config.colors is the {low,mid,high,critical} map
    // readConfig() produces (each value a hex string or null when unset).
    it('a colors map resolves each tier to its override', () => {
        const colors = {low: '#101010', mid: '#202020', high: '#303030', critical: '#404040'};
        const t = withOverrides(defaultTheme(), colors);
        assertEqual(t.green, '#101010');
        assertEqual(t.yellow, '#202020');
        assertEqual(t.orange, '#303030');
        assertEqual(t.red, '#404040');
    });

    it('null tiers fall back to the One-Dark default', () => {
        const def = defaultTheme();
        const colors = {low: null, mid: null, high: null, critical: '#ff00ff'};
        const t = withOverrides(def, colors);
        assertEqual(t.green, def.green);
        assertEqual(t.yellow, def.yellow);
        assertEqual(t.orange, def.orange);
        assertEqual(t.red, '#ff00ff');
    });

    it('an all-null map equals the default palette', () => {
        const def = defaultTheme();
        const t = withOverrides(def, {low: null, mid: null, high: null, critical: null});
        assertEqual(t.green, def.green);
        assertEqual(t.yellow, def.yellow);
        assertEqual(t.orange, def.orange);
        assertEqual(t.red, def.red);
    });
});

system.exit(summary());

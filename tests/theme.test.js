// SPDX-License-Identifier: GPL-2.0-or-later

import system from 'system';

import {defaultTheme, withOverrides, hexBlend} from '../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, assertThrows, summary} from './_assert.js';

describe('defaultTheme', () => {
    it('exposes exactly the 9 expected keys', () => {
        const t = defaultTheme();
        const keys = Object.keys(t).sort();
        assertDeepEqual(
            keys,
            ['barEmpty', 'blue', 'dim', 'fg', 'green', 'marker', 'orange', 'red', 'yellow'],
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

system.exit(summary());

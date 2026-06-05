// SPDX-License-Identifier: GPL-2.0-or-later

import system from 'system';

import {
    substitute,
    localTimeHm,
    localTimeHms,
    updatedAtHm,
    updatedAtHms,
} from '../lib/format.js';
import {describe, it, assertEqual, summary} from './_assert.js';

describe('substitute', () => {
    it('empty template', () => {
        assertEqual(substitute('', {a: '1'}), '');
    });

    it('no placeholders', () => {
        assertEqual(substitute('plain text', {}), 'plain text');
    });

    it('single substitution', () => {
        assertEqual(substitute('{name}', {name: 'cld'}), 'cld');
    });

    it('multiple substitutions', () => {
        assertEqual(substitute('{a}/{b}', {a: '1', b: '2'}), '1/2');
    });

    it('unknown placeholder passes through literal', () => {
        assertEqual(substitute('{unknown}', {}), '{unknown}');
    });

    it('single-pass: replacement containing {x} is not re-scanned', () => {
        assertEqual(substitute('{a}', {a: '{b}', b: 'X'}), '{b}');
    });

    it('unmatched left brace stays literal', () => {
        assertEqual(substitute('{a', {a: '1'}), '{a');
    });

    it('unmatched right brace stays literal', () => {
        assertEqual(substitute('a}', {a: '1'}), 'a}');
    });

    it('UTF-8 keys and values', () => {
        assertEqual(substitute('{ключ}', {'ключ': 'значение'}), 'значение');
    });

    it('Map input', () => {
        assertEqual(substitute('{a}', new Map([['a', '1']])), '1');
    });
});

describe('time formatting', () => {
    // Local-time anchor; relative offsets are computed off this.
    const anchor = new Date(2026, 5, 5, 14, 7, 3);

    it('localTimeHm zero-pads minutes', () => {
        assertEqual(localTimeHm(new Date(2026, 0, 1, 9, 5)), '09:05');
    });

    it('localTimeHm at anchor', () => {
        assertEqual(localTimeHm(anchor), '14:07');
    });

    it('localTimeHms at anchor', () => {
        assertEqual(localTimeHms(anchor), '14:07:03');
    });

    it('updatedAtHm(now, null) → —', () => {
        assertEqual(updatedAtHm(anchor, null), '—');
    });

    it('updatedAtHms(now, null) → —', () => {
        assertEqual(updatedAtHms(anchor, null), '—');
    });

    it('updatedAtHm subtracts cacheAgeMs', () => {
        // 5 minutes ago → 14:02
        assertEqual(updatedAtHm(anchor, 5 * 60 * 1000), '14:02');
    });

    it('updatedAtHms subtracts cacheAgeMs', () => {
        // 5 minutes + 3 seconds ago → 14:02:00
        assertEqual(updatedAtHms(anchor, 5 * 60 * 1000 + 3000), '14:02:00');
    });
});

system.exit(summary());

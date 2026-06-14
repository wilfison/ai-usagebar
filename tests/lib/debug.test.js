import system from 'system';

import {parseFakePct} from '../../lib/debug.js';
import {describe, it, assertEqual, summary} from '../_assert.js';

describe('parseFakePct', () => {
    it('returns null when unset or blank', () => {
        assertEqual(parseFakePct(null), null);
        assertEqual(parseFakePct(undefined), null);
        assertEqual(parseFakePct(''), null);
        assertEqual(parseFakePct('   '), null);
    });

    it('returns null for non-numeric input', () => {
        assertEqual(parseFakePct('abc'), null);
        assertEqual(parseFakePct('12%'), null);
        assertEqual(parseFakePct('NaN'), null);
    });

    it('parses integers and floats', () => {
        assertEqual(parseFakePct('23'), 23);
        assertEqual(parseFakePct(' 5 '), 5);
        assertEqual(parseFakePct('42.7'), 42.7);
        assertEqual(parseFakePct(0), 0);
    });

    it('clamps to 0..100', () => {
        assertEqual(parseFakePct('-10'), 0);
        assertEqual(parseFakePct('150'), 100);
        assertEqual(parseFakePct('100'), 100);
    });
});

system.exit(summary());

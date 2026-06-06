import system from 'system';

import {tooltipRows} from '../lib/format.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

describe('tooltipRows', () => {
    it('empty template yields no rows', () => {
        assertDeepEqual(tooltipRows('', {a: '1'}), []);
    });

    it('whitespace-only template yields no rows', () => {
        assertDeepEqual(tooltipRows('   \n  ', {a: '1'}), []);
    });

    it('null template yields no rows', () => {
        assertDeepEqual(tooltipRows(null, {a: '1'}), []);
    });

    it('undefined template yields no rows', () => {
        assertDeepEqual(tooltipRows(undefined, {a: '1'}), []);
    });

    it('single line becomes one text row with placeholders substituted', () => {
        assertDeepEqual(
            tooltipRows('{plan} — {pct}% used', {plan: 'Pro', pct: '42'}),
            [{kind: 'text', text: 'Pro — 42% used'}],
        );
    });

    it('splits on newlines into one row per line', () => {
        assertDeepEqual(
            tooltipRows('a\nb\nc', {}),
            [{kind: 'text', text: 'a'}, {kind: 'text', text: 'b'}, {kind: 'text', text: 'c'}],
        );
    });

    it('drops a single leading and trailing blank line', () => {
        assertDeepEqual(
            tooltipRows('\n{plan}\n', {plan: 'Pro'}),
            [{kind: 'text', text: 'Pro'}],
        );
    });

    it('keeps interior blank lines', () => {
        const rows = tooltipRows('a\n\nb', {});
        assertEqual(rows.length, 3);
        assertEqual(rows[1].text, '');
    });

    it('accepts a Map of values', () => {
        const m = new Map([['plan', 'Max']]);
        assertDeepEqual(tooltipRows('{plan}', m), [{kind: 'text', text: 'Max'}]);
    });

    it('unknown placeholders pass through literally', () => {
        assertDeepEqual(
            tooltipRows('{plan} {missing}', {plan: 'Pro'}),
            [{kind: 'text', text: 'Pro {missing}'}],
        );
    });
});

system.exit(summary());

import system from 'system';

import {encodeSnapshot, decodeSnapshot} from '../../../lib/vendors/snapshot-cache.js';
import {SchemaError} from '../../../lib/vendors/parse-common.js';
import {describe, it, assertEqual, assertDeepEqual, assertThrows, summary} from '../../_assert.js';

const SNAP = {
    plan: 'Pro',
    session: {utilizationPct: 42, resetsAt: new Date('2026-06-05T12:00:00Z'), windowMs: 18_000_000},
    weekly: null,
    scoped: [{label: 'Fable', resetsAt: null}],
};

describe('encodeSnapshot / decodeSnapshot', () => {
    it('round-trips a snapshot, reviving dates', () => {
        const back = decodeSnapshot(encodeSnapshot(SNAP, 1), 1);
        assertEqual(back.session.resetsAt instanceof Date, true);
        assertEqual(back.session.resetsAt.getTime(), SNAP.session.resetsAt.getTime());
        assertDeepEqual(back.scoped, SNAP.scoped);
        assertEqual(back.weekly, null);
    });

    it('accepts Uint8Array bytes', () => {
        const bytes = new TextEncoder().encode(encodeSnapshot(SNAP, 3));
        assertEqual(decodeSnapshot(bytes, 3).plan, 'Pro');
    });

    it('rejects another version, a missing version and a raw body', () => {
        const thrown = (text) => {
            try {
                decodeSnapshot(text, 2);
            } catch (e) {
                return e instanceof SchemaError;
            }
            return false;
        };
        assertEqual(thrown(encodeSnapshot(SNAP, 1)), true);
        assertEqual(thrown(JSON.stringify({snapshot: SNAP})), true);
        assertEqual(thrown('{"five_hour":{"utilization":42}}'), true);
        assertEqual(thrown('not json'), true);
        assertEqual(thrown('{"cacheVersion":2,"snapshot":null}'), true);
    });

    it('leaves ordinary objects alone', () =>
        assertDeepEqual(decodeSnapshot(encodeSnapshot({a: {b: 1}}, 1), 1), {a: {b: 1}}));

    it('throws on unparseable text', () => assertThrows(() => decodeSnapshot('{', 1)));
});

system.exit(summary());

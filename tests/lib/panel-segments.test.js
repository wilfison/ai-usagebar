import system from 'system';

import {segmentModel, nearestSegment, Tone} from '../../lib/panel-segments.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

const adapter = {
    placeholders: snapshot => new Map([
        ['session_pct', String(snapshot.pct)],
        ['session_reset', '1h 12m'],
        ['session_pace', '↑'],
    ]),
    severity: snapshot => (snapshot.pct >= 90 ? 'critical' : 'low'),
};
const opts = {adapter, barFormat: '{session_pct}% · {session_reset}'};
const ok = (pct, extra = {}) => ({ok: true, snapshot: {pct}, stale: false, lastError: null, cacheAgeMs: 0, ...extra});

describe('segmentModel', () => {
    it('ok: the bar format filled in, colored by severity', () => {
        assertDeepEqual(segmentModel(ok(42), opts), {text: '42% · 1h 12m', tone: Tone.SEVERITY, severity: 'low'});
        assertEqual(segmentModel(ok(95), opts).severity, 'critical');
    });
    it('ok and stale: the stale mark', () => assertEqual(segmentModel(ok(42, {stale: true}), opts).text, '42% · 1h 12m ⏸'));
    it('ok with pace arrows', () => assertEqual(segmentModel(ok(42), {...opts, paceArrows: true}).text, '42% · 1h 12m ↑'));
    it('loading alone spells it out, translated', () => {
        const m = segmentModel({ok: false, kind: 'loading'}, opts, s => `[${s}]`);
        assertDeepEqual(m, {text: '[Loading…]', tone: Tone.PLAIN, severity: null});
    });
    it('loading beside other segments is a short mark', () =>
        assertEqual(segmentModel({ok: false, kind: 'loading'}, {...opts, alone: false}).text, '…'));
    it('no result yet reads as loading', () => {
        assertEqual(segmentModel(undefined, opts).text, 'Loading…');
        assertEqual(segmentModel(undefined, {...opts, alone: false}).text, '…');
    });
    it('error: the warning mark at critical severity', () =>
        assertDeepEqual(segmentModel({ok: false, kind: 'error', message: 'x'}, {...opts, alone: false}),
            {text: '⚠', tone: Tone.SEVERITY, severity: 'critical'}));
});

describe('nearestSegment', () => {
    // anthropic covers [100, 150), openai [162, 202): a 12 px gap between them.
    const spans = [
        {id: 'anthropic', x: 100, width: 50},
        {id: 'openai', x: 162, width: 40},
    ];
    it('inside a span', () => {
        assertEqual(nearestSegment(120, spans), 'anthropic');
        assertEqual(nearestSegment(170, spans), 'openai');
        assertEqual(nearestSegment(201, spans), 'openai');
    });
    it('in the gap, the closer span', () => {
        assertEqual(nearestSegment(152, spans), 'anthropic');
        assertEqual(nearestSegment(160, spans), 'openai');
    });
    it("in the button's padding, the outermost span", () => {
        assertEqual(nearestSegment(90, spans), 'anthropic');
        assertEqual(nearestSegment(210, spans), 'openai');
    });
    it('a shared edge belongs to the span on its right', () => {
        const touching = [{id: 'a', x: 0, width: 10}, {id: 'b', x: 10, width: 10}];
        assertEqual(nearestSegment(9, touching), 'a');
        assertEqual(nearestSegment(10, touching), 'b');
    });
    it('a single span takes every click', () => assertEqual(nearestSegment(5, [{id: 'a', x: 100, width: 10}]), 'a'));
    it('no spans', () => assertEqual(nearestSegment(0, []), null));
});

system.exit(summary());

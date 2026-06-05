import system from 'system';

import {
    calc,
    Pace,
    paceGlyph,
    paceSeverity,
    PaceSeverity,
    DEFAULT_TOLERANCE,
} from '../lib/pacing.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FIVE_H = 5 * HOUR;

const now = new Date(2026, 4, 23, 12, 0, 0);
const at = offsetMs => new Date(now.getTime() + offsetMs);

const NEUTRAL = {
    elapsedPct: 0,
    ratioPace: Pace.ON_TRACK,
    pointPace: Pace.ON_TRACK,
    delta: 0,
    ratioLabel: 'on track',
    pointLabel: 'on track',
};

describe('calc — neutral / clamp branches', () => {
    it('missing reset returns neutral', () => {
        assertDeepEqual(
            calc({usagePct: 50, reset: null, now, windowMs: FIVE_H, tolerance: DEFAULT_TOLERANCE}),
            NEUTRAL,
        );
    });

    it('zero window returns neutral', () => {
        assertDeepEqual(
            calc({usagePct: 50, reset: now, now, windowMs: 0, tolerance: 5}),
            NEUTRAL,
        );
    });

    it('elapsedPct clamps to 0 when future reset is beyond window', () => {
        const p = calc({usagePct: 10, reset: at(6 * HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.elapsedPct, 0);
    });

    it('elapsedPct clamps to 100 when past reset', () => {
        const p = calc({usagePct: 50, reset: at(-HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.elapsedPct, 100);
    });
});

describe('calc — pacing math', () => {
    it('perfectly even pacing is on track (both metrics)', () => {
        const p = calc({usagePct: 50, reset: at(150 * MINUTE), now, windowMs: FIVE_H, tolerance: DEFAULT_TOLERANCE});
        assertEqual(p.elapsedPct, 50);
        assertEqual(p.delta, 0);
        assertEqual(p.ratioPace, Pace.ON_TRACK);
        assertEqual(p.pointPace, Pace.ON_TRACK);
        assertEqual(p.ratioLabel, 'on track');
        assertEqual(p.pointLabel, 'on track');
    });

    it('ahead of pace above tolerance: 50% elapsed / 70% usage', () => {
        const p = calc({usagePct: 70, reset: at(150 * MINUTE), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.delta, 20);
        assertEqual(p.pointPace, Pace.AHEAD);
        assertEqual(p.pointLabel, '20pts ahead');
        assertEqual(p.ratioPace, Pace.AHEAD);
        assertEqual(p.ratioLabel, '40% ahead');
    });

    it('under pace below tolerance: 50% elapsed / 30% usage', () => {
        const p = calc({usagePct: 30, reset: at(150 * MINUTE), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.delta, -20);
        assertEqual(p.pointPace, Pace.UNDER);
        assertEqual(p.pointLabel, '20pts under');
        assertEqual(p.ratioPace, Pace.UNDER);
        assertEqual(p.ratioLabel, '40% under');
    });

    it('within tolerance band: ratio on track, point diverges', () => {
        // 50% elapsed, 52% usage → ratio 104% (within ±5) → on track,
        // BUT point delta = 2 → point ahead.
        const p = calc({usagePct: 52, reset: at(150 * MINUTE), now, windowMs: FIVE_H, tolerance: DEFAULT_TOLERANCE});
        assertEqual(p.ratioPace, Pace.ON_TRACK);
        assertEqual(p.ratioLabel, 'on track');
        assertEqual(p.pointPace, Pace.AHEAD);
        assertEqual(p.pointLabel, '2pts ahead');
    });

    it('tolerance upper edge: exactly +5 pp → on track, +6 → ahead (elapsed=100)', () => {
        // elapsed=100 makes pacingX100 == usagePct, so the band edge is exact.
        const onEdge = calc({usagePct: 105, reset: at(-HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(onEdge.ratioPace, Pace.ON_TRACK);
        const justOver = calc({usagePct: 106, reset: at(-HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(justOver.ratioPace, Pace.AHEAD);
    });

    it('tolerance lower edge: exactly -5 pp → on track, -6 → under (elapsed=100)', () => {
        const onEdge = calc({usagePct: 95, reset: at(-HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(onEdge.ratioPace, Pace.ON_TRACK);
        const justUnder = calc({usagePct: 94, reset: at(-HOUR), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(justUnder.ratioPace, Pace.UNDER);
    });

    it('ratio clamps at 999 (1% elapsed, 60% usage)', () => {
        // 297 minutes remain of 300 → 1% elapsed; pacingX100 = 6000 → dev 5900 → clamp 999.
        const p = calc({usagePct: 60, reset: at(297 * MINUTE), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.elapsedPct, 1);
        assertEqual(p.ratioLabel, '999% ahead');
        assertEqual(p.ratioPace, Pace.AHEAD);
    });

    it('zero elapsed skips ratio but point math still runs', () => {
        const p = calc({usagePct: 20, reset: at(FIVE_H), now, windowMs: FIVE_H, tolerance: 5});
        assertEqual(p.elapsedPct, 0);
        assertEqual(p.ratioPace, Pace.ON_TRACK);
        assertEqual(p.delta, 20);
        assertEqual(p.pointPace, Pace.AHEAD);
    });
});

describe('paceGlyph', () => {
    it('AHEAD → ↑', () => assertEqual(paceGlyph(Pace.AHEAD), '↑'));
    it('ON_TRACK → →', () => assertEqual(paceGlyph(Pace.ON_TRACK), '→'));
    it('UNDER → ↓', () => assertEqual(paceGlyph(Pace.UNDER), '↓'));
});

describe('paceSeverity', () => {
    it('15 → critical', () => assertEqual(paceSeverity(15), PaceSeverity.CRITICAL));
    it('10 → critical (lower edge)', () => assertEqual(paceSeverity(10), PaceSeverity.CRITICAL));
    it('9 → high (upper edge)', () => assertEqual(paceSeverity(9), PaceSeverity.HIGH));
    it('1 → high (lower edge)', () => assertEqual(paceSeverity(1), PaceSeverity.HIGH));
    it('0 → mid', () => assertEqual(paceSeverity(0), PaceSeverity.MID));
    it('-10 → mid (lower edge of band)', () => assertEqual(paceSeverity(-10), PaceSeverity.MID));
    it('-11 → low (just past the -10 boundary)', () => assertEqual(paceSeverity(-11), PaceSeverity.LOW));
    it('-100 → low', () => assertEqual(paceSeverity(-100), PaceSeverity.LOW));
});

system.exit(summary());

import system from 'system';

import {
    calc,
    Pace,
    paceGlyph,
    PaceVerdict,
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
    state: 'neutral',
    projectedPct: null,
    runsOutAt: null,
    verdict: null,
    now,
};

describe('calc: neutral / clamp branches', () => {
    it('missing reset returns neutral', () => {
        assertDeepEqual(
            calc({usagePct: 50, reset: null, now, windowMs: FIVE_H, tolerance: DEFAULT_TOLERANCE}),
            NEUTRAL
        );
    });

    it('zero window returns neutral', () => {
        assertDeepEqual(
            calc({usagePct: 50, reset: now, now, windowMs: 0, tolerance: 5}),
            NEUTRAL
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

describe('calc: pacing math', () => {
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

describe('calc: state', () => {
    const WEEK = 7 * 24 * HOUR;
    const DAY = 24 * HOUR;
    // Reset `elapsed` into a window of `windowMs`.
    const into = (windowMs, elapsed) => at(windowMs - elapsed);

    it('no reset → neutral', () => {
        assertEqual(calc({usagePct: 30, reset: null, now, windowMs: FIVE_H}).state, 'neutral');
    });

    it('zero window → neutral', () => {
        assertEqual(calc({usagePct: 30, reset: now, now, windowMs: 0}).state, 'neutral');
    });

    it('100% → limit, even early in the window', () => {
        assertEqual(calc({usagePct: 100, reset: into(WEEK, MINUTE), now, windowMs: WEEK}).state, 'limit');
        assertEqual(calc({usagePct: 100, reset: into(FIVE_H, 3 * HOUR), now, windowMs: FIVE_H}).state, 'limit');
    });

    it('a weekly window estimates for its first hour (1% capped at 1 h)', () => {
        assertEqual(calc({usagePct: 7, reset: into(WEEK, 59 * MINUTE), now, windowMs: WEEK}).state, 'estimating');
        assertEqual(calc({usagePct: 7, reset: into(WEEK, HOUR), now, windowMs: WEEK}).state, 'ok');
    });

    it('a 5h window estimates for 1% of it (3 min)', () => {
        assertEqual(calc({usagePct: 7, reset: into(FIVE_H, 2 * MINUTE), now, windowMs: FIVE_H}).state, 'estimating');
        assertEqual(calc({usagePct: 7, reset: into(FIVE_H, 3 * MINUTE), now, windowMs: FIVE_H}).state, 'ok');
    });

    it('a short window estimates for at least 60 s', () => {
        const window = 10 * MINUTE; // 1% = 6 s, floored to 60 s
        assertEqual(calc({usagePct: 7, reset: into(window, 59 * 1000), now, windowMs: window}).state, 'estimating');
        assertEqual(calc({usagePct: 7, reset: into(window, MINUTE), now, windowMs: window}).state, 'ok');
    });

    it('a 30-day window caps the estimate at 1 h', () => {
        const month = 30 * DAY;
        assertEqual(calc({usagePct: 7, reset: into(month, 2 * HOUR), now, windowMs: month}).state, 'ok');
    });

    it('zero usage is never estimating', () => {
        assertEqual(calc({usagePct: 0, reset: into(WEEK, MINUTE), now, windowMs: WEEK}).state, 'ok');
    });

    it('a reset already in the past is not estimating', () => {
        assertEqual(calc({usagePct: 7, reset: at(-MINUTE), now, windowMs: WEEK}).state, 'ok');
    });
});

describe('calc: verdict', () => {
    const WEEK = 168 * HOUR;
    // `usagePct` used `elapsed` into a window of `windowMs`.
    const paced = (usagePct, elapsed, windowMs) =>
        calc({usagePct, reset: at(windowMs - elapsed), now, windowMs});

    it('4% at 7 h of a week: on the line → calm', () => {
        const p = paced(4, 7 * HOUR, WEEK);
        assertEqual(Math.round(p.projectedPct), 96);
        assertEqual(p.verdict, PaceVerdict.CALM);
    });

    it('7% at 8 h of a week: 147% projected but 2.2 pts past → calm', () => {
        const p = paced(7, 8 * HOUR, WEEK);
        assertEqual(Math.round(p.projectedPct), 147);
        assertEqual(p.delta, 3); // the rounded delta alone would cross the gap edge
        assertEqual(p.verdict, PaceVerdict.CALM);
    });

    it('60% at half of 5 h: 120% projected, 10 pts past → over', () => {
        const p = paced(60, 150 * MINUTE, FIVE_H);
        assertEqual(p.projectedPct, 120);
        assertEqual(p.verdict, PaceVerdict.OVER);
        assertEqual(p.runsOutAt, null);
    });

    it('70% at half of 5 h: 140% projected, 20 pts past → critical', () => {
        const p = paced(70, 150 * MINUTE, FIVE_H);
        assertEqual(p.projectedPct, 140);
        assertEqual(p.verdict, PaceVerdict.CRITICAL);
    });

    it('92% at 4.5 h of 5 h: under 10% left and over the line → critical', () => {
        const p = paced(92, 270 * MINUTE, FIVE_H);
        assertEqual(p.verdict, PaceVerdict.CRITICAL);
    });

    it('55% at half of 5 h: exactly 110% projected → calm', () => {
        const p = paced(55, 150 * MINUTE, FIVE_H);
        assertEqual(p.projectedPct, 110);
        assertEqual(p.verdict, PaceVerdict.CALM);
    });

    it('10% at 8 h of a week: ~210% projected, early with 90% left → over, not critical', () => {
        const p = paced(10, 8 * HOUR, WEEK);
        assertEqual(Math.round(p.projectedPct), 210);
        assertEqual(p.verdict, PaceVerdict.OVER);
        assertEqual(p.runsOutAt, null);
    });

    it('55% at 8 h of a week: a heavy early burn is still critical', () => {
        const p = paced(55, 8 * HOUR, WEEK);
        assertEqual(p.verdict, PaceVerdict.CRITICAL);
        assertEqual(p.runsOutAt instanceof Date, true);
    });

    it('the early tolerance ends at 15% of the window', () => {
        // 30% at 16% of a week: past the opening stretch, 187% projected → critical.
        assertEqual(paced(30, 0.16 * WEEK, WEEK).verdict, PaceVerdict.CRITICAL);
        // Same burn at 14%: still the opening stretch → over.
        assertEqual(paced(30, 0.14 * WEEK, WEEK).verdict, PaceVerdict.OVER);
    });

    it('exactly 50% left still counts as healthy early on', () => {
        assertEqual(paced(50, 0.1 * WEEK, WEEK).verdict, PaceVerdict.OVER);
        assertEqual(paced(51, 0.1 * WEEK, WEEK).verdict, PaceVerdict.CRITICAL);
    });

    it('nearly spent is critical even early in the window', () => {
        assertEqual(paced(95, 0.1 * WEEK, WEEK).verdict, PaceVerdict.CRITICAL);
    });

    it('limit, estimating and neutral states have no verdict', () => {
        assertEqual(paced(100, 2 * HOUR, FIVE_H).verdict, null);
        assertEqual(paced(5, 30 * MINUTE, WEEK).state, 'estimating');
        assertEqual(paced(5, 30 * MINUTE, WEEK).verdict, null);
        assertEqual(calc({usagePct: 50, reset: null, now, windowMs: FIVE_H}).verdict, null);
    });

    it('no projection at the very start of the window', () => {
        const p = paced(0, 0, FIVE_H);
        assertEqual(p.projectedPct, null);
        assertEqual(p.verdict, null);
    });

    it('a critical row runs out at its current rate, before the reset', () => {
        // 70% in 150 min → the last 30% takes 64 min 17 s.
        const p = paced(70, 150 * MINUTE, FIVE_H);
        assertEqual(p.runsOutAt.getTime(), now.getTime() + Math.trunc(30 * 150 * MINUTE / 70));
        assertEqual(p.now, now);
    });

    it('a critical row runs out between now and its reset', () => {
        const reset = at(30 * MINUTE);
        const p = calc({usagePct: 92, reset, now, windowMs: FIVE_H});
        assertEqual(p.runsOutAt > now && p.runsOutAt < reset, true);
    });

    it('calm and over rows have no run-out instant', () => {
        assertEqual(paced(55, 150 * MINUTE, FIVE_H).runsOutAt, null);
        assertEqual(paced(60, 150 * MINUTE, FIVE_H).runsOutAt, null);
    });
});

describe('paceGlyph: state', () => {
    it('ok (and the default) keeps the glyph', () => {
        assertEqual(paceGlyph(Pace.AHEAD), '↑');
        assertEqual(paceGlyph(Pace.UNDER, 'ok'), '↓');
    });

    it('estimating, limit and neutral show no glyph', () => {
        for (const state of ['estimating', 'limit', 'neutral'])
            assertEqual(paceGlyph(Pace.AHEAD, state), '', state);
    });
});

system.exit(summary());

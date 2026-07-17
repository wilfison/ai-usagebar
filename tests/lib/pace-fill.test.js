import system from 'system';

import {fillColors, fillSegments} from '../../lib/pace-fill.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

// Minimal palette: distinct hex per severity so we can assert which class won.
const theme = {green: '#0f0', yellow: '#ff0', orange: '#f80', red: '#f00', fg: '#fff'};

describe('fillColors — base (pct → colour)', () => {
    // Mirrors severityFor thresholds: >=90 crit, >=75 high, >=50 mid, else low.
    it('low pct → green', () => assertEqual(fillColors(10, null, theme).base, theme.green));
    it('mid pct (>=50) → yellow', () => assertEqual(fillColors(50, null, theme).base, theme.yellow));
    it('high pct (>=75) → orange', () => assertEqual(fillColors(80, null, theme).base, theme.orange));
    it('critical pct (>=90) → red', () => assertEqual(fillColors(95, null, theme).base, theme.red));
});

describe('fillColors — over (delta → colour)', () => {
    it('no marker → over is null', () =>
        assertEqual(fillColors(80, null, theme).over, null));

    // delta = pct - elapsed. Thresholds: >=10 crit, >0 high, >=-10 mid, else low.
    it('delta >= 10 → critical (red)', () =>
        assertEqual(fillColors(80, 60, theme).over, theme.red)); // delta 20

    it('0 < delta < 10 → high (orange)', () =>
        assertEqual(fillColors(55, 50, theme).over, theme.orange)); // delta 5

    it('-10 <= delta <= 0 → mid (yellow)', () => {
        assertEqual(fillColors(50, 50, theme).over, theme.yellow); // delta 0
        assertEqual(fillColors(40, 50, theme).over, theme.yellow); // delta -10
    });

    it('delta < -10 → low (green)', () =>
        assertEqual(fillColors(30, 50, theme).over, theme.green)); // delta -20
});

describe('fillSegments — geometry', () => {
    it('no marker → single base segment spanning the fill', () =>
        assertDeepEqual(fillSegments(0.8, null, 100), {fillW: 80, markerX: null, baseW: 80, overW: 0}));

    it('usage past the marker → base up to marker, over past it', () => {
        const s = fillSegments(0.8, 0.5, 100);
        assertEqual(s.fillW, 80);
        assertEqual(s.markerX, 50);
        assertEqual(s.baseW, 50); // 0..50 calm
        assertEqual(s.overW, 30); // 50..80 overshoot
    });

    it('usage below the marker → all base, no overshoot', () => {
        const s = fillSegments(0.4, 0.5, 100);
        assertEqual(s.markerX, 50);
        assertEqual(s.baseW, 40); // whole fill is calm
        assertEqual(s.overW, 0);
    });

    it('clamps the marker inside the track (leaves room for the marker width)', () => {
        const s = fillSegments(1, 1, 100, 2);
        assertEqual(s.markerX, 98); // width - markerW
    });

    it('fraction is clamped to [0,1]', () => {
        assertEqual(fillSegments(1.5, null, 100).fillW, 100);
        assertEqual(fillSegments(-0.2, null, 100).fillW, 0);
    });
});

system.exit(summary());

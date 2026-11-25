import system from 'system';

import {clampPct, fakeElapsed, fakeKindWindow, fakePct, fakeWindow} from '../../../lib/vendors/fake.js';
import {describe, it, assertEqual, summary} from '../../_assert.js';

describe('clampPct', () => {
    it('rounds to an integer', () => {
        assertEqual(clampPct(42.7), 43);
        assertEqual(clampPct(42.2), 42);
    });

    it('clamps to 0..100', () => {
        assertEqual(clampPct(-5), 0);
        assertEqual(clampPct(150), 100);
    });

    it('falls back to 0 for non-finite input', () => {
        assertEqual(clampPct(NaN), 0);
        assertEqual(clampPct(Infinity), 0);
        assertEqual(clampPct('nope'), 0);
    });
});

describe('fakeWindow', () => {
    const NOW = new Date('2026-06-14T20:00:00Z');
    const HOUR = 3600 * 1000;

    it('carries the clamped percentage', () => {
        assertEqual(fakeWindow(23, HOUR, NOW).utilizationPct, 23);
        assertEqual(fakeWindow(150, HOUR, NOW).utilizationPct, 100);
    });

    it('resets one window-length past now', () => {
        const w = fakeWindow(10, HOUR, NOW);
        assertEqual(w.resetsAt.getTime(), NOW.getTime() + HOUR);
        assertEqual(w.windowMs, HOUR);
    });

    it('accepts a numeric now', () => {
        const w = fakeWindow(10, HOUR, NOW.getTime());
        assertEqual(w.resetsAt.getTime(), NOW.getTime() + HOUR);
    });

    it('an elapsed share moves the reset closer, clamped', () => {
        assertEqual(fakeWindow(10, HOUR, NOW, 60).resetsAt.getTime(), NOW.getTime() + 0.4 * HOUR);
        assertEqual(fakeWindow(10, HOUR, NOW, 150).resetsAt.getTime(), NOW.getTime());
    });
});

describe('fakeKindWindow / fakeElapsed', () => {
    const NOW = new Date('2026-06-14T20:00:00Z');
    const HOUR = 3600 * 1000;
    it('takes the kind and the elapsed share from the fake percentages', () => {
        const w = fakeKindWindow({base: 10, weekly: 95, elapsed: 25}, 'weekly', HOUR, NOW);
        assertEqual(w.utilizationPct, 95);
        assertEqual(w.resetsAt.getTime(), NOW.getTime() + 0.75 * HOUR);
    });
    it('a plain number has nothing elapsed', () => {
        assertEqual(fakeElapsed(40), 0);
        assertEqual(fakeKindWindow(40, 'session', HOUR, NOW).resetsAt.getTime(), NOW.getTime() + HOUR);
    });
});

describe('fakePct', () => {
    it('a plain number applies to every kind', () => assertEqual(fakePct(23, 'weekly'), 23));
    it('an object gives the kind its own value', () => assertEqual(fakePct({base: 10, weekly: 95}, 'weekly'), 95));
    it('a missing kind falls back to the base, then 0', () => {
        assertEqual(fakePct({base: 10}, 'mcp'), 10);
        assertEqual(fakePct({}, 'mcp'), 0);
    });
});

system.exit(summary());

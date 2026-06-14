import system from 'system';

import {clampPct, fakeWindow} from '../../../lib/vendors/fake.js';
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
});

system.exit(summary());

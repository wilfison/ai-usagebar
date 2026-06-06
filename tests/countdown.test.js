import system from 'system';

import {format} from '../lib/countdown.js';
import {describe, it, assertEqual, summary} from './_assert.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = new Date(2026, 4, 23, 12, 0, 0);
const at = offsetMs => new Date(now.getTime() + offsetMs);

describe('countdown.format', () => {
    it('null reset renders em-dash', () => {
        assertEqual(format(null, now), '—');
    });

    it('undefined reset renders em-dash', () => {
        assertEqual(format(undefined, now), '—');
    });

    it('past reset renders "now"', () => {
        assertEqual(format(at(-SECOND), now), 'now');
    });

    it('exactly 0 renders "now"', () => {
        assertEqual(format(now, now), 'now');
    });

    it('5h remaining → "5h 00m" (zero-padded minutes)', () => {
        assertEqual(format(at(5 * HOUR), now), '5h 00m');
    });

    it('1h 5m → "1h 05m" (zero-padded minutes)', () => {
        assertEqual(format(at(HOUR + 5 * MINUTE), now), '1h 05m');
    });

    it('23h 59m 59s → "23h 59m" (just under 1 day)', () => {
        assertEqual(format(at(23 * HOUR + 59 * MINUTE + 59 * SECOND), now), '23h 59m');
    });

    it('exactly 24h → "1d 0h" (1-day boundary, minutes dropped)', () => {
        assertEqual(format(at(DAY), now), '1d 0h');
    });

    it('1d 1h 30m → "1d 1h" (minutes dropped in day formatting)', () => {
        assertEqual(format(at(DAY + HOUR + 30 * MINUTE), now), '1d 1h');
    });

    it('4d 1h 45m → "4d 1h"', () => {
        assertEqual(format(at(4 * DAY + HOUR + 45 * MINUTE), now), '4d 1h');
    });

    it('1 second remaining → "0h 00m"', () => {
        assertEqual(format(at(SECOND), now), '0h 00m');
    });
});

describe('countdown.format — injected translator', () => {
    // A fake translator wraps the format string in guillemets so we can prove the
    // unit labels route through `_()` (and are not hard-coded) and that vformat
    // still interpolates the translated template.
    const T = (s) => `«${s}»`;

    it('routes "now" through the translator', () => {
        assertEqual(format(at(-SECOND), now, T), '«now»');
    });

    it('routes the day/hour format through the translator', () => {
        assertEqual(format(at(DAY + HOUR), now, T), '«1d 1h»');
    });

    it('routes the hour/minute format through the translator', () => {
        assertEqual(format(at(HOUR + 5 * MINUTE), now, T), '«1h 05m»');
    });

    it('leaves the null em-dash marker untranslated', () => {
        assertEqual(format(null, now, T), '—');
    });
});

system.exit(summary());

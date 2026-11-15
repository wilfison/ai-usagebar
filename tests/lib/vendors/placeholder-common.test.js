import system from 'system';

import {
    windowFields, setWindowPlaceholders, peakOf, NO_WINDOW, EMPTY_FIELDS, WINDOW_SUFFIXES,
} from '../../../lib/vendors/placeholder-common.js';
import {calc, paceGlyph} from '../../../lib/pacing.js';
import {format as formatCountdown} from '../../../lib/countdown.js';
import {describe, it, assertEqual, assertDeepEqual} from '../../_assert.js';
import {summary} from '../../_assert.js';

const NOW = new Date(Date.UTC(2026, 4, 1, 12, 0, 0));
const HOUR = 3600 * 1000;
const WIN_MS = 5 * HOUR;
// Two hours into a five-hour window: 40% elapsed.
const WIN = {utilizationPct: 60, resetsAt: new Date(NOW.getTime() + 3 * HOUR), windowMs: WIN_MS};

describe('windowFields', () => {
    it('formats a window and its pace', () => {
        const f = windowFields(WIN, NOW);
        const pace = calc({usagePct: 60, reset: WIN.resetsAt, now: NOW, windowMs: WIN_MS});
        assertEqual(f.pct, '60');
        assertEqual(f.reset, formatCountdown(WIN.resetsAt, NOW));
        assertEqual(f.elapsed, '40');
        assertEqual(f.pace, paceGlyph(pace.ratioPace, pace.state));
        assertEqual(f.paceIndicator, paceGlyph(pace.pointPace, pace.state));
        assertDeepEqual(f.calc, pace);
    });
    it('takes the window length from the argument over the window', () => {
        const f = windowFields({utilizationPct: 60, resetsAt: WIN.resetsAt}, NOW, 10 * HOUR);
        assertEqual(f.elapsed, '70');
    });
    it('NO_WINDOW reads as zero, no reset, no pace glyph', () => {
        const f = windowFields(NO_WINDOW, NOW, WIN_MS);
        assertDeepEqual([f.pct, f.reset, f.elapsed, f.pace, f.paceIndicator], ['0', '-', '0', '', '']);
    });
    it('a window with no reset has no pace glyph', () => {
        const f = windowFields({utilizationPct: 30, resetsAt: null, windowMs: WIN_MS}, NOW);
        assertDeepEqual([f.pct, f.reset, f.elapsed, f.pace], ['30', '-', '0', '']);
    });
});

describe('setWindowPlaceholders', () => {
    it('writes every suffix under the prefix', () => {
        const m = new Map();
        const f = windowFields(WIN, NOW);
        setWindowPlaceholders(m, 'oll_session', f);
        assertDeepEqual([...m.keys()], WINDOW_SUFFIXES.map(s => `oll_session_${s}`));
        assertEqual(m.get('oll_session_pct'), '60');
        assertEqual(m.get('oll_session_pace_indicator'), f.paceIndicator);
    });
    it('EMPTY_FIELDS blanks them all', () => {
        const m = new Map();
        setWindowPlaceholders(m, 'w', EMPTY_FIELDS);
        assertDeepEqual([...m.values()], WINDOW_SUFFIXES.map(() => ''));
    });
    it('writes only the suffixes asked for, in that order', () => {
        const m = new Map();
        setWindowPlaceholders(m, 'session', windowFields(WIN, NOW), ['pct', 'pace']);
        assertDeepEqual([...m.keys()], ['session_pct', 'session_pace']);
    });
});

describe('peakOf', () => {
    const a = {percent: 10, resetsAt: new Date(1)};
    const b = {percent: 50, resetsAt: new Date(2)};
    const c = {percent: 50, resetsAt: new Date(3)};
    it('picks the highest percent, the first one on a tie', () => assertEqual(peakOf([a, b, c]), b));
    it('a single zero window still names its reset', () => assertEqual(peakOf([{percent: 0, resetsAt: new Date(9)}]).resetsAt.getTime(), 9));
    it('is zero with no reset when empty', () => assertDeepEqual(peakOf([]), {percent: 0, resetsAt: null}));
    it('takes a fallback for an empty list', () => assertDeepEqual(peakOf([], {percent: null, resetsAt: null}), {percent: null, resetsAt: null}));
});

system.exit(summary());

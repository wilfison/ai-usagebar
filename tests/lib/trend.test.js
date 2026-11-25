import system from 'system';

import {
    attachTrends, emptyTrend, parseTrend, pruneTrend, recordTrend, serializeTrend, trendPoints,
    MAX_AGE_MS, MAX_BYTES, MAX_POINTS, MAX_SERIES, MAX_SKEW_MS, SPARK_POINTS,
} from '../../lib/trend.js';
import {RESET_MOVE_TOLERANCE_MS} from '../../lib/notify.js';
import {ADAPTERS} from '../../lib/vendors/registry.js';
import {defaultTheme} from '../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

const MIN = 60 * 1000;
const T0 = new Date('2026-11-25T12:00:00Z');
const at = ms => new Date(T0.getTime() + ms);
const RESET = new Date('2026-11-30T12:00:00Z');
const weekly = (percent, resetsAt = RESET) => ({key: 'weekly', label: 'Weekly', percent, resetsAt});

function samples(percents, {row = weekly, step = MIN, start = emptyTrend()} = {}) {
    let trend = start;
    percents.forEach((pct, i) => {
        trend = recordTrend(trend, [row(pct)], at(i * step));
    });
    return trend;
}

describe('recordTrend / trendPoints', () => {
    it('three samples make a line', () => {
        assertEqual(trendPoints(samples([10, 20]), weekly()), null);
        assertDeepEqual(trendPoints(samples([10, 20, 30]), weekly()), [10, 20, 30]);
    });

    it('a reset moved later past the tolerance starts a new series', () => {
        const nextReset = new Date(RESET.getTime() + 7 * 24 * 60 * MIN);
        const trend = samples([10, 20, 30]);
        assertEqual(trendPoints(trend, weekly(30, nextReset)), null);
        const next = samples([1, 2], {start: trend, row: pct => weekly(pct, nextReset)});
        assertEqual(next.series.get('weekly').points.length, 2);
    });

    it('a jittering or sliding reset stays one series', () => {
        const jitter = [0, -900, RESET_MOVE_TOLERANCE_MS, 1500];
        const trend = samples([10, 20, 30, 40], {row: pct => weekly(pct, new Date(RESET.getTime() + jitter[pct / 10 - 1]))});
        assertDeepEqual(trendPoints(trend, weekly(40, new Date(RESET.getTime() + RESET_MOVE_TOLERANCE_MS))), [10, 20, 30, 40]);
        assertEqual(trend.series.get('weekly').reset, RESET.getTime() + RESET_MOVE_TOLERANCE_MS);
    });

    it('a missing reset keeps the series and its last reset', () => {
        const trend = samples([10, 20, 30], {row: pct => weekly(pct, pct === 20 ? null : RESET)});
        assertDeepEqual(trendPoints(trend, weekly()), [10, 20, 30]);
        assertEqual(trend.series.get('weekly').reset, RESET.getTime());
    });

    it('a sample inside the interval replaces the last point', () => {
        let trend = recordTrend(emptyTrend(), [weekly(10)], at(0));
        trend = recordTrend(trend, [weekly(80)], at(5000));
        trend = recordTrend(trend, [weekly(90)], at(MIN));
        trend = recordTrend(trend, [weekly(100)], at(2 * MIN));
        assertDeepEqual(trendPoints(trend, weekly()), [80, 90, 100]);
    });

    it('shows the last SPARK_POINTS and keeps MAX_POINTS', () => {
        const trend = samples(Array.from({length: MAX_POINTS + 5}, (_v, i) => i));
        assertEqual(trend.series.get('weekly').points.length, MAX_POINTS);
        assertEqual(trendPoints(trend, weekly()).length, SPARK_POINTS);
        assertEqual(trendPoints(trend, weekly()).at(-1), MAX_POINTS + 4);
    });

    it('caps the series count, dropping the least recently sampled', () => {
        let trend = recordTrend(emptyTrend(), [weekly(1)], at(0));
        for (let i = 0; i < MAX_SERIES + 3; i++)
            trend = recordTrend(trend, [{key: `k${i}`, percent: 1, resetsAt: RESET}], at((i + 1) * MIN));
        assertEqual(trend.series.size, MAX_SERIES);
        assertEqual(trend.series.has('weekly'), false);
    });

    it('rounds and clamps percents, skips non-finite ones', () => {
        const trend = samples([12.6, 140, -3]);
        assertDeepEqual(trendPoints(trend, weekly()), [13, 100, 0]);
        const skipped = recordTrend(emptyTrend(), [weekly(NaN), weekly(null)], T0);
        assertEqual(skipped.series.size, 0);
    });

    it('prunes points older than MAX_AGE_MS', () => {
        const trend = samples([10, 20, 30]);
        const later = recordTrend(trend, [], at(MAX_AGE_MS + 3 * MIN));
        assertEqual(later.series.size, 0);
    });

    it('a clock stepped back keeps the history; points far ahead are dropped', () => {
        const trend = samples([10, 20, 30]);
        const back = recordTrend(trend, [], at(-30 * 1000));
        assertDeepEqual(trendPoints(back, weekly()), [10, 20, 30]);
        const far = recordTrend(trend, [], at(2 * MIN - MAX_SKEW_MS - 1));
        assertDeepEqual(trendPoints(far, weekly()), null);
    });

    it('samples taken while the clock is behind are appended in order', () => {
        let trend = samples([10, 20, 30]);
        trend = recordTrend(trend, [weekly(40)], at(-20 * MIN));
        trend = recordTrend(trend, [weekly(50)], at(-15 * MIN));
        assertDeepEqual(trendPoints(trend, weekly()), [10, 20, 30, 40, 50]);
        const ats = trend.series.get('weekly').points.map(p => p.at);
        assertDeepEqual(ats, [...ats].sort((a, b) => a - b));
    });

    it('pruneTrend drops what is too old for a history read from disk', () => {
        const trend = parseTrend(serializeTrend(samples([10, 20, 30])));
        assertDeepEqual(trendPoints(pruneTrend(trend, at(MIN)), weekly()), [10, 20, 30]);
        assertEqual(pruneTrend(trend, at(MAX_AGE_MS + 3 * MIN)).series.size, 0);
    });

    it('leaves the history it was given unchanged', () => {
        const trend = samples([10, 20]);
        recordTrend(trend, [weekly(30)], at(5 * MIN));
        assertEqual(trend.series.get('weekly').points.length, 2);
    });
});

describe('parseTrend / serializeTrend', () => {
    it('round-trips', () => {
        const trend = samples([10, 20, 30]);
        assertDeepEqual(trendPoints(parseTrend(serializeTrend(trend)), weekly()), [10, 20, 30]);
    });

    it('anything malformed is an empty history', () => {
        for (const text of [null, '', 'not json', '[]', '{"series":[]}', '{"series":null}', ' '.repeat(MAX_BYTES + 1)])
            assertEqual(parseTrend(text).series.size, 0);
    });

    it('drops invalid points and empty series', () => {
        const trend = parseTrend(JSON.stringify({series: {
            a: {reset: 'soon', points: [[1, 10], [2, 101], [3, 1.5], ['4', 2], [5]]},
            b: {reset: 5, points: [[1, -1]]},
            c: 'x',
            d: [[1, 10]],
        }}));
        assertDeepEqual([...trend.series.keys()], ['a']);
        assertDeepEqual(trend.series.get('a'), {reset: null, points: [{at: 1, pct: 10}]});
    });
});

describe('attachTrends', () => {
    const trend = samples([10, 20, 30]);

    it('puts the line on the window row titled like the notify row', () => {
        const rows = [{kind: 'window', title: 'Weekly'}, {kind: 'window', title: 'Session'}, {kind: 'footer'}];
        attachTrends(rows, [weekly(30)], trend);
        assertDeepEqual(rows[0].trend, [10, 20, 30]);
        assertEqual('trend' in rows[1], false);
        assertEqual('trend' in rows[2], false);
    });

    it('a repeated label pairs rows in order', () => {
        let trend = emptyTrend();
        const twins = (a, b) => [{key: 'weekly', label: 'Weekly', percent: a, resetsAt: RESET},
            {key: 'scoped:Weekly', label: 'Weekly', percent: b, resetsAt: RESET}];
        for (const [i, [a, b]] of [[1, 50], [2, 60], [3, 70]].entries())
            trend = recordTrend(trend, twins(a, b), at(i * MIN));
        const rows = [{kind: 'window', title: 'Weekly'}, {kind: 'window', title: 'Weekly'}];
        attachTrends(rows, twins(3, 70), trend);
        assertDeepEqual(rows.map(r => r.trend), [[1, 2, 3], [50, 60, 70]]);
    });

    it('two rows with the same key keep their own series', () => {
        const fable = (a, b) => [{key: 'scoped:Fable', label: 'Fable', percent: a, resetsAt: RESET},
            {key: 'scoped:Fable', label: 'Fable', percent: b, resetsAt: RESET}];
        let trend = emptyTrend();
        for (const [i, [a, b]] of [[30, 80], [31, 81], [32, 82]].entries())
            trend = recordTrend(trend, fable(a, b), at(i * MIN));
        const rows = [{kind: 'window', title: 'Fable'}, {kind: 'window', title: 'Fable'}];
        attachTrends(rows, fable(32, 82), trend);
        assertDeepEqual(rows.map(r => r.trend), [[30, 31, 32], [80, 81, 82]]);
    });

    it('no history leaves the rows alone', () => {
        const rows = [{kind: 'window', title: 'Weekly'}];
        attachTrends(rows, [weekly(30)], undefined);
        assertEqual('trend' in rows[0], false);
    });

    // attachTrends matches on wording: every vendor's notify labels must be
    // its window titles, or that window never gets a line.
    it('every vendor titles its window rows like its notify rows', () => {
        const now = new Date();
        const config = {vendors: {custom: {name: 'Custom'}}};
        const ngettext = (one, many, n) => (n === 1 ? one : many);
        for (const [id, adapter] of Object.entries(ADAPTERS)) {
            if (!adapter.fakeSnapshot)
                continue;
            const snap = adapter.fakeSnapshot(40, now, config);
            const model = adapter.buildSection(snap, {stale: false, lastError: null, fetchedAt: now}, now, defaultTheme(), s => s, ngettext);
            const titles = new Set(model.rows.filter(r => r.kind === 'window').map(r => r.title));
            const unmatched = [...titles].filter(t => !adapter.notifyRows(snap, s => s).some(r => r.label === t));
            assertDeepEqual([id, unmatched], [id, []]);
        }
    });
});

system.exit(summary());

import system from 'system';

import {
    parseUsage, kimiSeverity, kimiPeakUsage, placeholders, fakeSnapshot, pct,
    humanizeLevel, planLabelFromMe, snapshotToCacheJson, parseCacheJson,
    WEEKLY_MS, WINDOW_MS, SchemaError, notifyRows, resetCredits,
} from '../../../../lib/vendors/kimi/parser.js';
import {substitute} from '../../../../lib/format.js';
import {Severity} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertThrows, summary} from '../../../_assert.js';

const STRING_NUMS = JSON.stringify({
    user: {membership: {level: 'LEVEL_INTERMEDIATE'}},
    usage: {limit: '100', used: '26', remaining: '74', resetTime: '2026-02-11T17:32:50.757941Z'},
    limits: [
        {
            window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'},
            detail: {limit: '100', used: '15', remaining: '85', resetTime: '2026-02-07T12:32:50.757941Z'},
        },
    ],
});

const MONTHLY = JSON.stringify({
    user: {membership: {level: 'LEVEL_INTERMEDIATE'}},
    usages: {
        limit_month_total: {used_ratio: 0.426, reset_time: '2026-10-15T00:00:00Z'},
        limit_month_code: {used_ratio: 0.9},
        limit_5h: {used_ratio: 0.99},
    },
    limits: [{window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}, detail: {limit: 100, used: 15, remaining: 85}}],
});

describe('parseUsage', () => {
    it('parses the representative shape (string numbers)', () => {
        const s = parseUsage(STRING_NUMS);
        assertEqual(s.plan, 'Intermediate');
        assertEqual(s.monthly, null);
        assertEqual(s.weekly.limit, 100);
        assertEqual(s.weekly.used, 26);
        assertEqual(s.weekly.remaining, 74);
        assertEqual(s.weekly.resetAt instanceof Date, true);
        assertEqual(s.window.limit, 100);
        assertEqual(s.window.used, 15);
        assertEqual(s.window.remaining, 85);
        assertEqual(s.window.resetAt instanceof Date, true);
        assertEqual(pct(s.weekly.used, s.weekly.limit), 26);
        assertEqual(pct(s.window.used, s.window.limit), 15);
    });

    it('accepts a Uint8Array body and numeric JSON numbers', () => {
        const s = parseUsage(new TextEncoder().encode(JSON.stringify({
            user: {membership: {level: 'LEVEL_ADVANCED'}},
            usage: {limit: 500, used: 123, remaining: 377},
            limits: [{window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}, detail: {limit: 200, used: 50, remaining: 150}}],
        })));
        assertEqual(s.plan, 'Advanced');
        assertEqual(s.weekly.used, 123);
        assertEqual(s.window.used, 50);
    });

    it('missing user + limits → plan null, window zeroed', () => {
        const s = parseUsage('{"usage":{"limit":"100","used":"26","remaining":"74"}}');
        assertEqual(s.plan, null);
        assertEqual(s.weekly.used, 26);
        assertEqual(s.weekly.resetAt, null);
        assertEqual(s.window.limit, 0);
        assertEqual(s.window.used, 0);
        assertEqual(s.window.remaining, 0);
        assertEqual(s.window.resetAt, null);
    });

    it('derives used from limit - remaining', () => {
        const s = parseUsage('{"usage":{"limit":"100","remaining":"74"}}');
        assertEqual(s.weekly.used, 26);
        assertEqual(s.weekly.remaining, 74);
    });

    it('derives remaining from limit - used', () => {
        const s = parseUsage('{"usage":{"limit":"100","used":"26"}}');
        assertEqual(s.weekly.used, 26);
        assertEqual(s.weekly.remaining, 74);
    });

    it('zero counts are valid', () => {
        const s = parseUsage('{"usage":{"limit":"100","used":"0","remaining":"100"}}');
        assertEqual(s.weekly.used, 0);
        assertEqual(pct(s.weekly.used, s.weekly.limit), 0);
    });

    it('accepts reset + duration aliases (resetAt / reset_at, 5 HOUR)', () => {
        const s = parseUsage(JSON.stringify({
            usage: {limit: 100, used: 20, resetAt: '2026-02-11T17:32:50Z'},
            limits: [{window: {duration: 5, time_unit: 'TIME_UNIT_HOUR'}, detail: {limit: 100, remaining: 75, reset_at: '2026-02-07T12:32:50Z'}}],
        }));
        assertEqual(s.weekly.used, 20);
        assertEqual(s.window.used, 25);
        assertEqual(s.weekly.resetAt instanceof Date, true);
        assertEqual(s.window.resetAt instanceof Date, true);
    });

    it('selects the first 300-min window that has a detail block', () => {
        const s = parseUsage(JSON.stringify({
            usage: {limit: '100', used: '10', remaining: '90'},
            limits: [
                {window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}},
                {window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}, detail: {limit: '100', used: '25', remaining: '75'}},
            ],
        }));
        assertEqual(s.window.used, 25);
    });

    it('empty limits → zeroed window (no error)', () => {
        const s = parseUsage('{"usage":{"limit":"100","used":"26","remaining":"74"},"limits":[]}');
        assertEqual(s.window.limit, 0);
    });

    it('null limits → zeroed window (no error)', () => {
        const s = parseUsage('{"usage":{"limit":"100","used":"26","remaining":"74"},"limits":null}');
        assertEqual(s.window.limit, 0);
    });

    it('a non-empty limits with an unrecognized window → schema drift', () => {
        assertThrows(() => parseUsage(JSON.stringify({
            usage: {limit: '100', used: '26', remaining: '74'},
            limits: [{window: {duration: 60, timeUnit: 'TIME_UNIT_MINUTE'}, detail: {limit: '100', used: '1', remaining: '99'}}],
        })));
    });

    it('missing both usage and usages.limit_month_total → schema drift', () => {
        assertThrows(() => parseUsage('{"user":{}}'));
        assertThrows(() => parseUsage('{"usages":{"limit_5h":{"used_ratio":0.1}}}'));
    });

    it('parses the newer usages shape: monthly ratio, no weekly', () => {
        const s = parseUsage(MONTHLY);
        assertEqual(s.plan, 'Intermediate');
        assertEqual(s.weekly, null);
        assertEqual(s.monthly.utilizationPct, 43);
        assertEqual(s.monthly.resetsAt.toISOString(), '2026-10-15T00:00:00.000Z');
        assertEqual(s.window.used, 15);
    });

    it('accepts the reset aliases on limit_month_total', () => {
        for (const key of ['resetTime', 'resetAt', 'reset_at']) {
            const s = parseUsage(JSON.stringify({usages: {limit_month_total: {used_ratio: 0, [key]: '2026-10-15T00:00:00Z'}}}));
            assertEqual(s.monthly.resetsAt instanceof Date, true);
        }
    });

    it('the legacy usage block wins over a usages map beside it', () => {
        const s = parseUsage(JSON.stringify({
            usage: {limit: 100, used: 10, remaining: 90},
            usages: {limit_month_total: {used_ratio: 0.9}},
        }));
        assertEqual(s.weekly.used, 10);
        assertEqual(s.monthly, null);
    });

    it('used_ratio missing, non-finite or outside [0, 1] → schema drift', () => {
        for (const ratio of [undefined, null, '0.5', 1.2, -0.1]) {
            assertThrows(() => parseUsage(JSON.stringify({usages: {limit_month_total: {used_ratio: ratio}}})));
        }
        assertEqual(parseUsage('{"usages":{"limit_month_total":{"used_ratio":1}}}').monthly.utilizationPct, 100);
    });

    it('both used and remaining missing → schema drift', () => {
        let threw = false;
        try {
            parseUsage('{"usage":{"limit":"100"}}');
        } catch (e) {
            threw = e instanceof SchemaError && e.message.includes('both');
        }
        assertEqual(threw, true);
    });

    it('malformed numeric string → schema drift', () =>
        assertThrows(() => parseUsage('{"usage":{"limit":"100","used":"garbage"}}')));

    it('negative JSON number → schema drift', () =>
        assertThrows(() => parseUsage('{"usage":{"limit":100,"used":-1}}')));

    it('non-object top level throws', () => {
        assertThrows(() => parseUsage('[]'));
        assertThrows(() => parseUsage('not json'));
    });
});

describe('plan label', () => {
    it('humanizes the membership enum without inventing a tier', () => {
        assertEqual(humanizeLevel('LEVEL_INTERMEDIATE'), 'Intermediate');
        assertEqual(humanizeLevel('LEVEL_SUPER_ADVANCED'), 'Super Advanced');
        assertEqual(humanizeLevel('  basic  '), 'Basic');
        assertEqual(humanizeLevel('LEVEL_'), 'LEVEL_');
    });

    it('reads only user_level_name from /me, verbatim', () => {
        const me = JSON.stringify({email: 'someone@example.com', nickname: 'n', user_level: 25, user_level_name: 'Allegretto'});
        assertEqual(planLabelFromMe(me), 'Allegretto');
        assertEqual(planLabelFromMe(new TextEncoder().encode(me)), 'Allegretto');
        assertEqual(planLabelFromMe('{"user_level_name":"  "}'), null);
        assertEqual(planLabelFromMe('{}'), null);
        assertEqual(planLabelFromMe('not json'), null);
    });

    it('the plan survives the cache round-trip', () => {
        const snap = parseUsage(MONTHLY);
        snap.plan = 'Allegretto';
        const back = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(back.plan, 'Allegretto');
        assertEqual(back.monthly.resetsAt instanceof Date, true);
        assertEqual(back.monthly.utilizationPct, 43);
    });

    it('a raw /usages body in the cache is treated as corrupt', () =>
        assertThrows(() => parseCacheJson(MONTHLY)));
});

describe('pct', () => {
    it('rounds to nearest', () => assertEqual(pct(1, 3), 33));
    it('saturates at 100 when used exceeds limit', () => assertEqual(pct(150, 100), 100));
    it('zero limit → 0', () => assertEqual(pct(5, 0), 0));
});

describe('kimiSeverity / kimiPeakUsage', () => {
    it('picks the worse of weekly / window', () => {
        const s = parseUsage(JSON.stringify({
            usage: {limit: 100, used: 10, remaining: 90},
            limits: [{window: {duration: 300, timeUnit: 'MINUTE'}, detail: {limit: 100, used: 95, remaining: 5}}],
        }));
        assertEqual(kimiSeverity(s), Severity.CRITICAL); // window 95
        const p = kimiPeakUsage(s);
        assertEqual(p.percent, 95);
        assertEqual(p.resetsAt, s.window.resetAt);
    });

    it('weekly wins when higher', () => {
        const s = parseUsage('{"usage":{"limit":100,"used":80,"remaining":20}}');
        assertEqual(kimiPeakUsage(s).percent, 80);
        assertEqual(kimiSeverity(s), Severity.HIGH);
    });
});

describe('kimiPeakUsage: monthly shape', () => {
    it('the monthly pool alone can drive severity', () => {
        const s = parseUsage('{"usages":{"limit_month_total":{"used_ratio":0.95}}}');
        assertEqual(kimiPeakUsage(s).percent, 95);
        assertEqual(kimiSeverity(s), Severity.CRITICAL);
    });

    it('the 5h window wins when higher than the monthly pool', () => {
        const p = kimiPeakUsage(parseUsage(MONTHLY));
        assertEqual(p.percent, 43);
    });
});

describe('placeholders', () => {
    const now = new Date('2026-06-05T00:00:00Z');

    it('newer shape: weekly placeholders are empty, monthly ones resolve', () => {
        const m = placeholders(parseUsage(MONTHLY), now);
        assertEqual(m.get('kimi_weekly_pct'), '');
        assertEqual(m.get('kimi_weekly_reset'), '');
        assertEqual(m.get('weekly_pct'), '');
        assertEqual(m.get('weekly_reset'), '');
        assertEqual(m.get('kimi_monthly_pct'), '43');
        assertEqual(m.get('kimi_monthly_reset') !== '', true);
        assertEqual(m.get('kimi_window_pct'), '15');
    });

    it('maps window→session_* and weekly→weekly_*', () => {
        const s = parseUsage(JSON.stringify({
            user: {membership: {level: 'LEVEL_PRO'}},
            usage: {limit: 100, used: 42, remaining: 58},
            limits: [{window: {duration: 300, timeUnit: 'MINUTE'}, detail: {limit: 100, used: 12, remaining: 88}}],
        }));
        const m = placeholders(s, now);
        assertEqual(substitute('{vendor_short} {session_pct}% w{weekly_pct}%', m), 'kmi 12% w42%');
        assertEqual(m.get('kimi_window_pct'), '12');
        assertEqual(m.get('kimi_weekly_pct'), '42');
        assertEqual(m.get('kimi_plan'), 'Pro');
        assertEqual(m.get('kimi_monthly_pct'), '');
        assertEqual(m.get('kimi_monthly_reset'), '');
    });

    const NO_WINDOW_KEYS = ['session_pct', 'session_reset', 'session_elapsed', 'kimi_window_pct', 'kimi_window_reset'];
    const legacyNoWindow = (limits) => JSON.stringify({usage: {limit: 100, used: 26, remaining: 74}, ...limits});
    const monthlyNoWindow = (limits) => JSON.stringify({usages: {limit_month_total: {used_ratio: 0.3}}, ...limits});

    for (const [shape, body] of [['legacy', legacyNoWindow], ['monthly', monthlyNoWindow]]) {
        for (const [what, limits] of [['absent', {}], ['null', {limits: null}], ['empty', {limits: []}]]) {
            it(`${shape} shape, ${what} limits: every 5h placeholder is empty`, () => {
                const m = placeholders(parseUsage(body(limits)), now);
                for (const key of NO_WINDOW_KEYS)
                    assertEqual(m.get(key), '', key);
            });
        }
    }

    it('without a 5h window the default format renders no invented 0%', () => {
        const m = placeholders(parseUsage('{"usage":{"limit":100,"used":0,"remaining":100}}'), now);
        assertEqual(substitute('{session_pct}% · {session_reset}', m), '% · ');
        assertEqual(m.get('weekly_pct'), '0');
        assertEqual(m.get('plan'), '');
    });

    it('a real 5h window keeps its placeholders', () => {
        const m = placeholders(parseUsage(STRING_NUMS), now);
        assertEqual(m.get('session_pct'), '15');
        assertEqual(m.get('kimi_window_reset') !== '', true);
        assertEqual(m.get('session_elapsed') !== '', true);
    });
});

describe('fakeSnapshot', () => {
    it('sets weekly + window to the clamped percentage', () => {
        const s = fakeSnapshot(23);
        assertEqual(pct(s.weekly.used, s.weekly.limit), 23);
        assertEqual(pct(s.window.used, s.window.limit), 23);
        assertEqual(kimiPeakUsage(s).percent, 23);
        assertEqual(s.weekly.resetAt instanceof Date, true);
        assertEqual(WEEKLY_MS > WINDOW_MS, true);
    });
});

const PACE_NOW = new Date('2026-06-05T12:00:00Z');
const halfway = windowMs => new Date(PACE_NOW.getTime() + windowMs / 2);

describe('placeholders: elapsed aliases', () => {
    const block = windowMs => ({limit: 100, used: 30, remaining: 70, resetAt: halfway(windowMs)});

    it('session_elapsed follows the 5h window, weekly_elapsed the weekly one', () => {
        const m = placeholders({plan: 'Moderato', window: block(WINDOW_MS), weekly: block(WEEKLY_MS), monthly: null}, PACE_NOW);
        assertEqual(m.get('session_elapsed'), '50');
        assertEqual(m.get('weekly_elapsed'), '50');
    });

    it('no weekly block → empty weekly_elapsed', () => {
        const m = placeholders({plan: 'Moderato', window: block(WINDOW_MS), weekly: null, monthly: null}, PACE_NOW);
        assertEqual(m.get('weekly_elapsed'), '');
    });
});

describe('notifyRows / resetCredits', () => {
    it('window, weekly and monthly rows', () => {
        const block = {limit: 100, used: 98, remaining: 2, resetAt: null};
        const rows = notifyRows({plan: 'x', window: block, weekly: block, monthly: {utilizationPct: 5, resetsAt: null}});
        assertEqual(rows.map(r => r.key).join(','), 'window,weekly,monthly');
        assertEqual(rows[0].percent, 98);
        assertEqual(resetCredits({}).length, 0);
    });

    it('a zero-limit window is skipped', () => {
        const rows = notifyRows({plan: 'x', window: {limit: 0, used: 0, remaining: 0, resetAt: null}, weekly: null, monthly: null});
        assertEqual(rows.length, 0);
    });
});

describe('kimiPeakUsage: no 5h window', () => {
    it('only the windows the account reports compete', () => {
        const peak = kimiPeakUsage(parseUsage(JSON.stringify({usages: {limit_month_total: {used_ratio: 0.3, reset_time: '2026-10-15T00:00:00Z'}}})));
        assertEqual(peak.percent, 30);
        assertEqual(peak.resetsAt instanceof Date, true);
    });

    it('a zero weekly does not lose to an absent window', () => {
        const peak = kimiPeakUsage(parseUsage('{"usage":{"limit":100,"used":0,"remaining":100,"resetTime":"2026-02-11T17:32:50Z"}}'));
        assertEqual(peak.percent, 0);
        assertEqual(peak.resetsAt instanceof Date, true, 'the weekly reset, not the empty window one');
    });
});

system.exit(summary());

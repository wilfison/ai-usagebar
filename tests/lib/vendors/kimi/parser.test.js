import system from 'system';

import {
    parseUsage, kimiSeverity, kimiPeakUsage, placeholders, fakeSnapshot, pct,
    WEEKLY_MS, WINDOW_MS, SchemaError,
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

describe('parseUsage', () => {
    it('parses the representative shape (string numbers)', () => {
        const s = parseUsage(STRING_NUMS);
        assertEqual(s.plan, 'LEVEL_INTERMEDIATE');
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
        assertEqual(s.plan, 'LEVEL_ADVANCED');
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

    it('missing top-level usage → schema drift', () =>
        assertThrows(() => parseUsage('{"user":{}}')));

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

describe('placeholders', () => {
    const now = new Date('2026-06-05T00:00:00Z');

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
        assertEqual(m.get('kimi_plan'), 'LEVEL_PRO');
    });

    it('absent window → session_reset is —', () => {
        const m = placeholders(parseUsage('{"usage":{"limit":100,"used":0,"remaining":100}}'), now);
        assertEqual(m.get('session_pct'), '0');
        assertEqual(m.get('session_reset'), '—');
        assertEqual(m.get('plan'), '');
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

system.exit(summary());

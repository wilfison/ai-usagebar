import system from 'system';

import {
    parseUsage,
    anthropicSeverity,
    anthropicPeakUsage,
    fmtDollars,
    placeholders,
    SchemaError,
} from '../lib/vendors/anthropic-parse.js';
import {Severity} from '../lib/severity.js';
import {substitute} from '../lib/format.js';
import {describe, it, assertEqual, assertThrows, summary} from './_assert.js';

const FULL = JSON.stringify({
    five_hour: {utilization: 42.7, resets_at: '2026-05-23T17:30:00Z'},
    seven_day: {utilization: 27.0, resets_at: '2026-05-30T12:00:00Z'},
    seven_day_sonnet: {utilization: 4.2, resets_at: '2026-05-30T12:00:00Z'},
    extra_usage: {is_enabled: true, monthly_limit: 5000, used_credits: 250},
});

function win(pct) {
    return {utilizationPct: pct, resetsAt: null};
}

function snap(session, weekly, sonnetPct, extra) {
    return {
        plan: 'Max 5x',
        session: win(session),
        weekly: win(weekly),
        sonnet: sonnetPct === null ? null : win(sonnetPct),
        extra: extra === null ? null : {limitCents: extra[0], spentCents: extra[1]},
    };
}

describe('parseUsage', () => {
    it('parses a full response (float util rounds, sonnet + extra present)', () => {
        const s = parseUsage(FULL, 'Max 5x');
        assertEqual(s.plan, 'Max 5x');
        assertEqual(s.session.utilizationPct, 43); // 42.7 rounded to nearest
        assertEqual(s.weekly.utilizationPct, 27);
        assertEqual(s.sonnet.utilizationPct, 4);
        assertEqual(s.extra.limitCents, 5000);
        assertEqual(s.extra.spentCents, 250);
        assertEqual(s.session.resetsAt instanceof Date, true);
    });

    it('accepts a Uint8Array body', () => {
        const s = parseUsage(new TextEncoder().encode(FULL), 'Pro');
        assertEqual(s.plan, 'Pro');
        assertEqual(s.session.utilizationPct, 43);
    });

    it('missing sonnet + extra → both null', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0, resets_at: '2026-05-23T17:30:00Z'},
            seven_day: {utilization: 0, resets_at: '2026-05-30T12:00:00Z'},
        }), 'Pro');
        assertEqual(s.sonnet, null);
        assertEqual(s.extra, null);
    });

    it('disabled extra_usage → extra null', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0},
            seven_day: {utilization: 0},
            extra_usage: {is_enabled: false, monthly_limit: 5000, used_credits: 0},
        }), 'Pro');
        assertEqual(s.extra, null);
    });

    it('empty {} → neutral snapshot (no throw)', () => {
        const s = parseUsage('{}', 'Unknown');
        assertEqual(s.session.utilizationPct, 0);
        assertEqual(s.weekly.utilizationPct, 0);
        assertEqual(s.session.resetsAt, null);
        assertEqual(s.sonnet, null);
        assertEqual(s.extra, null);
    });

    it('unparseable resets_at → null, utilization still parsed', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 50, resets_at: 'not a date'},
            seven_day: {utilization: 0},
        }), 'Pro');
        assertEqual(s.session.resetsAt, null);
        assertEqual(s.session.utilizationPct, 50);
    });

    it('extra money values accept floats and truncate', () => {
        const s = parseUsage(JSON.stringify({
            extra_usage: {is_enabled: true, monthly_limit: 5000.9, used_credits: 250.9},
        }), 'Max 5x');
        assertEqual(s.extra.limitCents, 5000);
        assertEqual(s.extra.spentCents, 250);
    });

    it('invalid JSON throws SchemaError', () => {
        assertThrows(() => parseUsage('{not json', 'Pro'));
        let threw = false;
        try {
            parseUsage('{not json', 'Pro');
        } catch (e) {
            threw = e instanceof SchemaError;
        }
        assertEqual(threw, true, 'should be a SchemaError');
    });

    it('non-object top-level (array / scalar) throws', () => {
        assertThrows(() => parseUsage('[]', 'Pro'));
        assertThrows(() => parseUsage('42', 'Pro'));
        assertThrows(() => parseUsage('null', 'Pro'));
    });
});

describe('anthropicSeverity', () => {
    it('picks worst of three windows', () => {
        assertEqual(anthropicSeverity(snap(40, 60, 80, null)), Severity.HIGH); // 80
    });

    it('ignores extra when no window at cap', () => {
        assertEqual(anthropicSeverity(snap(50, 60, null, [10000, 9500])), Severity.MID); // 60
    });

    it('promotes extra to critical when a window is at 100', () => {
        assertEqual(anthropicSeverity(snap(100, 50, null, [10000, 9500])), Severity.CRITICAL);
    });

    it('falls through to extra when extra higher than capped window', () => {
        assertEqual(anthropicSeverity(snap(100, 50, null, [10000, 10000])), Severity.CRITICAL);
    });
});

describe('anthropicPeakUsage', () => {
    it('returns the peak percent and the winning window resets_at', () => {
        const s = parseUsage(FULL, 'Max 5x'); // session 42.7→43 is the max
        const p = anthropicPeakUsage(s);
        assertEqual(p.percent, 43);
        assertEqual(p.resetsAt, s.session.resetsAt);
    });
    it('selects the weekly window when it is the peak', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 10, resets_at: '2026-05-23T17:30:00Z'},
            seven_day: {utilization: 80, resets_at: '2026-05-30T12:00:00Z'},
        }), 'Pro');
        const p = anthropicPeakUsage(s);
        assertEqual(p.percent, 80);
        assertEqual(p.resetsAt, s.weekly.resetsAt);
    });
});

describe('fmtDollars', () => {
    it('formats positive cents as $D.CC', () => {
        assertEqual(fmtDollars(0), '$0.00');
        assertEqual(fmtDollars(50), '$0.50');
        assertEqual(fmtDollars(250), '$2.50');
        assertEqual(fmtDollars(5000), '$50.00');
    });

    it('formats negative cents with a leading sign', () => {
        assertEqual(fmtDollars(-150), '-$1.50');
        assertEqual(fmtDollars(-1), '-$0.01');
    });
});

describe('placeholders', () => {
    // now fixed; session resets in exactly 1h 30m (5400s) of a 5h (18000s)
    // window → elapsed 70%, delta 42-70 = -28 → "28pts under".
    const now = new Date('2026-06-05T00:00:00Z');
    const resetsAt = new Date(now.getTime() + 5400 * 1000);
    const s = {
        plan: 'Max 5x',
        session: {utilizationPct: 42, resetsAt},
        weekly: {utilizationPct: 10, resetsAt: null},
        sonnet: null,
        extra: null,
    };

    it('renders the default bar format', () => {
        const out = substitute('{vendor_short} {session_pct}% · {session_reset}', placeholders(s, now));
        assertEqual(out, 'cld 42% · 1h 30m');
    });

    it('renders a custom format using a pace key', () => {
        const out = substitute('{session_pct}% ({session_pace_pts})', placeholders(s, now));
        assertEqual(out, '42% (28pts under)');
    });

    it('sonnet-absent defaults present; *_bar keys omitted', () => {
        const m = placeholders(s, now);
        assertEqual(m.get('sonnet_pct'), '0');
        assertEqual(m.get('sonnet_reset'), '—');
        assertEqual(m.get('sonnet_elapsed'), '0');
        assertEqual(m.get('extra_spent'), '');
        assertEqual(m.get('extra_pct'), '0');
        assertEqual(m.has('session_bar'), false);
        assertEqual(m.has('sonnet_bar'), false);
        assertEqual(m.has('extra_bar'), false);
        assertEqual(m.get('icon'), '󰚩');
    });

    it('includes extra spent/limit/pct when extra present', () => {
        const withExtra = {...s, extra: {limitCents: 5000, spentCents: 250}};
        const m = placeholders(withExtra, now);
        assertEqual(m.get('extra_spent'), '$2.50');
        assertEqual(m.get('extra_limit'), '$50.00');
        assertEqual(m.get('extra_pct'), '5'); // 250*100/5000
    });
});

system.exit(summary());

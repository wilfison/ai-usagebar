import system from 'system';

import {
    parseUsage, openaiSeverity, openaiPeakUsage, placeholders, fakeSnapshot, SESSION_MS, WEEKLY_MS,
} from '../../../../lib/vendors/openai/parser.js';
import {substitute} from '../../../../lib/format.js';
import {Severity} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertDeepEqual, assertThrows, summary} from '../../../_assert.js';

const REAL = JSON.stringify({
    user_id: 'u', account_id: 'a', email: 'e',
    plan_type: 'plus',
    rate_limit: {
        allowed: true, limit_reached: false,
        primary_window: {used_percent: 1, limit_window_seconds: 18000, reset_at: 1779597324},
        secondary_window: {used_percent: 0, limit_window_seconds: 604800, reset_at: 1780184124},
    },
});

describe('parseUsage', () => {
    it('parses the real shape into ChatGPT Plus + window durations', () => {
        const s = parseUsage(REAL, null);
        assertEqual(s.plan, 'ChatGPT Plus');
        assertEqual(s.session.utilizationPct, 1);
        assertEqual(s.weekly.utilizationPct, 0);
        assertEqual(s.session.windowMs, SESSION_MS);
        assertEqual(s.weekly.windowMs, WEEKLY_MS);
        assertEqual(s.session.resetsAt === null, false);
        assertEqual(s.codeReview, null);
        assertEqual(s.credits, null);
    });

    it('missing rate_limit yields a neutral snapshot', () => {
        const s = parseUsage('{"plan_type":"pro"}', null);
        assertEqual(s.plan, 'ChatGPT Pro');
        assertEqual(s.session.utilizationPct, 0);
        assertEqual(s.weekly.utilizationPct, 0);
    });

    it('parses a credits block with message ranges', () => {
        const s = parseUsage(JSON.stringify({
            plan_type: 'plus',
            credits: {balance: '$2.50', has_credits: true, unlimited: false,
                approx_local_messages: [100, 200], approx_cloud_messages: [40, 60]},
        }), null);
        const c = s.credits;
        assertEqual(c.balance, '$2.50');
        assertEqual(c.hasCredits, true);
        assertDeepEqual(c.approxLocalMessages, [100, 200]);
        assertDeepEqual(c.approxCloudMessages, [40, 60]);
    });

    it('formats a numeric balance to $x.xx', () => {
        const s = parseUsage('{"credits":{"balance":1.5,"has_credits":true,"unlimited":false}}', null);
        assertEqual(s.credits.balance, '$1.50');
    });

    it('clamps used_percent to 100', () => {
        const s = parseUsage('{"rate_limit":{"primary_window":{"used_percent":250,"limit_window_seconds":1}}}', null);
        assertEqual(s.session.utilizationPct, 100);
    });

    it('uses the plan hint when plan_type is absent', () =>
        assertEqual(parseUsage('{}', 'team').plan, 'ChatGPT Team'));

    it('falls back to reset_after_seconds when reset_at is absent', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 50, limit_window_seconds: 1000, reset_after_seconds: 500}},
        }), null);
        const delta = (s.session.resetsAt.getTime() - Date.now()) / 1000;
        assertEqual(delta > 400 && delta <= 600, true);
        assertEqual(s.session.windowMs, 1000 * 1000);
    });

    it('throws SchemaError on a non-object top level', () => {
        assertThrows(() => parseUsage('[]', null));
        assertThrows(() => parseUsage('null', null));
        assertThrows(() => parseUsage('not json', null));
    });
});

describe('openaiSeverity', () => {
    it('picks the worst window', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 10}, secondary_window: {used_percent: 95}},
        }), null);
        assertEqual(openaiSeverity(s), Severity.CRITICAL);
    });
});

describe('openaiPeakUsage', () => {
    it('returns the peak percent and the winning window resets_at', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {
                primary_window: {used_percent: 10, reset_at: 1779597324},
                secondary_window: {used_percent: 95, reset_at: 1780184124},
            },
        }), null);
        const p = openaiPeakUsage(s);
        assertEqual(p.percent, 95);
        assertEqual(p.resetsAt, s.weekly.resetsAt);
    });
});

describe('placeholders', () => {
    const now = new Date('2026-06-05T00:00:00Z');

    it('renders the shared cross-vendor format', () => {
        const s = parseUsage(REAL, null);
        assertEqual(substitute('{vendor_short} {session_pct}% · {session_reset}', placeholders(s, now)),
            `gpt 1% · ${placeholders(s, now).get('session_reset')}`);
    });

    it('emits the oai_* family with credit balance n/a when absent', () => {
        const m = placeholders(parseUsage(REAL, null), now);
        assertEqual(m.get('oai_plan'), 'ChatGPT Plus');
        assertEqual(m.get('oai_session_pct'), '1');
        assertEqual(m.get('oai_code_review_pct'), '0');
        assertEqual(m.get('oai_credit_balance'), 'n/a');
        assertEqual(m.get('oai_local_msgs'), '');
    });
});

describe('fakeSnapshot', () => {
    it('sets session/weekly/code-review to the clamped percentage', () => {
        const s = fakeSnapshot(23);
        assertEqual(s.session.utilizationPct, 23);
        assertEqual(s.weekly.utilizationPct, 23);
        assertEqual(s.codeReview.utilizationPct, 23);
        assertEqual(openaiPeakUsage(s).percent, 23);
        assertEqual(s.credits, null);
    });
});

system.exit(summary());

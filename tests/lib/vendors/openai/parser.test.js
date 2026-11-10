import system from 'system';

import {
    parseUsage, snapshotToCacheJson, parseCacheJson, openaiSeverity, openaiPeakUsage, placeholders, fakeSnapshot, SESSION_MS, WEEKLY_MS,
    parseResetCredits, mergeResetCredits, notifyRows, resetCredits, creditCount,
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

    it('missing rate_limit yields no windows instead of an invented 0%', () => {
        const s = parseUsage('{"plan_type":"pro"}', null);
        assertEqual(s.plan, 'ChatGPT Pro');
        assertEqual(s.session, null);
        assertEqual(s.weekly, null);
    });

    it('parses a credits block with message ranges', () => {
        const s = parseUsage(JSON.stringify({
            plan_type: 'plus',
            credits: {balance: '2.50', has_credits: true, unlimited: false,
                approx_local_messages: [100, 200], approx_cloud_messages: [40, 60]},
        }), null);
        const c = s.credits;
        assertEqual(c.balance, '2.5');
        assertEqual(c.hasCredits, true);
        assertDeepEqual(c.approxLocalMessages, [100, 200]);
        assertDeepEqual(c.approxCloudMessages, [40, 60]);
    });

    it('a numeric balance is a count of credits, not dollars', () => {
        const s = parseUsage('{"credits":{"balance":1.5,"has_credits":true,"unlimited":false}}', null);
        assertEqual(s.credits.balance, '1.5');
    });

    it('credit counts: at most two decimals, no trailing zeros, no symbol', () => {
        for (const [raw, want] of [['62500', '62500'], [62500, '62500'], ['62500.0', '62500'], [12.5, '12.5'],
            ['0.25', '0.25'], [1.239, '1.24'], [-3, '-3'], ['0', '0'], [-0.001, '0']])
            assertEqual(creditCount(raw), want, String(raw));
    });

    const balanceOf = (b) => parseUsage(JSON.stringify({credits: {balance: b}}), null).credits.balance;

    it('a numeric-string balance is a bare count too', () => {
        assertEqual(balanceOf('0'), '0');
        assertEqual(balanceOf(' 2.5 '), '2.5');
        assertEqual(balanceOf('-1'), '-1');
    });

    it('passes a non-numeric balance string through unchanged', () => {
        assertEqual(balanceOf(''), '');
        assertEqual(balanceOf('$2.50'), '$2.50');
    });

    it('reads an absent or null balance as empty', () => {
        assertEqual(parseUsage('{"credits":{}}', null).credits.balance, '');
        assertEqual(balanceOf(null), '');
    });

    it('saturates used_percent 101 at 100 and rejects anything beyond', () => {
        const s = parseUsage('{"rate_limit":{"primary_window":{"used_percent":101,"limit_window_seconds":18000}}}', null);
        assertEqual(s.session.utilizationPct, 100);
        assertThrows(() => parseUsage('{"rate_limit":{"primary_window":{"used_percent":250}}}', null));
        assertThrows(() => parseUsage('{"rate_limit":{"primary_window":{"used_percent":-1}}}', null));
    });

    it('accepts a numeric-string used_percent and rejects garbage', () => {
        const s = parseUsage('{"rate_limit":{"primary_window":{"used_percent":"42.4","limit_window_seconds":18000}}}', null);
        assertEqual(s.session.utilizationPct, 42);
        assertThrows(() => parseUsage('{"rate_limit":{"primary_window":{"used_percent":"lots"}}}', null));
        assertThrows(() => parseUsage('{"rate_limit":{"primary_window":{}}}', null));
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

    it('classifies a lone 604800s primary_window as weekly', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 66, limit_window_seconds: 604800, reset_at: 1785261834}},
        }), null);
        assertEqual(s.session, null);
        assertEqual(s.weekly.utilizationPct, 66);
        assertEqual(s.weekly.windowMs, WEEKLY_MS);
    });

    it('classifies swapped windows by duration, not position', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {
                primary_window: {used_percent: 70, limit_window_seconds: 604800},
                secondary_window: {used_percent: 5, limit_window_seconds: 18000},
            },
        }), null);
        assertEqual(s.session.utilizationPct, 5);
        assertEqual(s.session.windowMs, SESSION_MS);
        assertEqual(s.weekly.utilizationPct, 70);
    });

    it('falls back to position for an unknown duration, keeping it as windowMs', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {
                primary_window: {used_percent: 10, limit_window_seconds: 3600},
                secondary_window: {used_percent: 20, limit_window_seconds: 86400},
            },
        }), null);
        assertEqual(s.session.utilizationPct, 10);
        assertEqual(s.session.windowMs, 3600 * 1000);
        assertEqual(s.weekly.utilizationPct, 20);
        assertEqual(s.weekly.windowMs, 86400 * 1000);
    });

    it('rejects two windows of the same kind', () => {
        assertThrows(() => parseUsage(JSON.stringify({
            rate_limit: {
                primary_window: {used_percent: 1, limit_window_seconds: 18000},
                secondary_window: {used_percent: 2, limit_window_seconds: 18000},
            },
        }), null));
    });

    it('treats null collections as empty', () => {
        const s = parseUsage(JSON.stringify({
            additional_rate_limits: null,
            model_usage: null,
            rate_limit_reset_credits: {available_count: 0, credits: null},
            rate_limit: {primary_window: {used_percent: 3, limit_window_seconds: 18000}},
        }), null);
        assertEqual(s.session.utilizationPct, 3);
    });

    it('rejects a string or number where a collection belongs', () => {
        for (const bad of ['"none"', '0']) {
            assertThrows(() => parseUsage(`{"additional_rate_limits":${bad}}`, null));
            assertThrows(() => parseUsage(`{"model_usage":${bad}}`, null));
            assertThrows(() => parseUsage(`{"rate_limit_reset_credits":{"credits":${bad}}}`, null));
        }
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

describe('openaiSeverity: absent windows', () => {
    it('ignores absent windows and still counts code review', () => {
        const s = parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 10, limit_window_seconds: 604800}},
            code_review_rate_limit: {primary_window: {used_percent: 95}},
        }), null);
        assertEqual(openaiSeverity(s), Severity.CRITICAL);
        assertEqual(openaiPeakUsage(s).percent, 95);
    });

    it('reports 0 with no reset when no window is present', () => {
        const p = openaiPeakUsage(parseUsage('{}', null));
        assertEqual(p.percent, 0);
        assertEqual(p.resetsAt, null);
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

describe('placeholders: absent windows', () => {
    const now = new Date('2026-06-05T00:00:00Z');

    it('resolves the weekly family to empty when the weekly window is absent', () => {
        const m = placeholders(parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 7, limit_window_seconds: 18000}},
        }), null), now);
        assertEqual(m.get('oai_session_pct'), '7');
        assertEqual(m.get('oai_weekly_pct'), '');
        assertEqual(m.get('weekly_pct'), '');
        assertEqual(m.get('oai_weekly_reset'), '');
        assertEqual(m.get('oai_weekly_pace'), '');
    });

    it('resolves the session family to empty for a weekly-only response', () => {
        const m = placeholders(parseUsage(JSON.stringify({
            rate_limit: {primary_window: {used_percent: 66, limit_window_seconds: 604800}},
        }), null), now);
        assertEqual(m.get('session_pct'), '');
        assertEqual(m.get('oai_session_reset'), '');
        assertEqual(m.get('oai_weekly_pct'), '66');
    });
});

describe('cache round-trip', () => {
    it('restores windows, dates and credits; rejects a raw body', () => {
        const snap = parseUsage(JSON.stringify(Object.assign(JSON.parse(REAL),
            {credits: {balance: '0', has_credits: false, unlimited: false, approx_local_messages: [1, 2]}})), null);
        const back = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(back.plan, 'ChatGPT Plus');
        assertEqual(back.session.resetsAt.getTime(), snap.session.resetsAt.getTime());
        assertEqual(back.weekly.windowMs, WEEKLY_MS);
        assertEqual(back.credits.balance, '0');
        assertDeepEqual(back.credits.approxLocalMessages, [1, 2]);
        assertThrows(() => parseCacheJson(REAL));
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

const SAME_TITLE = 'Full reset (Weekly + 5 hr)';

function withResetBlock(block) {
    return JSON.stringify({plan_type: 'plus', rate_limit_reset_credits: block});
}

describe('reset credits', () => {
    it('keeps each available credit, two with the same title stay two', () => {
        const s = parseUsage(withResetBlock({
            available_count: 2,
            credits: [
                {id: 'c1', status: 'redeemed', title: SAME_TITLE, expires_at: '2026-07-01T00:00:00Z'},
                {id: 'c2', status: 'available', title: SAME_TITLE, expires_at: '2026-07-17T00:00:00Z'},
                {id: 'c3', status: 'available', title: SAME_TITLE, expires_at: '2026-07-20T00:00:00Z'},
            ],
        }), null);
        assertEqual(s.resetCredits.available, 2);
        assertEqual(s.resetCredits.credits.length, 2);
        assertEqual(s.resetCredits.credits[0].title, SAME_TITLE);
        assertEqual(s.resetCredits.credits[1].title, SAME_TITLE);
        assertEqual(s.resetCredits.credits[0].expiresAt.getTime(), Date.parse('2026-07-17T00:00:00Z'));
    });

    it('never keeps the redemption id', () => {
        const s = parseUsage(withResetBlock({available_count: 1, credits: [{id: 'secret-handle', status: 'available'}]}), null);
        assertEqual('id' in s.resetCredits.credits[0], false);
        assertEqual(snapshotToCacheJson(s).includes('secret-handle'), false);
    });

    it('credits: null keeps the count alone', () => {
        const s = parseUsage(withResetBlock({available_count: 3, credits: null}), null);
        assertDeepEqual(s.resetCredits, {available: 3, credits: []});
    });

    it('no block → null, not a stated zero', () => {
        assertEqual(parseUsage('{"plan_type":"plus"}', null).resetCredits, null);
        assertEqual(parseUsage(withResetBlock(null), null).resetCredits, null);
    });

    it('a stated zero stays distinct from an absent block', () => {
        assertDeepEqual(parseUsage(withResetBlock({available_count: 0, credits: []}), null).resetCredits, {available: 0, credits: []});
    });

    it('a null block survives the cache round-trip and feeds every reader', () => {
        const s = parseCacheJson(snapshotToCacheJson(parseUsage('{"plan_type":"plus"}', null)));
        assertEqual(s.resetCredits, null);
        assertEqual(resetCredits(s).length, 0);
        assertEqual(placeholders(s, new Date()).get('oai_resets_available'), '0');
        assertEqual(notifyRows(s).length, 0);
    });

    it('a 90-character title is dropped, the credit kept', () => {
        const s = parseUsage(withResetBlock({available_count: 1, credits: [{status: 'available', title: 'x'.repeat(90)}]}), null);
        assertEqual(s.resetCredits.credits.length, 1);
        assertEqual(s.resetCredits.credits[0].title, null);
    });

    it('a blank title is dropped', () => {
        const s = parseUsage(withResetBlock({available_count: 1, credits: [{status: 'available', title: '   '}]}), null);
        assertEqual(s.resetCredits.credits[0].title, null);
    });

    it('expires_at null → expiresAt null', () => {
        const s = parseUsage(withResetBlock({available_count: 1, credits: [{status: 'available', expires_at: null}]}), null);
        assertEqual(s.resetCredits.credits[0].expiresAt, null);
    });

    it('parseResetCredits reads the detail response', () => {
        const credits = parseResetCredits(JSON.stringify({
            available_count: 9,
            credits: [{id: 'x', status: 'available', title: 'T', expires_at: '2026-07-17T00:00:00Z'}, {status: 'redeemed'}],
        }));
        assertEqual(credits.length, 1);
        assertEqual(credits[0].title, 'T');
    });

    it('parseResetCredits throws on a malformed body', () => {
        assertThrows(() => parseResetCredits('not json'));
        assertThrows(() => parseResetCredits('[]'));
        assertThrows(() => parseResetCredits('{"credits":"x"}'));
    });

    it('mergeResetCredits keeps the usage count, not the detail count', () => {
        const s = parseUsage(withResetBlock({available_count: 2}), null);
        const merged = mergeResetCredits(s, [{title: 'T', expiresAt: null}]);
        assertEqual(merged.resetCredits.available, 2);
        assertEqual(merged.resetCredits.credits.length, 1);
        assertEqual(s.resetCredits.credits.length, 0);
    });

    it('credits survive the cache round-trip', () => {
        const s = parseUsage(withResetBlock({
            available_count: 2,
            credits: [
                {status: 'available', title: SAME_TITLE, expires_at: '2026-07-17T00:00:00Z'},
                {status: 'available', expires_at: null},
            ],
        }), null);
        const back = parseCacheJson(snapshotToCacheJson(s));
        assertEqual(back.resetCredits.available, 2);
        assertEqual(back.resetCredits.credits[0].title, SAME_TITLE);
        assertEqual(back.resetCredits.credits[0].expiresAt.getTime(), Date.parse('2026-07-17T00:00:00Z'));
        assertEqual(back.resetCredits.credits[1].title, null);
        assertEqual(back.resetCredits.credits[1].expiresAt, null);
    });

    it('placeholders expose the count and its phrase', () => {
        const now = new Date('2026-06-05T12:00:00Z');
        const m = placeholders(parseUsage(withResetBlock({available_count: 2}), null), now);
        assertEqual(m.get('oai_resets_available'), '2');
        assertEqual(m.get('oai_resets'), '2 resets available');
        const one = placeholders(parseUsage(withResetBlock({available_count: 1}), null), now);
        assertEqual(one.get('oai_resets'), '1 reset available');
    });

    it('placeholders with no credits → 0', () => {
        const m = placeholders(parseUsage('{"plan_type":"plus"}', null), new Date());
        assertEqual(m.get('oai_resets_available'), '0');
        assertEqual(m.get('oai_resets'), '0 resets available');
    });

    it('placeholders use the injected ngettext', () => {
        const ngettext = (one, many, n) => (n === 1 ? `<${one}>` : `<${many}>`);
        const m = placeholders(parseUsage(withResetBlock({available_count: 2}), null), new Date(), ngettext);
        assertEqual(m.get('oai_resets'), '<2 resets available>');
    });
});

const PACE_NOW = new Date('2026-06-05T12:00:00Z');
const halfway = windowMs => new Date(PACE_NOW.getTime() + windowMs / 2);

describe('placeholders: session_/weekly_ pace aliases', () => {
    const snap = {
        plan: 'ChatGPT Plus',
        session: {utilizationPct: 60, resetsAt: halfway(SESSION_MS), windowMs: SESSION_MS},
        weekly: {utilizationPct: 20, resetsAt: halfway(WEEKLY_MS), windowMs: WEEKLY_MS},
        codeReview: null,
        credits: null,
    };
    const m = placeholders(snap, PACE_NOW);

    it('mirror the oai_ keys', () => {
        assertEqual(m.get('session_elapsed'), m.get('oai_session_elapsed'));
        assertEqual(m.get('session_elapsed'), '50');
        assertEqual(m.get('session_pace'), '↑');
        assertEqual(m.get('weekly_elapsed'), '50');
        assertEqual(m.get('weekly_pace'), '↓');
    });

    it('a window at its cap shows no pace glyph', () => {
        const capped = placeholders({...snap, session: {...snap.session, utilizationPct: 100}}, PACE_NOW);
        assertEqual(capped.get('session_pace'), '');
        assertEqual(capped.get('oai_session_pace'), '');
    });
});

describe('notifyRows / resetCredits', () => {
    const w = pct => ({utilizationPct: pct, resetsAt: null, windowMs: WEEKLY_MS});

    it('rows only for the windows present', () => {
        const rows = notifyRows({plan: 'x', session: null, weekly: w(98), codeReview: w(10), credits: null});
        assertEqual(rows.map(r => r.key).join(','), 'weekly,code-review');
        assertEqual(rows[0].label, 'Codex weekly');
        assertEqual(rows[0].percent, 98);
    });

    it('credits come from resetCredits, [] when absent', () => {
        const credits = [{title: 'T', expiresAt: null}];
        assertEqual(resetCredits({resetCredits: {available: 1, credits}}), credits);
        assertEqual(resetCredits({}).length, 0);
    });
});

describe('placeholders: credit balance', () => {
    it('oai_credit_balance carries the bare count', () => {
        const s = parseUsage('{"credits":{"balance":"62500","has_credits":true,"unlimited":false}}', null);
        assertEqual(placeholders(s, new Date()).get('oai_credit_balance'), '62500');
    });
    it('the message estimates stay available as placeholders', () => {
        const s = parseUsage('{"credits":{"balance":1,"approx_local_messages":[100,200],"approx_cloud_messages":[30,50]}}', null);
        const m = placeholders(s, new Date());
        assertEqual(m.get('oai_local_msgs'), '100-200');
        assertEqual(m.get('oai_cloud_msgs'), '30-50');
    });
});

system.exit(summary());

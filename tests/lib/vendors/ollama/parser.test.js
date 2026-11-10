import system from 'system';

import {
    parseUsage, placeholders, ollamaPeakUsage, ollamaSeverity, notifyRows, resetCredits, fakeSnapshot,
    snapshotToCacheJson, parseCacheJson, planLabel, SchemaError, SESSION_MS, WEEKLY_MS, MONTHLY_MS,
} from '../../../../lib/vendors/ollama/parser.js';
import {Severity} from '../../../../lib/severity.js';
import {substitute} from '../../../../lib/format.js';
import {describe, it, assertEqual, assertThrows, summary} from '../../../_assert.js';

// Real `/api/balance` captures pinned by the upstream project
// (tests/fixtures/ollama/balance_quota.json and balance_credits.json).
const QUOTA = JSON.stringify({
    included: {
        session: {remaining_percent: 100, resets_at: '2026-10-08T19:00:00Z'},
        weekly: {remaining_percent: 59.19, resets_at: '2026-10-12T00:00:00Z'},
    },
    purchased: {balance_usd: 0},
});
const CREDITS = JSON.stringify({
    included: {
        balance_usd: 45,
        allowance_usd: 60,
        period: {from: '2026-10-08T08:00:00Z', until: '2026-11-08T08:00:00Z'},
    },
    purchased: {balance_usd: 12.5},
});
const NOW = new Date('2026-10-08T17:00:00Z');

describe('parseUsage: session/weekly quota account', () => {
    const s = parseUsage(QUOTA, 'Pro');

    it('utilization is the complement of remaining_percent', () => {
        assertEqual(s.session.utilizationPct, 0);
        assertEqual(s.weekly.utilizationPct, 41); // 59.19 left rounds to 41 used
    });
    it('resets travel with the windows', () => {
        assertEqual(s.session.resetsAt.toISOString(), '2026-10-08T19:00:00.000Z');
        assertEqual(s.weekly.resetsAt.toISOString(), '2026-10-12T00:00:00.000Z');
    });
    it('window lengths are 5 h and 7 d', () => {
        assertEqual(s.session.windowMs, SESSION_MS);
        assertEqual(s.weekly.windowMs, WEEKLY_MS);
    });
    it('a zero purchased balance invents neither credits nor a month', () => {
        assertEqual(s.credits, null);
        assertEqual(s.monthly, null);
    });
    it('the plan comes from the prefs', () => assertEqual(s.plan, 'Pro'));
    it('remaining outside [0, 100] saturates', () => {
        const over = parseUsage(JSON.stringify({included: {
            session: {remaining_percent: -5, resets_at: '2026-10-08T19:00:00Z'},
            weekly: {remaining_percent: 140, resets_at: '2026-10-12T00:00:00Z'},
        }}));
        assertEqual(over.session.utilizationPct, 100);
        assertEqual(over.weekly.utilizationPct, 0);
    });
});

describe('parseUsage: monthly credits account', () => {
    const s = parseUsage(CREDITS, null);

    it('the month is the share of the allowance spent', () => assertEqual(s.monthly.utilizationPct, 25));
    it('the month resets at the end of the billing period', () =>
        assertEqual(s.monthly.resetsAt.toISOString(), '2026-11-08T08:00:00.000Z'));
    it('the window is the real period length', () =>
        assertEqual(s.monthly.windowMs, Date.parse('2026-11-08T08:00:00Z') - Date.parse('2026-10-08T08:00:00Z')));
    it('carries the balance, the allowance and purchased credits', () => {
        assertEqual(s.credits.balanceUsd, 45);
        assertEqual(s.credits.allowanceUsd, 60);
        assertEqual(s.credits.purchasedUsd, 12.5);
    });
    it('no session or weekly window', () => {
        assertEqual(s.session, null);
        assertEqual(s.weekly, null);
    });
    it('no purchased block → purchasedUsd null', () => {
        const body = JSON.parse(CREDITS);
        delete body.purchased;
        assertEqual(parseUsage(JSON.stringify(body)).credits.purchasedUsd, null);
    });
    it('a zero allowance is not a fabricated percentage', () => {
        const z = parseUsage(JSON.stringify({included: {balance_usd: 0, allowance_usd: 0,
            period: {from: '2026-10-01T00:00:00Z', until: '2026-11-01T00:00:00Z'}}}));
        assertEqual(z.monthly, null);
        assertEqual(z.credits.balanceUsd, 0);
    });
    it('a balance above the allowance reads as 0% used', () => {
        const b = JSON.parse(CREDITS);
        b.included.balance_usd = 80;
        assertEqual(parseUsage(JSON.stringify(b)).monthly.utilizationPct, 0);
    });
});

describe('parseUsage: rejected shapes', () => {
    const rejected = [
        ['usage history', '{"range":"7d","totals":{"request_count":213,"usage_usd":0.2},"buckets":[]}'],
        ['empty object', '{}'],
        ['empty included', '{"included":{}}'],
        ['balance alone', '{"included":{"balance_usd":45}}'],
        ['the old /api/usage limits', '{"limits":{"session":{"usage":0.4}}}'],
        ['session without weekly', '{"included":{"session":{"remaining_percent":10,"resets_at":"2026-10-08T19:00:00Z"}}}'],
        ['unparseable reset', '{"included":{"session":{"remaining_percent":10,"resets_at":"soon"},"weekly":{"remaining_percent":10,"resets_at":"2026-10-12T00:00:00Z"}}}'],
        ['a malformed purchased block', JSON.stringify({...JSON.parse(CREDITS), purchased: {balance_usd: 'lots'}})],
        ['not JSON', 'nope'],
        ['a top-level array', '[]'],
    ];
    for (const [what, body] of rejected)
        it(what, () => assertThrows(() => parseUsage(body), SchemaError));
});

describe('peak usage and severity', () => {
    it('the highest window and its reset win', () => {
        const peak = ollamaPeakUsage(parseUsage(QUOTA));
        assertEqual(peak.percent, 41);
        assertEqual(peak.resetsAt.toISOString(), '2026-10-12T00:00:00.000Z');
    });
    it('a credits account peaks on its month', () => assertEqual(ollamaPeakUsage(parseUsage(CREDITS)).percent, 25));
    it('no window at all is 0%', () => {
        const z = parseUsage(JSON.stringify({included: {balance_usd: 0, allowance_usd: 0,
            period: {from: '2026-10-01T00:00:00Z', until: '2026-11-01T00:00:00Z'}}}));
        assertEqual(ollamaPeakUsage(z).percent, 0);
        assertEqual(ollamaSeverity(z), Severity.LOW);
    });
});

describe('placeholders', () => {
    it('quota windows get real resets, elapsed and pace', () => {
        const m = placeholders(parseUsage(QUOTA, 'Pro'), NOW);
        assertEqual(m.get('oll_weekly_pct'), '41');
        assertEqual(m.get('weekly_pct'), '41');
        assertEqual(m.get('oll_session_reset'), '2h 00m');
        assertEqual(m.get('session_reset'), '2h 00m');
        assertEqual(m.get('oll_session_elapsed'), '60');
        assertEqual(['↑', '→', '↓', ''].includes(m.get('weekly_pace')), true);
        assertEqual(m.get('oll_weekly_pace'), m.get('weekly_pace'));
        assertEqual(m.get('oll_monthly_pct'), '');
        assertEqual(m.get('oll_monthly_reset'), '');
        assertEqual(m.get('oll_monthly_pace'), '');
    });
    it('a window present at 0% renders 0, an absent one stays empty', () => {
        const m = placeholders(parseUsage(QUOTA), NOW);
        assertEqual(m.get('oll_session_pct'), '0');
        assertEqual(m.get('oll_monthly_pct'), '');
    });
    it('credits placeholders format as money', () => {
        const m = placeholders(parseUsage(CREDITS), NOW);
        assertEqual(substitute('{oll_balance} / {oll_allowance} +{oll_purchased}', m), '$45.00 / $60.00 +$12.50');
        assertEqual(m.get('oll_monthly_pct'), '25');
        assertEqual(m.get('session_pct'), '');
        assertEqual(m.get('session_pace'), '');
    });
    it('credits placeholders are empty on a quota account', () => {
        const m = placeholders(parseUsage(QUOTA), NOW);
        assertEqual(m.get('oll_balance'), '');
        assertEqual(m.get('oll_allowance'), '');
        assertEqual(m.get('oll_purchased'), '');
    });
    it('oll_cost keeps a saved format rendering', () =>
        assertEqual(placeholders(parseUsage(QUOTA), NOW).get('oll_cost'), '-'));
    it('plan falls back to the vendor name', () => {
        assertEqual(placeholders(parseUsage(QUOTA), NOW).get('plan'), 'Ollama');
        assertEqual(planLabel({plan: 'Max'}), 'Max');
    });
});

describe('notifyRows / resetCredits', () => {
    it('one row per present window, with its real reset', () => {
        const rows = notifyRows(parseUsage(QUOTA));
        assertEqual(rows.map(r => r.key).join(','), 'session,weekly');
        assertEqual(rows[1].percent, 41);
        assertEqual(rows[1].resetsAt.toISOString(), '2026-10-12T00:00:00.000Z');
    });
    it('a credits account notifies on its month', () =>
        assertEqual(notifyRows(parseUsage(CREDITS)).map(r => r.key).join(','), 'monthly'));
    it('no banked resets', () => assertEqual(resetCredits(parseUsage(QUOTA)).length, 0));
});

describe('cache round-trip', () => {
    it('keeps dates, windows and credits', () => {
        const back = parseCacheJson(snapshotToCacheJson(parseUsage(CREDITS, 'Pro')));
        assertEqual(back.monthly.resetsAt instanceof Date, true);
        assertEqual(back.credits.purchasedUsd, 12.5);
        assertEqual(back.plan, 'Pro');
    });
    it('a version 1 cache is refused', () =>
        assertThrows(() => parseCacheJson('{"cacheVersion":1,"snapshot":{"session":null}}'), SchemaError));
});

describe('fakeSnapshot', () => {
    const f = fakeSnapshot(40, NOW);
    it('every window at the percentage, with a real reset', () => {
        for (const [w, ms] of [['session', SESSION_MS], ['weekly', WEEKLY_MS], ['monthly', MONTHLY_MS]]) {
            assertEqual(f[w].utilizationPct, 40, w);
            assertEqual(f[w].resetsAt.getTime(), NOW.getTime() + ms, w);
        }
    });
    it('carries a credits block', () => assertEqual(f.credits.balanceUsd, 36));
});

system.exit(summary());

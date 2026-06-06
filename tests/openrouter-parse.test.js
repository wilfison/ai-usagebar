import system from 'system';

import {
    parseCredits, parseKey, combine, balance, consumedPct,
    snapshotToCacheJson, parseCacheJson, openrouterSeverity, placeholders,
} from '../lib/vendors/openrouter-parse.js';
import {substitute} from '../lib/format.js';
import {Severity} from '../lib/severity.js';
import {describe, it, assertEqual, summary} from './_assert.js';

describe('parseCredits / parseKey', () => {
    it('parses the credits envelope', () => {
        const c = parseCredits('{"data":{"total_credits":100.0,"total_usage":25.5}}');
        assertEqual(c.totalCredits, 100);
        assertEqual(c.totalUsage, 25.5);
    });

    it('parses the key envelope with null limits', () => {
        const k = parseKey('{"data":{"label":"my-key","limit":null,"limit_remaining":null,"usage":12.34,"usage_daily":1.0,"usage_weekly":3.0,"usage_monthly":12.0,"is_free_tier":false}}');
        assertEqual(k.label, 'my-key');
        assertEqual(k.limit, null);
        assertEqual(k.usageMonthly, 12);
        assertEqual(k.isFreeTier, false);
    });
});

describe('combine', () => {
    it('builds the snapshot with balance, consumed%, and label', () => {
        const snap = combine(
            {totalCredits: 100, totalUsage: 30},
            {label: 'key-A', limit: 50, limitRemaining: 20, usageDaily: 1, usageWeekly: 5, usageMonthly: 30, isFreeTier: false},
        );
        assertEqual(snap.label, 'OpenRouter — key-A');
        assertEqual(balance(snap), 70);
        assertEqual(consumedPct(snap), 30);
        assertEqual(snap.usageMonthly, 30);
    });

    it('empty label → OpenRouter', () => {
        const snap = combine({totalCredits: 0, totalUsage: 0},
            {label: '', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: true});
        assertEqual(snap.label, 'OpenRouter');
    });

    it('consumedPct is 0 when credits are 0', () => {
        const snap = combine({totalCredits: 0, totalUsage: 5},
            {label: 'x', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: true});
        assertEqual(consumedPct(snap), 0);
    });
});

describe('cache JSON round-trip', () => {
    it('snapshotToCacheJson → parseCacheJson is identity', () => {
        const snap = combine({totalCredits: 100, totalUsage: 25.5},
            {label: 'prod', limit: 50, limitRemaining: 24.5, usageDaily: 1, usageWeekly: 7, usageMonthly: 25.5, isFreeTier: false});
        const round = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(round.label, 'OpenRouter — prod');
        assertEqual(round.totalCredits, 100);
        assertEqual(round.limit, 50);
        assertEqual(round.limitRemaining, 24.5);
        assertEqual(round.isFreeTier, false);
    });
});

describe('openrouterSeverity', () => {
    it('keys on consumed percentage', () => {
        const crit = combine({totalCredits: 100, totalUsage: 92}, {label: '', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: false});
        assertEqual(openrouterSeverity(crit), Severity.CRITICAL);
        const mid = combine({totalCredits: 100, totalUsage: 60}, {label: '', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: false});
        assertEqual(openrouterSeverity(mid), Severity.MID);
    });
});

describe('placeholders', () => {
    const snap = combine({totalCredits: 100, totalUsage: 25.5},
        {label: 'prod', limit: 50, limitRemaining: 24.5, usageDaily: 1, usageWeekly: 7, usageMonthly: 25.5, isFreeTier: false});

    it('emits money-formatted or_* keys + cross-vendor aliases', () => {
        const m = placeholders(snap, new Date());
        assertEqual(m.get('or_balance'), '$74.50');
        assertEqual(m.get('or_used_today'), '$1.00');
        assertEqual(m.get('or_limit'), '$50.00');
        assertEqual(m.get('or_free_tier'), 'paid');
        assertEqual(m.get('session_pct'), '26');
        assertEqual(m.get('session_reset'), '—');
    });

    it('absent limit → unlimited', () => {
        const noLimit = combine({totalCredits: 10, totalUsage: 1},
            {label: '', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: true});
        assertEqual(placeholders(noLimit, new Date()).get('or_limit'), 'unlimited');
    });

    it('renders the shared cross-vendor format', () =>
        assertEqual(substitute('{vendor_short} {session_pct}%', placeholders(snap, new Date())), 'opr 26%'));
});

system.exit(summary());

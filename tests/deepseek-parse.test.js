import system from 'system';

import {
    parseBalance, deepseekSeverity, formatMoney, placeholders,
    snapshotToCacheJson, parseCacheJson,
} from '../lib/vendors/deepseek-parse.js';
import {Severity} from '../lib/severity.js';
import {describe, it, assertEqual, summary} from './_assert.js';

describe('parseBalance', () => {
    it('prefers the USD info', () => {
        const s = parseBalance(JSON.stringify({
            is_available: true,
            balance_infos: [
                {currency: 'CNY', total_balance: '10.00', granted_balance: '10.00', topped_up_balance: '0.00'},
                {currency: 'USD', total_balance: '1.50', granted_balance: '1.50', topped_up_balance: '0.00'},
            ],
        }));
        assertEqual(s.isAvailable, true);
        assertEqual(s.currency, 'USD');
        assertEqual(s.balance, 1.5);
    });

    it('falls back to CNY when no USD', () => {
        const s = parseBalance(JSON.stringify({
            is_available: true,
            balance_infos: [{currency: 'CNY', total_balance: '20.00', granted_balance: '20.00', topped_up_balance: '0.00'}],
        }));
        assertEqual(s.currency, 'CNY');
        assertEqual(s.balance, 20);
    });

    it('empty balance_infos → unavailable, zero, blank currency', () => {
        const s = parseBalance('{"is_available":false,"balance_infos":[]}');
        assertEqual(s.isAvailable, false);
        assertEqual(s.balance, 0);
        assertEqual(s.currency, '');
    });
});

describe('deepseekSeverity', () => {
    it('unavailable → critical', () =>
        assertEqual(deepseekSeverity({isAvailable: false, balance: 999, currency: 'USD'}), Severity.CRITICAL));

    it('USD thresholds (1/5/20)', () => {
        assertEqual(deepseekSeverity({isAvailable: true, balance: 0.5, currency: 'USD'}), Severity.CRITICAL);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 3, currency: 'USD'}), Severity.HIGH);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 10, currency: 'USD'}), Severity.MID);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 50, currency: 'USD'}), Severity.LOW);
    });

    it('CNY thresholds (7/35/140)', () => {
        assertEqual(deepseekSeverity({isAvailable: true, balance: 5, currency: 'CNY'}), Severity.CRITICAL);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 20, currency: 'CNY'}), Severity.HIGH);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 100, currency: 'CNY'}), Severity.MID);
        assertEqual(deepseekSeverity({isAvailable: true, balance: 200, currency: 'CNY'}), Severity.LOW);
    });
});

describe('formatMoney', () => {
    it('USD → $', () => assertEqual(formatMoney(5, 'USD'), '$5.00'));
    it('CNY → ¥', () => assertEqual(formatMoney(20, 'CNY'), '¥20.00'));
    it('other → {v} {cur}', () => assertEqual(formatMoney(3, 'EUR'), '3.00 EUR'));
});

describe('cache JSON round-trip', () => {
    it('snapshotToCacheJson → parseCacheJson is identity', () => {
        const snap = {isAvailable: true, balance: 5.5, granted: 5, toppedUp: 0.5, currency: 'USD'};
        const round = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(round.isAvailable, true);
        assertEqual(round.balance, 5.5);
        assertEqual(round.toppedUp, 0.5);
        assertEqual(round.currency, 'USD');
    });
});

describe('placeholders', () => {
    it('emits ds_* family + cross-vendor aliases', () => {
        const m = placeholders({isAvailable: true, balance: 5, granted: 5, toppedUp: 0, currency: 'USD'}, new Date());
        assertEqual(m.get('ds_balance'), '$5.00');
        assertEqual(m.get('ds_available'), 'up');
        assertEqual(m.get('currency'), 'USD');
        assertEqual(m.get('plan'), 'DeepSeek');
        assertEqual(m.get('session_pct'), '0');
        assertEqual(m.get('session_reset'), '—');
    });
});

system.exit(summary());

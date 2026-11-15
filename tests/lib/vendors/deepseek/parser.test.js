import system from 'system';

import {
    parseBalance, deepseekSeverity, deepseekPeakUsage, placeholders, SchemaError,
    snapshotToCacheJson, parseCacheJson, CACHE_VERSION, fakeSnapshot, notifyRows, resetCredits,
} from '../../../../lib/vendors/deepseek/parser.js';
import {Severity} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertThrows, summary} from '../../../_assert.js';

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

    it('empty balance_infos → schema drift (no currency to scale by)', () =>
        assertThrows(() => parseBalance('{"is_available":false,"balance_infos":[]}')));

    it('a currency other than USD/CNY → SchemaError, never read on the USD scale', () => {
        let threw = false;
        try {
            parseBalance(JSON.stringify({
                is_available: true,
                balance_infos: [{currency: 'EUR', total_balance: '3.00', granted_balance: '3.00', topped_up_balance: '0.00'}],
            }));
        } catch (e) {
            threw = e instanceof SchemaError;
        }
        assertEqual(threw, true);
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

describe('deepseekPeakUsage', () => {
    it('has no percentage or reset window (notifies via severity)', () => {
        const p = deepseekPeakUsage({isAvailable: true, balance: 0.5, currency: 'USD'});
        assertEqual(p.percent, null);
        assertEqual(p.resetsAt, null);
    });
});

describe('corrupt payloads throw instead of coining a zero balance', () => {
    it('parseBalance rejects unparseable, non-object and non-numeric bodies', () => {
        assertThrows(() => parseBalance('not json'));
        assertThrows(() => parseBalance('[]'));
        assertThrows(() => parseBalance(JSON.stringify({is_available: true,
            balance_infos: [{currency: 'USD', total_balance: 'lots', granted_balance: '0', topped_up_balance: '0'}]})));
    });

    it('parseCacheJson rejects a corrupt cache', () => {
        const v = snapshot => JSON.stringify({cacheVersion: CACHE_VERSION, snapshot});
        assertThrows(() => parseCacheJson('{'));
        assertThrows(() => parseCacheJson('null'));
        assertThrows(() => parseCacheJson(v({isAvailable: true, balance: '5', granted: 0, toppedUp: 0, currency: 'USD'})));
        assertThrows(() => parseCacheJson(v({isAvailable: true, balance: 5, granted: 0, toppedUp: 0, currency: ''})));
    });

    it('the cache is versioned; an unversioned one from an older release is refused', () => {
        const snap = {isAvailable: true, balance: 5, granted: 5, toppedUp: 0, currency: 'USD'};
        assertEqual(JSON.parse(snapshotToCacheJson(snap)).cacheVersion, CACHE_VERSION);
        assertThrows(() => parseCacheJson('{"is_available":true,"balance":3,"granted":3,"topped_up":0,"currency":"USD"}'));
    });
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
        assertEqual(placeholders({isAvailable: true, balance: -5.71, granted: 0, toppedUp: 0, currency: 'CNY'}, new Date())
            .get('ds_balance'), '-¥5.71');
        assertEqual(m.get('ds_available'), 'up');
        assertEqual(m.get('currency'), 'USD');
        assertEqual(m.get('plan'), 'DeepSeek');
        assertEqual(m.get('session_pct'), '0');
        assertEqual(m.get('session_reset'), '-');
    });
});

describe('fakeSnapshot', () => {
    it('reads pct as the consumed share of a nominal $100 balance', () => {
        const s = fakeSnapshot(23);
        assertEqual(s.isAvailable, true);
        assertEqual(s.balance, 77);
        assertEqual(s.currency, 'USD');
        assertEqual(deepseekSeverity(s), Severity.LOW);
    });

    it('leaves a critical balance at high pct', () => {
        assertEqual(deepseekSeverity(fakeSnapshot(100)), Severity.CRITICAL);
    });
});

describe('placeholders: elapsed aliases', () => {
    it('no window → 0', () => {
        const m = placeholders({isAvailable: true, balance: 5, granted: 5, toppedUp: 0, currency: 'USD'}, new Date());
        assertEqual(m.get('session_elapsed'), '0');
        assertEqual(m.get('weekly_elapsed'), '0');
    });
});

describe('notifyRows / resetCredits', () => {
    it('a balance has nothing to notify', () => {
        const snap = {isAvailable: true, balance: 0.5, granted: 0, toppedUp: 0.5, currency: 'USD'};
        assertEqual(notifyRows(snap).length, 0);
        assertEqual(resetCredits(snap).length, 0);
    });
});

system.exit(summary());

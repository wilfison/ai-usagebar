import {Severity} from '../../severity.js';
import {clampPct} from '../fake.js';
import {formatMoney} from '../../format.js';
import {SchemaError, decodeJsonObject} from '../parse-common.js';

export {SchemaError};

export const ICON = '󰧑';
export const VENDOR_SHORT = 'dsk';

function parseAmount(s, field) {
    const text = typeof s === 'string' ? s.trim() : '';
    const n = Number(text);
    if (text === '' || !Number.isFinite(n))
        throw new SchemaError(`deepseek balance '${field}' is not numeric: ${JSON.stringify(s ?? null)}`);
    return n;
}

function decodeObject(bytesOrText, what) {
    return decodeJsonObject(bytesOrText, `deepseek ${what}`);
}

function checkCurrency(currency) {
    // The severity thresholds exist only for USD and CNY; any other currency
    // would be read on the USD scale.
    if (currency !== 'USD' && currency !== 'CNY')
        throw new SchemaError(`deepseek: unsupported balance currency ${JSON.stringify(currency ?? null)}`);
    return currency;
}

export function parseBalance(bytesOrText) {
    const obj = decodeObject(bytesOrText, 'balance response');

    const infos = Array.isArray(obj.balance_infos) ? obj.balance_infos : [];
    const info = infos.find(b => b && b.currency === 'USD')
        ?? infos.find(b => b && b.currency === 'CNY')
        ?? infos[0]
        ?? {};

    const currency = checkCurrency(info.currency);

    return {
        isAvailable: obj.is_available === true,
        balance: parseAmount(info.total_balance, 'total_balance'),
        granted: parseAmount(info.granted_balance, 'granted_balance'),
        toppedUp: parseAmount(info.topped_up_balance, 'topped_up_balance'),
        currency,
    };
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT).
// DeepSeek has no usage percentage, so pct is read as the share of a nominal
// $100 balance already consumed: higher pct leaves less balance (worse severity).
export function fakeSnapshot(pct) {
    const remaining = 100 - clampPct(pct);
    return {
        isAvailable: true,
        balance: remaining,
        granted: remaining,
        toppedUp: 0,
        currency: 'USD',
    };
}

// Balance-only vendor: no percentage, so notifications fall back to severity.
export function deepseekPeakUsage(_snap) {
    return {percent: null, resetsAt: null};
}

export function deepseekSeverity(snap) {
    if (!snap.isAvailable)
        return Severity.CRITICAL;
    const [tCritical, tHigh, tMid] = snap.currency === 'CNY' ? [7, 35, 140] : [1, 5, 20];
    if (snap.balance < tCritical)
        return Severity.CRITICAL;
    if (snap.balance < tHigh)
        return Severity.HIGH;
    if (snap.balance < tMid)
        return Severity.MID;
    return Severity.LOW;
}

export function snapshotToCacheJson(snap) {
    return JSON.stringify({
        is_available: snap.isAvailable,
        balance: snap.balance,
        granted: snap.granted,
        topped_up: snap.toppedUp,
        currency: snap.currency,
    });
}

// A corrupt cache throws rather than coining a zero balance.
export function parseCacheJson(bytesOrText) {
    const v = decodeObject(bytesOrText, 'cache');
    const n = (x, field) => {
        if (typeof x !== 'number' || !Number.isFinite(x))
            throw new SchemaError(`deepseek cache: ${field} is not a number`);
        return x;
    };
    return {
        isAvailable: v.is_available === true,
        balance: n(v.balance, 'balance'),
        granted: n(v.granted, 'granted'),
        toppedUp: n(v.topped_up, 'topped_up'),
        currency: checkCurrency(v.currency),
    };
}

export function placeholders(snap, _now) {
    const m = new Map();
    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', '0');
    m.set('session_reset', '-');
    m.set('weekly_pct', '0');
    m.set('weekly_reset', '-');
    m.set('session_elapsed', '0');
    m.set('weekly_elapsed', '0');
    m.set('plan', 'DeepSeek');

    m.set('ds_balance', formatMoney(snap.balance, snap.currency));
    m.set('ds_granted', formatMoney(snap.granted, snap.currency));
    m.set('ds_topped_up', formatMoney(snap.toppedUp, snap.currency));
    m.set('ds_available', snap.isAvailable ? 'up' : 'down');
    m.set('currency', snap.currency);

    return m;
}

// A balance has no percentage to cross, so DeepSeek raises no notification.
export function notifyRows(_snap) {
    return [];
}

export function resetCredits(_snap) {
    return [];
}

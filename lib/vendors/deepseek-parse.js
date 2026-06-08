import {Severity} from '../severity.js';

export const ICON = '󰧑';
export const VENDOR_SHORT = 'dsk';

function parseAmount(s) {
    const n = Number(String(s ?? '').trim());
    return Number.isFinite(n) ? n : 0;
}

export function parseBalance(bytesOrText) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);

    let obj;
    try {
        obj = JSON.parse(text);
    } catch (_) {
        obj = null;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        return {isAvailable: false, balance: 0, granted: 0, toppedUp: 0, currency: ''};

    const infos = Array.isArray(obj.balance_infos) ? obj.balance_infos : [];
    const info = infos.find(b => b && b.currency === 'USD')
        ?? infos.find(b => b && b.currency === 'CNY')
        ?? infos[0]
        ?? {};

    return {
        isAvailable: obj.is_available === true,
        balance: parseAmount(info.total_balance),
        granted: parseAmount(info.granted_balance),
        toppedUp: parseAmount(info.topped_up_balance),
        currency: typeof info.currency === 'string' ? info.currency : '',
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

export function formatMoney(v, currency) {
    if (currency === 'USD')
        return `$${v.toFixed(2)}`;
    if (currency === 'CNY')
        return `¥${v.toFixed(2)}`;
    return `${v.toFixed(2)} ${currency}`;
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

export function parseCacheJson(bytesOrText) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let v;
    try {
        v = JSON.parse(text);
    } catch (_) {
        v = null;
    }
    if (v === null || typeof v !== 'object' || Array.isArray(v))
        return {isAvailable: false, balance: 0, granted: 0, toppedUp: 0, currency: ''};
    const n = x => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    return {
        isAvailable: v.is_available === true,
        balance: n(v.balance),
        granted: n(v.granted),
        toppedUp: n(v.topped_up),
        currency: typeof v.currency === 'string' ? v.currency : '',
    };
}

export function placeholders(snap, _now) {
    const m = new Map();
    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', '0');
    m.set('session_reset', '—');
    m.set('weekly_pct', '0');
    m.set('weekly_reset', '—');
    m.set('plan', 'DeepSeek');

    m.set('ds_balance', formatMoney(snap.balance, snap.currency));
    m.set('ds_granted', formatMoney(snap.granted, snap.currency));
    m.set('ds_topped_up', formatMoney(snap.toppedUp, snap.currency));
    m.set('ds_available', snap.isAvailable ? 'up' : 'down');
    m.set('currency', snap.currency);

    return m;
}

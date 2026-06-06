/**
 * @file Pure DeepSeek parsing, cache repr, severity, and placeholder map. Reads
 * `/user/balance` into a normalized {@link DeepseekSnapshot} (preferring the USD
 * balance, then CNY, then the first listed), with currency-scaled severity
 * thresholds. The cache stores the normalized snapshot JSON.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {Severity} from '../severity.js';

/** @type {string} Panel icon glyph. */
export const ICON = '󰧑';
/** @type {string} Short vendor tag shown in the bar. */
export const VENDOR_SHORT = 'dsk';

/**
 * @typedef {object} DeepseekSnapshot
 * @property {boolean} isAvailable
 * @property {number} balance - current balance in `currency`.
 * @property {number} granted - granted (free) balance.
 * @property {number} toppedUp - paid top-up balance.
 * @property {string} currency - 'USD', 'CNY', or '' when unknown.
 */

/**
 * Parse a balance string strictly: `Number(trim(s))` with `NaN → 0` (mirrors a
 * strict float parse; not the lenient `parseFloat`).
 * @param {*} s
 * @returns {number}
 */
function parseAmount(s) {
    const n = Number(String(s ?? '').trim());
    return Number.isFinite(n) ? n : 0;
}

/**
 * Parse the `/user/balance` body into a normalized snapshot.
 * @param {Uint8Array | string} bytesOrText - raw response body.
 * @returns {DeepseekSnapshot}
 */
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

/**
 * Currency-scaled balance severity. Unavailable → critical; otherwise the
 * balance is bucketed against currency-specific (critical, high, mid) boundaries:
 * CNY `(7, 35, 140)`, otherwise (USD/unknown) `(1, 5, 20)`.
 * @param {DeepseekSnapshot} snap
 * @returns {string} a {@link module:lib/severity.Severity} tier.
 */
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

/**
 * Format a money amount: `$` for USD, `¥` for CNY, else `{v} {currency}`.
 * @param {number} v
 * @param {string} currency
 * @returns {string}
 */
export function formatMoney(v, currency) {
    if (currency === 'USD')
        return `$${v.toFixed(2)}`;
    if (currency === 'CNY')
        return `¥${v.toFixed(2)}`;
    return `${v.toFixed(2)} ${currency}`;
}

/**
 * Serialize the snapshot to the cache JSON repr.
 * @param {DeepseekSnapshot} snap
 * @returns {string}
 */
export function snapshotToCacheJson(snap) {
    return JSON.stringify({
        is_available: snap.isAvailable,
        balance: snap.balance,
        granted: snap.granted,
        topped_up: snap.toppedUp,
        currency: snap.currency,
    });
}

/**
 * Parse the cache JSON repr back into a snapshot.
 * @param {Uint8Array | string} bytesOrText
 * @returns {DeepseekSnapshot}
 */
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

/**
 * Build the DeepSeek placeholder map: cross-vendor aliases (no rate-limit
 * windows) plus the `ds_*` family.
 * @param {DeepseekSnapshot} snap
 * @param {Date} _now - unused; kept for adapter uniformity.
 * @returns {Map<string, string>}
 */
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

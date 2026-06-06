/**
 * @file Pure OpenRouter parsing, combine, cache repr, severity, and placeholder
 * map. The two endpoints (`/api/v1/credits` and `/api/v1/key`) each wrap their
 * payload in `{ "data": { … } }`; {@link combine} merges them into a normalized
 * {@link OpenRouterSnapshot}. Because the snapshot is derived from two responses,
 * the cache stores a normalized snapshot JSON ({@link snapshotToCacheJson}) rather
 * than raw envelopes.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor} from '../severity.js';

/** @type {string} Panel icon glyph. */
export const ICON = '󱙺';
/** @type {string} Short vendor tag shown in the bar. */
export const VENDOR_SHORT = 'opr';

/**
 * Thrown when an envelope body is not valid JSON or not an object.
 */
export class SchemaError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

/**
 * @typedef {object} OpenRouterSnapshot
 * @property {string} label - header label, e.g. `OpenRouter — prod`.
 * @property {number} totalCredits - lifetime credits purchased (USD).
 * @property {number} totalUsage - lifetime usage (USD).
 * @property {number} usageDaily
 * @property {number} usageWeekly
 * @property {number} usageMonthly
 * @property {boolean} isFreeTier
 * @property {?number} limit - per-key ceiling (USD), or null.
 * @property {?number} limitRemaining - per-key remaining (USD), or null.
 */

/**
 * Coerce a value to a finite number, or `fallback` otherwise.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce a value to a finite number, or null.
 * @param {*} v
 * @returns {?number}
 */
function optNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Parse + unwrap the `{data:{…}}` envelope of one endpoint.
 * @param {Uint8Array | string} bytesOrText
 * @param {string} label - endpoint label for error messages.
 * @returns {object} the unwrapped `data` object.
 * @throws {SchemaError} on invalid JSON or a missing/invalid `data` object.
 */
function unwrap(bytesOrText, label) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`openrouter ${label} unparseable: ${e?.message ?? e}`);
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        throw new SchemaError(`openrouter ${label}: top-level value is not an object`);
    const data = obj.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        throw new SchemaError(`openrouter ${label}: missing data object`);
    return data;
}

/**
 * Parse the `/credits` envelope.
 * @param {Uint8Array | string} bytesOrText
 * @returns {{totalCredits: number, totalUsage: number}}
 * @throws {SchemaError}
 */
export function parseCredits(bytesOrText) {
    const d = unwrap(bytesOrText, 'credits');
    return {totalCredits: num(d.total_credits, 0), totalUsage: num(d.total_usage, 0)};
}

/**
 * Parse the `/key` envelope.
 * @param {Uint8Array | string} bytesOrText
 * @returns {object} the normalized key fields.
 * @throws {SchemaError}
 */
export function parseKey(bytesOrText) {
    const d = unwrap(bytesOrText, 'key');
    return {
        label: typeof d.label === 'string' ? d.label : '',
        limit: optNum(d.limit),
        limitRemaining: optNum(d.limit_remaining),
        usageDaily: num(d.usage_daily, 0),
        usageWeekly: num(d.usage_weekly, 0),
        usageMonthly: num(d.usage_monthly, 0),
        isFreeTier: d.is_free_tier === true,
    };
}

/**
 * Combine the two endpoint responses into the canonical snapshot.
 * @param {{totalCredits: number, totalUsage: number}} credits
 * @param {object} key - parsed key fields from {@link parseKey}.
 * @returns {OpenRouterSnapshot}
 */
export function combine(credits, key) {
    const label = key.label ? `OpenRouter — ${key.label}` : 'OpenRouter';
    return {
        label,
        totalCredits: credits.totalCredits,
        totalUsage: credits.totalUsage,
        usageDaily: key.usageDaily,
        usageWeekly: key.usageWeekly,
        usageMonthly: key.usageMonthly,
        isFreeTier: key.isFreeTier,
        limit: key.limit,
        limitRemaining: key.limitRemaining,
    };
}

/**
 * Remaining balance, clamped at 0.
 * @param {OpenRouterSnapshot} snap
 * @returns {number}
 */
export function balance(snap) {
    return Math.max(0, snap.totalCredits - snap.totalUsage);
}

/**
 * Integer percent of total credits consumed (0-100); 0 when total ≤ 0.
 * @param {OpenRouterSnapshot} snap
 * @returns {number}
 */
export function consumedPct(snap) {
    if (snap.totalCredits <= 0)
        return 0;
    return Math.min(100, Math.max(0, Math.round((snap.totalUsage / snap.totalCredits) * 100)));
}

/**
 * Format a USD amount as `$d.dd` (negatives as `-$d.dd`).
 * @param {number} v
 * @returns {string}
 */
export function formatMoney(v) {
    return v < 0 ? `-$${(-v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

/**
 * Serialize the snapshot to the cache JSON repr (`{"snapshot":{…}}`).
 * @param {OpenRouterSnapshot} snap
 * @returns {string}
 */
export function snapshotToCacheJson(snap) {
    return JSON.stringify({
        snapshot: {
            label: snap.label,
            total_credits: snap.totalCredits,
            total_usage: snap.totalUsage,
            usage_daily: snap.usageDaily,
            usage_weekly: snap.usageWeekly,
            usage_monthly: snap.usageMonthly,
            is_free_tier: snap.isFreeTier,
            limit: snap.limit,
            limit_remaining: snap.limitRemaining,
        },
    });
}

/**
 * Parse the cache JSON repr back into a snapshot.
 * @param {Uint8Array | string} bytesOrText
 * @returns {OpenRouterSnapshot}
 * @throws {SchemaError} on invalid JSON or a missing `snapshot` field.
 */
export function parseCacheJson(bytesOrText) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`openrouter cache unparseable: ${e?.message ?? e}`);
    }
    const s = obj?.snapshot;
    if (s === null || typeof s !== 'object' || Array.isArray(s))
        throw new SchemaError('openrouter cache: missing snapshot field');
    return {
        label: typeof s.label === 'string' ? s.label : 'OpenRouter',
        totalCredits: num(s.total_credits, 0),
        totalUsage: num(s.total_usage, 0),
        usageDaily: num(s.usage_daily, 0),
        usageWeekly: num(s.usage_weekly, 0),
        usageMonthly: num(s.usage_monthly, 0),
        isFreeTier: s.is_free_tier === true,
        limit: optNum(s.limit),
        limitRemaining: optNum(s.limit_remaining),
    };
}

/**
 * Severity keyed on consumed-percentage (low credit = critical).
 * @param {OpenRouterSnapshot} snap
 * @returns {string} a {@link module:lib/severity.Severity} tier.
 */
export function openrouterSeverity(snap) {
    return severityFor(consumedPct(snap));
}

/**
 * Build the OpenRouter placeholder map: cross-vendor aliases plus the `or_*`
 * family. The Pango `or_balance_bar` key is intentionally omitted (it becomes the
 * gauge bar widget in the popup).
 * @param {OpenRouterSnapshot} snap
 * @param {Date} _now - unused (no countdowns); kept for adapter uniformity.
 * @returns {Map<string, string>}
 */
export function placeholders(snap, _now) {
    const m = new Map();
    const pct = String(consumedPct(snap));

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', pct);
    m.set('session_reset', '—');
    m.set('weekly_pct', pct);
    m.set('weekly_reset', '—');
    m.set('plan', snap.label);

    m.set('or_label', snap.label);
    m.set('or_balance', formatMoney(balance(snap)));
    m.set('or_total', formatMoney(snap.totalCredits));
    m.set('or_used', formatMoney(snap.totalUsage));
    m.set('or_used_today', formatMoney(snap.usageDaily));
    m.set('or_used_week', formatMoney(snap.usageWeekly));
    m.set('or_used_month', formatMoney(snap.usageMonthly));
    m.set('or_consumed_pct', pct);
    m.set('or_free_tier', snap.isFreeTier ? 'free' : 'paid');
    m.set('or_limit', snap.limit !== null ? formatMoney(snap.limit) : 'unlimited');
    m.set('or_limit_remaining', snap.limitRemaining !== null ? formatMoney(snap.limitRemaining) : 'unlimited');

    return m;
}

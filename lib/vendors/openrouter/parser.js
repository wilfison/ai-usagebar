import {severityFor} from '../../severity.js';

export const ICON = '󱙺';
export const VENDOR_SHORT = 'opr';

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function optNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

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

export function parseCredits(bytesOrText) {
    const d = unwrap(bytesOrText, 'credits');
    return {totalCredits: num(d.total_credits, 0), totalUsage: num(d.total_usage, 0)};
}

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

export function balance(snap) {
    return Math.max(0, snap.totalCredits - snap.totalUsage);
}

export function consumedPct(snap) {
    if (snap.totalCredits <= 0)
        return 0;
    return Math.min(100, Math.max(0, Math.round((snap.totalUsage / snap.totalCredits) * 100)));
}

export function formatMoney(v) {
    return v < 0 ? `-$${(-v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

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

// Credit balance has no reset window.
export function openrouterPeakUsage(snap) {
    return {percent: consumedPct(snap), resetsAt: null};
}

export function openrouterSeverity(snap) {
    return severityFor(consumedPct(snap));
}

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

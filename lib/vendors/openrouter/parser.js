import {Severity, severityFor} from '../../severity.js';
import {formatMoney, sanitizeUntrusted} from '../../format.js';
import {clampPct} from '../fake.js';

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
        label: typeof d.label === 'string' ? sanitizeUntrusted(d.label, 64) : '',
        limit: optNum(d.limit),
        limitRemaining: optNum(d.limit_remaining),
        usageDaily: num(d.usage_daily, 0),
        usageWeekly: num(d.usage_weekly, 0),
        usageMonthly: num(d.usage_monthly, 0),
        isFreeTier: d.is_free_tier === true,
    };
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// `/activity`: one item per day and model. Items of the wrong shape are skipped.
export function parseActivity(bytesOrText) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`openrouter activity unparseable: ${e?.message ?? e}`);
    }
    if (!isObject(obj) || !Array.isArray(obj.data))
        throw new SchemaError('openrouter activity: missing data list');
    return obj.data
        .filter(i => isObject(i) && typeof i.model === 'string' && i.model !== '')
        .map(i => ({
            date: typeof i.date === 'string' ? i.date : null,
            model: i.model,
            usage: num(i.usage, 0),
            requests: Number.isInteger(i.requests) && i.requests > 0 ? i.requests : 0,
        }));
}

const MAX_MODEL_CHARS = 18;
export const RECENT_MODELS = 2;

// "anthropic/claude-sonnet-4.5-preview" → "claude-sonnet-4.5": the vendor
// prefix and a decorative suffix go, then trailing segments until it fits.
export function shortenModelId(id) {
    let name = id.split('/').at(-1);
    for (const suffix of ['-instruct', '-preview', '-chat']) {
        if (name.endsWith(suffix))
            name = name.slice(0, -suffix.length);
    }
    while (name.length > MAX_MODEL_CHARS && name.includes('-'))
        name = name.slice(0, name.lastIndexOf('-'));
    return name;
}

// Newest first (a stable sort, so undated items keep the API's order after
// the dated ones), summed per model, the first two kept.
export function recentModels(items) {
    const sorted = items.map((item, i) => ({item, i})).sort((a, b) => {
        const da = a.item.date, db = b.item.date;
        if (da !== db) {
            if (da === null)
                return 1;
            if (db === null)
                return -1;
            return da < db ? 1 : -1;
        }
        return a.i - b.i;
    });
    const byModel = new Map();
    for (const {item} of sorted) {
        const m = byModel.get(item.model) ?? {model: item.model, costUsd: 0, requests: 0};
        m.costUsd += item.usage;
        m.requests += item.requests;
        byModel.set(item.model, m);
    }
    return [...byModel.values()].slice(0, RECENT_MODELS)
        .map(m => ({name: sanitizeUntrusted(shortenModelId(m.model), 64), costUsd: m.costUsd, requests: m.requests}));
}

function parseCachedModels(list) {
    if (!Array.isArray(list))
        return [];
    return list
        .filter(m => isObject(m) && typeof m.name === 'string')
        .map(m => ({name: m.name, costUsd: num(m.cost_usd, 0), requests: Number.isInteger(m.requests) ? m.requests : 0}));
}

export function combine(credits, key, models = []) {
    const label = key.label ? `OpenRouter - ${key.label}` : 'OpenRouter';
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
        recentModels: models,
    };
}

// Negative when usage overran the credits: that debt is shown, not hidden as $0.00.
export function balance(snap) {
    return snap.totalCredits - snap.totalUsage;
}

export function consumedPct(snap) {
    if (snap.totalCredits <= 0)
        return 0;
    return Math.min(100, Math.max(0, Math.round((snap.totalUsage / snap.totalCredits) * 100)));
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
            recent_models: (snap.recentModels ?? []).map(m => ({name: m.name, cost_usd: m.costUsd, requests: m.requests})),
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
        recentModels: parseCachedModels(s.recent_models),
    };
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT).
// pct is read as the share of a nominal $100 credit pool already consumed.
export function fakeSnapshot(pct) {
    const used = clampPct(pct);
    return {
        label: 'OpenRouter (fake)',
        totalCredits: 100,
        totalUsage: used,
        usageDaily: used / 3,
        usageWeekly: used / 2,
        usageMonthly: used,
        isFreeTier: false,
        limit: null,
        limitRemaining: null,
        recentModels: [{name: 'gpt-5-codex', costUsd: 1.25, requests: 42}, {name: 'claude-sonnet-4.5', costUsd: 0, requests: 7}],
    };
}

// Credit balance has no reset window.
export function openrouterPeakUsage(snap) {
    return {percent: consumedPct(snap), resetsAt: null};
}

export function openrouterSeverity(snap) {
    if (balance(snap) < 0)
        return Severity.CRITICAL;
    return severityFor(consumedPct(snap));
}

export function placeholders(snap, _now) {
    const m = new Map();
    const pct = String(consumedPct(snap));

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', pct);
    m.set('session_reset', '-');
    m.set('weekly_pct', pct);
    m.set('weekly_reset', '-');
    m.set('session_elapsed', '0');
    m.set('weekly_elapsed', '0');
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

export function notifyRows(snap, _ = (s) => s) {
    return [{key: 'balance', label: _('Balance'), percent: consumedPct(snap), resetsAt: null}];
}

export function resetCredits(_snap) {
    return [];
}

import {severityFor} from '../../severity.js';
import {format as formatCountdown} from '../../countdown.js';

export const ICON = '󰚩';
export const VENDOR_SHORT = 'kmi';
export const WEEKLY_MS = 7 * 86400 * 1000;
export const WINDOW_MS = 5 * 3600 * 1000;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

// Integer percentage with round + saturation at 100. JS integers are exact far
// beyond any real quota, so plain Number math suffices.
export function pct(used, limit) {
    if (!(limit > 0))
        return 0;
    return Math.min(100, Math.round((used * 100) / limit));
}

// A count field may be an integer or a numeric string; absent → null, anything
// non-integer / negative / non-numeric is schema drift.
function parseCount(v, name) {
    if (v === undefined || v === null)
        return null;
    if (typeof v === 'number') {
        if (Number.isInteger(v) && v >= 0)
            return v;
    } else if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
        return Number(v.trim());
    }
    throw new SchemaError(`kimi: invalid numeric value for ${name}`);
}

function parseReset(block) {
    const s = block.resetTime ?? block.resetAt ?? block.reset_at ?? block.reset_time;
    if (s === undefined || s === null || s === '')
        return null;
    if (typeof s !== 'string')
        throw new SchemaError('kimi: resetTime must be a string');
    const t = Date.parse(s);
    if (Number.isNaN(t))
        throw new SchemaError(`kimi: unparseable resetTime: ${s}`);
    return new Date(t);
}

function extractBlock(block) {
    if (block === null || typeof block !== 'object' || Array.isArray(block))
        throw new SchemaError('kimi: usage block is not an object');

    const limit = parseCount(block.limit, 'limit');
    if (limit === null)
        throw new SchemaError('kimi: missing limit in usage block');
    let used = parseCount(block.used, 'used');
    let remaining = parseCount(block.remaining, 'remaining');

    if (used !== null && remaining !== null) {
        // both present — keep as-is
    } else if (used !== null) {
        remaining = Math.max(0, limit - used);
    } else if (remaining !== null) {
        used = Math.max(0, limit - remaining);
    } else {
        throw new SchemaError('kimi: usage block is missing both used and remaining');
    }

    return {limit, used, remaining, resetAt: parseReset(block)};
}

// Kimi documents the rolling window as 300 minutes. Accept only the equivalent
// spellings used by protobuf/JSON gateways, not arbitrary duration units.
function isFiveHourWindow(window) {
    if (window === null || typeof window !== 'object')
        return false;
    const unit = window.timeUnit ?? window.time_unit;
    return (window.duration === 300 && ['TIME_UNIT_MINUTE', 'MINUTE', 'MINUTES'].includes(unit))
        || (window.duration === 5 && ['TIME_UNIT_HOUR', 'HOUR', 'HOURS'].includes(unit));
}

export function parseUsage(bytesOrText) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);

    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`kimi usage response unparseable: ${e?.message ?? e}`);
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        throw new SchemaError('kimi usage response: top-level value is not an object');

    const level = obj.user?.membership?.level;
    const plan = typeof level === 'string' && level.length > 0 ? level : null;

    if (obj.usage === undefined || obj.usage === null)
        throw new SchemaError('kimi: missing top-level usage block');
    const weekly = extractBlock(obj.usage);

    // `limits` is absent/null for accounts with no rolling quota → zeroed window.
    // Once present, a recognized 5h window is required: silently treating an
    // unfamiliar advertised window as zero usage would mask schema drift.
    let window = {limit: 0, used: 0, remaining: 0, resetAt: null};
    const limits = Array.isArray(obj.limits) ? obj.limits : [];
    if (limits.length > 0) {
        let detail = null;
        for (const l of limits) {
            if (l && typeof l === 'object' && isFiveHourWindow(l.window)
                && l.detail !== undefined && l.detail !== null) {
                detail = l.detail;
                break;
            }
        }
        if (detail === null)
            throw new SchemaError('kimi: missing recognized 5h usage window');
        window = extractBlock(detail);
    }

    return {plan, weekly, window};
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT).
export function fakeSnapshot(pctVal, now = new Date()) {
    const p = Math.max(0, Math.min(100, Math.round(pctVal)));
    const block = (windowMs) => ({limit: 100, used: p, remaining: 100 - p, resetAt: new Date(now.getTime() + windowMs)});
    return {
        plan: 'Kimi (fake)',
        weekly: block(WEEKLY_MS),
        window: block(WINDOW_MS),
    };
}

// Peak utilization and the resets_at of the window that produced it.
export function kimiPeakUsage(snapshot) {
    const wPct = pct(snapshot.weekly.used, snapshot.weekly.limit);
    const winPct = pct(snapshot.window.used, snapshot.window.limit);
    if (winPct > wPct)
        return {percent: winPct, resetsAt: snapshot.window.resetAt};
    return {percent: wPct, resetsAt: snapshot.weekly.resetAt};
}

export function kimiSeverity(snapshot) {
    return severityFor(kimiPeakUsage(snapshot).percent);
}

export function placeholders(snapshot, now) {
    const m = new Map();
    const wPct = pct(snapshot.weekly.used, snapshot.weekly.limit);
    const winPct = pct(snapshot.window.used, snapshot.window.limit);
    const wReset = formatCountdown(snapshot.weekly.resetAt, now);
    const winReset = formatCountdown(snapshot.window.resetAt, now);
    const plan = snapshot.plan ?? '';

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    // The 5h window is the immediate rate limit, so it maps to the shared
    // session_* keys (as zai maps its 5h window).
    m.set('session_pct', String(winPct));
    m.set('session_reset', winReset);
    m.set('weekly_pct', String(wPct));
    m.set('weekly_reset', wReset);
    m.set('plan', plan);

    m.set('kimi_plan', plan);
    m.set('kimi_weekly_pct', String(wPct));
    m.set('kimi_weekly_reset', wReset);
    m.set('kimi_window_pct', String(winPct));
    m.set('kimi_window_reset', winReset);

    return m;
}

import {severityFor} from '../../severity.js';
import {calc, paceGlyph} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {fakeWindow} from '../fake.js';

export const ICON = '󰚩';
export const VENDOR_SHORT = 'cld';
export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

function roundUtil(v) {
    if (v === undefined || v === null)
        return 0;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`utilization: expected number, got ${typeof v}`);
    return Math.round(v);
}

function truncIntOrFloat(v) {
    if (v === undefined || v === null)
        return 0;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`money value: expected number or null, got ${typeof v}`);
    return Math.trunc(v);
}

function parseRfc3339(s) {
    if (typeof s !== 'string')
        return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
}

function toWindow(w) {
    if (w === undefined || w === null)
        return {utilizationPct: 0, resetsAt: null};
    if (typeof w !== 'object' || Array.isArray(w))
        throw new SchemaError('usage window: expected object');
    return {utilizationPct: roundUtil(w.utilization), resetsAt: parseRfc3339(w.resets_at)};
}

// Model-scoped weekly caps (e.g. Fable) live only inside `limits[]` as
// `weekly_scoped` entries labelled by `scope.model.display_name`; there is no
// dedicated `seven_day_<model>` field. Everything else in the array duplicates
// five_hour/seven_day, so we lift only labelled weekly_scoped entries.
function parseScopedLimits(limits) {
    if (!Array.isArray(limits))
        return [];
    const scoped = [];
    for (const l of limits) {
        if (l === null || typeof l !== 'object' || Array.isArray(l))
            continue;
        if (l.kind !== 'weekly_scoped')
            continue;
        const label = l.scope?.model?.display_name;
        if (typeof label !== 'string' || label.length === 0)
            continue;
        scoped.push({
            label,
            utilizationPct: roundUtil(l.percent),
            resetsAt: parseRfc3339(l.resets_at),
        });
    }
    return scoped;
}

export function parseUsage(bytesOrText, planLabel) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);

    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`usage response unparseable: ${e?.message ?? e}`);
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        throw new SchemaError('usage response: top-level value is not an object');

    const eu = obj.extra_usage;
    let extra = null;
    if (eu !== undefined && eu !== null) {
        if (typeof eu !== 'object' || Array.isArray(eu))
            throw new SchemaError('extra_usage: expected object');
        if (eu.is_enabled === true) {
            extra = {
                limitCents: truncIntOrFloat(eu.monthly_limit),
                spentCents: truncIntOrFloat(eu.used_credits),
            };
        }
    }

    return {
        plan: planLabel,
        session: toWindow(obj.five_hour),
        weekly: toWindow(obj.seven_day),
        sonnet: obj.seven_day_sonnet === undefined || obj.seven_day_sonnet === null
            ? null
            : toWindow(obj.seven_day_sonnet),
        scoped: parseScopedLimits(obj.limits),
        extra,
    };
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT),
// used to verify rendering without a live fetch. Every window shows `pct`.
export function fakeSnapshot(pct, now = new Date()) {
    return {
        plan: 'Max 5x (fake)',
        session: fakeWindow(pct, SESSION_MS, now),
        weekly: fakeWindow(pct, WEEKLY_MS, now),
        sonnet: fakeWindow(pct, WEEKLY_MS, now),
        scoped: [{label: 'Fable', ...fakeWindow(pct, WEEKLY_MS, now)}],
        extra: null,
    };
}

export function extraPercent(extra) {
    if (extra.limitCents <= 0)
        return 0;
    return Math.trunc((extra.spentCents * 100) / extra.limitCents);
}

// Peak utilization and the resets_at of the window that produced it.
export function anthropicPeakUsage(snapshot) {
    let percent = snapshot.session.utilizationPct;
    let resetsAt = snapshot.session.resetsAt;
    if (snapshot.weekly.utilizationPct > percent) {
        percent = snapshot.weekly.utilizationPct;
        resetsAt = snapshot.weekly.resetsAt;
    }
    if (snapshot.sonnet && snapshot.sonnet.utilizationPct > percent) {
        percent = snapshot.sonnet.utilizationPct;
        resetsAt = snapshot.sonnet.resetsAt;
    }

    const anyAtCap = snapshot.session.utilizationPct >= 100
        || snapshot.weekly.utilizationPct >= 100
        || (snapshot.sonnet !== null && snapshot.sonnet.utilizationPct >= 100);
    if (anyAtCap && snapshot.extra) {
        const p = extraPercent(snapshot.extra);
        if (p > percent) {
            percent = p;
            resetsAt = null; // monthly credit limit, no reset window
        }
    }
    return {percent, resetsAt};
}

export function anthropicSeverity(snapshot) {
    return severityFor(anthropicPeakUsage(snapshot).percent);
}

export function fmtDollars(cents) {
    const neg = cents < 0;
    const abs = neg ? -cents : cents;
    return `${neg ? '-' : ''}$${Math.trunc(abs / 100)}.${pad2(abs % 100)}`;
}

function windowPlaceholders(m, prefix, win, pace, now) {
    if (win) {
        m.set(`${prefix}_pct`, String(win.utilizationPct));
        m.set(`${prefix}_reset`, formatCountdown(win.resetsAt, now));
        m.set(`${prefix}_elapsed`, String(pace.elapsedPct));
    } else {
        m.set(`${prefix}_pct`, '0');
        m.set(`${prefix}_reset`, '—');
        m.set(`${prefix}_elapsed`, '0');
    }
    m.set(`${prefix}_pace`, paceGlyph(pace.ratioPace));
    m.set(`${prefix}_pace_indicator`, paceGlyph(pace.pointPace));
    m.set(`${prefix}_pace_pct`, pace.ratioLabel);
    m.set(`${prefix}_pace_pts`, pace.pointLabel);
    m.set(`${prefix}_pace_delta`, String(pace.delta));
    m.set(`${prefix}_pace_abs_delta`, String(Math.abs(pace.delta)));
}

export function placeholders(snapshot, now) {
    const m = new Map();
    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('plan', snapshot.plan);

    const sessionPace = calc({
        usagePct: snapshot.session.utilizationPct,
        reset: snapshot.session.resetsAt,
        now,
        windowMs: SESSION_MS,
    });
    windowPlaceholders(m, 'session', snapshot.session, sessionPace, now);

    const weeklyPace = calc({
        usagePct: snapshot.weekly.utilizationPct,
        reset: snapshot.weekly.resetsAt,
        now,
        windowMs: WEEKLY_MS,
    });
    windowPlaceholders(m, 'weekly', snapshot.weekly, weeklyPace, now);

    const sonnetPace = calc({
        usagePct: snapshot.sonnet?.utilizationPct ?? 0,
        reset: snapshot.sonnet?.resetsAt ?? null,
        now,
        windowMs: WEEKLY_MS,
    });
    windowPlaceholders(m, 'sonnet', snapshot.sonnet, sonnetPace, now);

    m.set('extra_spent', snapshot.extra ? fmtDollars(snapshot.extra.spentCents) : '');
    m.set('extra_limit', snapshot.extra ? fmtDollars(snapshot.extra.limitCents) : '');
    m.set('extra_pct', snapshot.extra ? String(extraPercent(snapshot.extra)) : '0');

    return m;
}

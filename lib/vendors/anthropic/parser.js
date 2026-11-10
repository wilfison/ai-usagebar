import {severityFor} from '../../severity.js';
import {calc, paceGlyph} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {fakeWindow} from '../fake.js';
import {withCurrency, sanitizeUntrusted, checkedResetTitle, resetsAvailableText} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';

export const ICON = '󰚩';
export const VENDOR_SHORT = 'cld';
export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;
// Verified Ultra accounts have no five-hour limit; the endpoint says so with
// `five_hour: null`.
export const ULTRA = 'Ultra';

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function roundUtil(v) {
    if (v === undefined || v === null)
        return 0;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`utilization: expected number, got ${typeof v}`);
    return Math.round(v);
}

// Minor units; absent stays null so an incomplete block never shows a made-up zero.
function optCents(v, field) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`${field}: expected number or null, got ${typeof v}`);
    if (v < 0)
        throw new SchemaError(`${field}: cents cannot be negative`);
    return Math.trunc(v);
}

// Embedded verbatim in the label, so only a plausible ISO 4217 alpha code passes.
function optCurrency(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v))
        throw new SchemaError(`extra_usage.currency ${JSON.stringify(v)} is not an ISO 4217 alpha code`);
    return v;
}

function optDecimalPlaces(v) {
    if (v === undefined || v === null)
        return null;
    if (!Number.isInteger(v) || v < 0 || v > 6)
        throw new SchemaError('extra_usage.decimal_places must be an integer in 0..=6');
    return v;
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
            label: sanitizeUntrusted(label, 64),
            utilizationPct: roundUtil(l.percent),
            resetsAt: parseRfc3339(l.resets_at),
        });
    }
    return scoped;
}

// Banked "launch resets". Only grants redeemable right now count; the grant
// `id` is the handle that spends a reset, so it is never read.
function parseResetGrants(block) {
    if (block === null || typeof block !== 'object' || Array.isArray(block) || block.eligible !== true)
        return [];
    if (!Array.isArray(block.grants))
        return [];
    const resets = [];
    for (const g of block.grants) {
        if (g === null || typeof g !== 'object' || Array.isArray(g))
            continue;
        if (g.usable_now !== true || g.paused === true)
            continue;
        if (!Number.isInteger(g.resets_left) || g.resets_left <= 0)
            continue;
        resets.push({label: checkedResetTitle(g.label), resetsLeft: g.resets_left, endsAt: parseRfc3339(g.ends_at)});
    }
    return resets;
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
        const limitCents = optCents(eu.monthly_limit, 'extra_usage.monthly_limit');
        const spentCents = optCents(eu.used_credits, 'extra_usage.used_credits');
        const currency = optCurrency(eu.currency);
        const decimalPlaces = optDecimalPlaces(eu.decimal_places);
        // `monthly_limit: null` means no spending cap (e.g. Pro), not drift;
        // without the spend there is nothing to show.
        if (eu.is_enabled === true && spentCents !== null)
            extra = {limitCents, spentCents, currency, decimalPlaces};
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
        resets: parseResetGrants(obj.cedar_ember),
    };
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT),
// used to verify rendering without a live fetch. Every window shows `pct`.
export function fakeSnapshot(pct, now = new Date()) {
    return {
        plan: 'Max (fake)',
        session: fakeWindow(pct, SESSION_MS, now),
        weekly: fakeWindow(pct, WEEKLY_MS, now),
        sonnet: fakeWindow(pct, WEEKLY_MS, now),
        scoped: [{label: 'Fable', ...fakeWindow(pct, WEEKLY_MS, now)}],
        extra: null,
        resets: [{label: 'Launch reset (fake)', resetsLeft: 1, endsAt: new Date(now.getTime() + WEEKLY_MS)}],
    };
}

export function extraPercent(extra) {
    if (extra.limitCents === null || extra.limitCents <= 0)
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
    const scoped = snapshot.scoped ?? [];
    for (const sw of scoped) {
        if (sw.utilizationPct > percent) {
            percent = sw.utilizationPct;
            resetsAt = sw.resetsAt;
        }
    }

    const anyAtCap = snapshot.session.utilizationPct >= 100
        || snapshot.weekly.utilizationPct >= 100
        || (snapshot.sonnet !== null && snapshot.sonnet.utilizationPct >= 100)
        || scoped.some((s) => s.utilizationPct >= 100);
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

// Integer minor units at the currency's own scale; `currency` null is legacy USD.
export function formatMinor(minor, decimalPlaces, currency = null) {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    const scale = 10 ** decimalPlaces;
    const number = decimalPlaces === 0
        ? String(abs)
        : `${Math.trunc(abs / scale)}.${String(abs % scale).padStart(decimalPlaces, '0')}`;
    return withCurrency(sign, number, currency);
}

// A currency code alone does not fix its minor-unit exponent, so the amount
// is shown as raw minor units rather than divided by a guessed scale.
export function formatExtraAmount(extra, minor) {
    const currency = extra.currency ?? null;
    const decimalPlaces = extra.decimalPlaces ?? null;
    if (decimalPlaces !== null)
        return formatMinor(minor, decimalPlaces, currency);
    if (currency !== null)
        return `${minor < 0 ? '-' : ''}${Math.abs(minor)} minor units ${currency}`;
    return formatMinor(minor, 2);
}

function windowPlaceholders(m, prefix, win, pace, now) {
    if (win) {
        m.set(`${prefix}_pct`, String(win.utilizationPct));
        m.set(`${prefix}_reset`, formatCountdown(win.resetsAt, now));
        m.set(`${prefix}_elapsed`, String(pace.elapsedPct));
    } else {
        m.set(`${prefix}_pct`, '0');
        m.set(`${prefix}_reset`, '-');
        m.set(`${prefix}_elapsed`, '0');
    }
    m.set(`${prefix}_pace`, paceGlyph(pace.ratioPace, pace.state));
    m.set(`${prefix}_pace_indicator`, paceGlyph(pace.pointPace, pace.state));
    m.set(`${prefix}_pace_pct`, pace.ratioLabel);
    m.set(`${prefix}_pace_pts`, pace.pointLabel);
    m.set(`${prefix}_pace_delta`, String(pace.delta));
    m.set(`${prefix}_pace_abs_delta`, String(Math.abs(pace.delta)));
}

export function resetsAvailable(snapshot) {
    return (snapshot.resets ?? []).reduce((n, r) => n + r.resetsLeft, 0);
}

export function placeholders(snapshot, now, ngettext) {
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

    const extra = snapshot.extra;
    m.set('extra_spent', extra ? formatExtraAmount(extra, extra.spentCents) : '');
    let extraLimit = '';
    if (extra)
        extraLimit = extra.limitCents === null ? '-' : formatExtraAmount(extra, extra.limitCents);
    m.set('extra_limit', extraLimit);
    m.set('extra_pct', snapshot.extra ? String(extraPercent(snapshot.extra)) : '0');

    const resets = resetsAvailable(snapshot);
    m.set('resets_available', String(resets));
    m.set('resets', resetsAvailableText(resets, ngettext));

    return m;
}

// One notification row per usage window; labels match the popup titles.
export function notifyRows(snapshot, _ = (s) => s) {
    const rows = [
        {key: 'session', label: _('Session'), percent: snapshot.session.utilizationPct, resetsAt: snapshot.session.resetsAt},
        {key: 'weekly', label: _('Weekly'), percent: snapshot.weekly.utilizationPct, resetsAt: snapshot.weekly.resetsAt},
    ];
    if (snapshot.sonnet)
        rows.push({key: 'sonnet', label: _('Sonnet only'), percent: snapshot.sonnet.utilizationPct, resetsAt: snapshot.sonnet.resetsAt});
    for (const sw of snapshot.scoped ?? [])
        rows.push({key: `scoped:${sw.label}`, label: sw.label, percent: sw.utilizationPct, resetsAt: sw.resetsAt});
    return rows;
}

export function resetCredits(snapshot) {
    return (snapshot.resets ?? []).map(r => ({title: r.label, expiresAt: r.endsAt}));
}

export const CACHE_VERSION = 2;

export function snapshotToCacheJson(snapshot) {
    return encodeSnapshot(snapshot, CACHE_VERSION);
}

export function parseCacheJson(bytesOrText) {
    return decodeSnapshot(bytesOrText, CACHE_VERSION, SchemaError);
}

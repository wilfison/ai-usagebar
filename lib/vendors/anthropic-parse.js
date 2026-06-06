/**
 * @file Pure Anthropic usage parsing, severity, and placeholder map. Turns the
 * raw `/api/oauth/usage` JSON into a normalized {@link AnthropicSnapshot}, picks
 * the worst-of severity tier, and builds the `{key} → value` map the panel
 * label renders through {@link module:lib/format.substitute}.
 *
 * No `gi://` imports — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';

/** @type {string} Panel icon glyph (Nerd Font Claude mark). */
export const ICON = '󰚩';
/** @type {string} Short vendor tag shown in the bar. */
export const VENDOR_SHORT = 'cld';
/** @type {number} Session ("five_hour") window length in ms. */
export const SESSION_MS = 5 * 3600 * 1000;
/** @type {number} Weekly / sonnet ("seven_day") window length in ms. */
export const WEEKLY_MS = 7 * 86400 * 1000;

/**
 * Thrown by {@link parseUsage} when the top-level body is not valid JSON or not
 * an object — lets `fetchSnapshot` classify schema drift (code `0`) distinctly
 * from a valid-but-empty `{}` body, which parses to a neutral snapshot.
 */
export class SchemaError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

/**
 * @typedef {object} UsageWindow
 * @property {number} utilizationPct - integer percent consumed (0-100).
 * @property {?Date} resetsAt - end-of-window instant, or null when unknown.
 */

/**
 * @typedef {object} ExtraUsage
 * @property {number} limitCents - monthly pay-as-you-go cap, integer cents.
 * @property {number} spentCents - credits used this month, integer cents.
 */

/**
 * @typedef {object} AnthropicSnapshot
 * @property {string} plan - rendered plan label (injected; not in the payload).
 * @property {UsageWindow} session - 5h rolling window.
 * @property {UsageWindow} weekly - 7d rolling window.
 * @property {?UsageWindow} sonnet - 7d Sonnet window, or null when absent.
 * @property {?ExtraUsage} extra - pay-as-you-go block, or null when disabled.
 */

/**
 * Zero-pad a small non-negative integer to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Coerce a window's `utilization` (int or float, default 0) to a nearest-integer
 * percent.
 * @param {*} v
 * @returns {number}
 * @throws {SchemaError} when present but non-numeric.
 */
function roundUtil(v) {
    if (v === undefined || v === null)
        return 0;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`utilization: expected number, got ${typeof v}`);
    return Math.round(v);
}

/**
 * Coerce an int-or-float money value to truncated integer cents (null → 0,
 * float truncates toward zero).
 * @param {*} v
 * @returns {number}
 * @throws {SchemaError} when present but non-numeric.
 */
function truncIntOrFloat(v) {
    if (v === undefined || v === null)
        return 0;
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SchemaError(`money value: expected number or null, got ${typeof v}`);
    return Math.trunc(v);
}

/**
 * Parse an RFC-3339 timestamp string into a Date, tolerating garbage.
 * @param {*} s
 * @returns {?Date} null when missing or unparseable (never throws).
 */
function parseRfc3339(s) {
    if (typeof s !== 'string')
        return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Lift a raw window object into a {@link UsageWindow}. Missing window → neutral.
 * @param {*} w - raw window value (object, or null/undefined).
 * @returns {UsageWindow}
 * @throws {SchemaError} when `w` is present but not an object.
 */
function toWindow(w) {
    if (w === undefined || w === null)
        return {utilizationPct: 0, resetsAt: null};
    if (typeof w !== 'object' || Array.isArray(w))
        throw new SchemaError('usage window: expected object');
    return {utilizationPct: roundUtil(w.utilization), resetsAt: parseRfc3339(w.resets_at)};
}

/**
 * Parse the raw usage payload into a normalized snapshot.
 * @param {Uint8Array | string} bytesOrText - raw response body.
 * @param {string} planLabel - plan label from the credentials (set verbatim).
 * @returns {AnthropicSnapshot}
 * @throws {SchemaError} when the body is not valid JSON or not an object, or a
 *   present sub-field has the wrong type. A valid-but-empty `{}` does not throw.
 */
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
        extra,
    };
}

/**
 * Integer percent of the extra-usage cap consumed, saturating to 0 when the
 * limit is non-positive.
 * @param {ExtraUsage} extra
 * @returns {number}
 */
function extraPercent(extra) {
    if (extra.limitCents <= 0)
        return 0;
    return Math.trunc((extra.spentCents * 100) / extra.limitCents);
}

/**
 * Worst-of severity across the rolling windows, promoting extra-usage percent
 * only when some window has hit 100%.
 * @param {AnthropicSnapshot} snapshot
 * @returns {string} a {@link module:lib/severity.Severity} tier.
 */
export function anthropicSeverity(snapshot) {
    let max = snapshot.session.utilizationPct;
    if (snapshot.weekly.utilizationPct > max)
        max = snapshot.weekly.utilizationPct;
    if (snapshot.sonnet && snapshot.sonnet.utilizationPct > max)
        max = snapshot.sonnet.utilizationPct;

    const anyAtCap = snapshot.session.utilizationPct >= 100
        || snapshot.weekly.utilizationPct >= 100
        || (snapshot.sonnet !== null && snapshot.sonnet.utilizationPct >= 100);
    if (anyAtCap && snapshot.extra) {
        const p = extraPercent(snapshot.extra);
        if (p > max)
            max = p;
    }
    return severityFor(max);
}

/**
 * Format integer cents as `$D.CC`, rendering negatives as `-$D.CC` (the sign
 * precedes the `$`).
 * @param {number} cents
 * @returns {string}
 */
export function fmtDollars(cents) {
    const neg = cents < 0;
    const abs = neg ? -cents : cents;
    return `${neg ? '-' : ''}$${Math.trunc(abs / 100)}.${pad2(abs % 100)}`;
}

/**
 * Add the per-window text + pace placeholders for one window. Pace values are
 * plain text (no Pango color spans — St colors the whole label, not inline
 * runs). When `win` is null (sonnet absent) the `*_pct/_reset/_elapsed` keys use
 * the documented defaults and `pace` is the neutral result.
 * @param {Map<string, string>} m
 * @param {string} prefix - 'session' | 'weekly' | 'sonnet'.
 * @param {?UsageWindow} win
 * @param {import('../pacing.js').PaceResult} pace
 * @param {Date} now
 * @returns {void}
 */
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

/**
 * Build the Anthropic placeholder map for format-string substitution.
 *
 * Includes the text family (`icon`, `vendor_short`, `plan`), per-window
 * `*_pct`/`*_reset`/`*_elapsed`, the full pace family (`*_pace`,
 * `*_pace_indicator`, `*_pace_pct`, `*_pace_pts`, `*_pace_delta`,
 * `*_pace_abs_delta`), and `extra_spent`/`extra_limit`/`extra_pct`.
 *
 * The Pango `*_bar` keys are intentionally **omitted** — they become St
 * progress-bar widgets in Step 4, not substituted text.
 * @param {AnthropicSnapshot} snapshot
 * @param {Date} now - current instant (for countdown/pace math).
 * @returns {Map<string, string>}
 */
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

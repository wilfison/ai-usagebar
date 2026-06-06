/**
 * @file Pure OpenAI/Codex usage parsing, severity, and placeholder map. Turns the
 * raw `/backend-api/wham/usage` JSON into a normalized {@link OpenAiSnapshot},
 * picks the worst-of severity tier, and builds the placeholder map the panel
 * label renders through {@link module:lib/format.substitute}.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';

/** @type {string} Panel icon glyph. */
export const ICON = '󱢆';
/** @type {string} Short vendor tag shown in the bar. */
export const VENDOR_SHORT = 'gpt';
/** @type {number} Default session ("primary") window length in ms (5h). */
export const SESSION_MS = 5 * 3600 * 1000;
/** @type {number} Default weekly ("secondary") / code-review window length in ms (7d). */
export const WEEKLY_MS = 7 * 86400 * 1000;

/**
 * Thrown by {@link parseUsage} when the top-level body is not valid JSON or not
 * an object. A valid-but-empty `{}` parses to a neutral snapshot.
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
 * @property {number} windowMs - full window length in ms (payload-driven).
 */

/**
 * @typedef {object} OpenAiCredits
 * @property {string} balance - formatted balance string (`$x.xx`).
 * @property {boolean} hasCredits
 * @property {boolean} unlimited
 * @property {?[number, number]} approxLocalMessages - [lo, hi] range, or null.
 * @property {?[number, number]} approxCloudMessages - [lo, hi] range, or null.
 */

/**
 * @typedef {object} OpenAiSnapshot
 * @property {string} plan - rendered plan label, e.g. `ChatGPT Plus`.
 * @property {UsageWindow} session - primary window (5h default).
 * @property {UsageWindow} weekly - secondary window (7d default).
 * @property {?UsageWindow} codeReview - code-review weekly window, or null.
 * @property {?OpenAiCredits} credits - pay-as-you-go credits block, or null.
 */

/**
 * Coerce a lenient int-or-float to a truncated integer (null/non-number → 0).
 * @param {*} v
 * @returns {number}
 */
function intLenient(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return 0;
    return Math.trunc(v);
}

/**
 * Coerce an optional int-or-float to a truncated integer, or null when absent.
 * @param {*} v
 * @returns {?number}
 */
function optInt(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

/**
 * Capitalize the first character of `s` (ASCII).
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Format a money value: a string passes through; a number renders as `$x.xx`;
 * anything else becomes `$0.00`.
 * @param {*} v
 * @returns {string}
 */
function moneyString(v) {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' && Number.isFinite(v))
        return `$${v.toFixed(2)}`;
    return '$0.00';
}

/**
 * Turn an array into a `[lo, hi]` range: ≥2 elements → `[v0, v1]`; exactly 1 →
 * `[v, v]`; otherwise null.
 * @param {*} v
 * @returns {?[number, number]}
 */
function rangeFromArray(v) {
    if (!Array.isArray(v) || v.length === 0)
        return null;
    if (v.length === 1)
        return [v[0], v[0]];
    return [v[0], v[1]];
}

/**
 * Lift a raw rate-limit window into a {@link UsageWindow}.
 * @param {*} w - raw window object, or null/undefined.
 * @param {number} defaultMs - fallback window length when `limit_window_seconds`
 *   is absent or non-positive.
 * @param {Date} now - clock for the `reset_after_seconds` fallback.
 * @returns {UsageWindow}
 */
function toWindow(w, defaultMs, now) {
    if (w === null || typeof w !== 'object' || Array.isArray(w))
        return {utilizationPct: 0, resetsAt: null, windowMs: defaultMs};

    const lws = intLenient(w.limit_window_seconds);
    const windowMs = lws > 0 ? lws * 1000 : defaultMs;

    const resetAt = optInt(w.reset_at);
    let resetsAt = null;
    if (resetAt !== null) {
        resetsAt = new Date(resetAt * 1000);
    } else {
        const after = optInt(w.reset_after_seconds);
        if (after !== null)
            resetsAt = new Date(now.getTime() + after * 1000);
    }

    const pct = Math.min(100, Math.max(0, intLenient(w.used_percent)));
    return {utilizationPct: pct, resetsAt, windowMs};
}

/**
 * Parse the raw usage payload into a normalized snapshot.
 * @param {Uint8Array | string} bytesOrText - raw response body.
 * @param {?string} [planHint] - plan tier from the id_token, used when the body
 *   omits `plan_type`.
 * @returns {OpenAiSnapshot}
 * @throws {SchemaError} when the body is not valid JSON or not an object.
 */
export function parseUsage(bytesOrText, planHint) {
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

    const now = new Date();
    const planType = (typeof obj.plan_type === 'string' && obj.plan_type) || planHint || 'Unknown';
    const plan = `ChatGPT ${capitalize(planType)}`;

    const rl = obj.rate_limit && typeof obj.rate_limit === 'object' ? obj.rate_limit : {};
    const session = toWindow(rl.primary_window, SESSION_MS, now);
    const weekly = toWindow(rl.secondary_window, WEEKLY_MS, now);

    let codeReview = null;
    const crl = obj.code_review_rate_limit;
    if (crl && typeof crl === 'object' && crl.primary_window)
        codeReview = toWindow(crl.primary_window, WEEKLY_MS, now);

    let credits = null;
    const c = obj.credits;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
        credits = {
            balance: 'balance' in c ? moneyString(c.balance) : '',
            hasCredits: c.has_credits === true,
            unlimited: c.unlimited === true,
            approxLocalMessages: rangeFromArray(c.approx_local_messages),
            approxCloudMessages: rangeFromArray(c.approx_cloud_messages),
        };
    }

    return {plan, session, weekly, codeReview, credits};
}

/**
 * Worst-of severity across the session, weekly, and code-review windows.
 * @param {OpenAiSnapshot} snapshot
 * @returns {string} a {@link module:lib/severity.Severity} tier.
 */
export function openaiSeverity(snapshot) {
    let max = Math.max(snapshot.session.utilizationPct, snapshot.weekly.utilizationPct);
    if (snapshot.codeReview && snapshot.codeReview.utilizationPct > max)
        max = snapshot.codeReview.utilizationPct;
    return severityFor(max);
}

/**
 * Build the OpenAI placeholder map: the cross-vendor aliases plus the `oai_*`
 * family.
 * @param {OpenAiSnapshot} snapshot
 * @param {Date} now - current instant (countdown/pace math).
 * @returns {Map<string, string>}
 */
export function placeholders(snapshot, now) {
    const m = new Map();
    const {session, weekly, codeReview, credits} = snapshot;

    const sessionPace = calc({usagePct: session.utilizationPct, reset: session.resetsAt, now, windowMs: session.windowMs});
    const weeklyPace = calc({usagePct: weekly.utilizationPct, reset: weekly.resetsAt, now, windowMs: weekly.windowMs});

    const sessionReset = formatCountdown(session.resetsAt, now);
    const weeklyReset = formatCountdown(weekly.resetsAt, now);

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', String(session.utilizationPct));
    m.set('session_reset', sessionReset);
    m.set('weekly_pct', String(weekly.utilizationPct));
    m.set('weekly_reset', weeklyReset);
    m.set('plan', snapshot.plan);

    m.set('oai_plan', snapshot.plan);
    m.set('oai_session_pct', String(session.utilizationPct));
    m.set('oai_session_reset', sessionReset);
    m.set('oai_session_elapsed', String(sessionPace.elapsedPct));
    m.set('oai_session_pace', paceGlyph(sessionPace.ratioPace));
    m.set('oai_session_pace_indicator', paceGlyph(sessionPace.pointPace));
    m.set('oai_weekly_pct', String(weekly.utilizationPct));
    m.set('oai_weekly_reset', weeklyReset);
    m.set('oai_weekly_elapsed', String(weeklyPace.elapsedPct));
    m.set('oai_weekly_pace', paceGlyph(weeklyPace.ratioPace));
    m.set('oai_weekly_pace_indicator', paceGlyph(weeklyPace.pointPace));
    m.set('oai_code_review_pct', String(codeReview ? codeReview.utilizationPct : 0));
    m.set('oai_credit_balance', credits ? credits.balance : 'n/a');
    m.set('oai_local_msgs', credits && credits.approxLocalMessages
        ? `${credits.approxLocalMessages[0]}-${credits.approxLocalMessages[1]}` : '');
    m.set('oai_cloud_msgs', credits && credits.approxCloudMessages
        ? `${credits.approxCloudMessages[0]}-${credits.approxCloudMessages[1]}` : '');

    return m;
}

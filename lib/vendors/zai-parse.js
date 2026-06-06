/**
 * @file Pure Z.AI usage parsing, severity, and placeholder map. Projects the
 * monitor envelope (`/api/monitor/usage/quota/limit`) into a normalized
 * {@link ZaiSnapshot} by classifying `data.limits` by position + type: the first
 * `TOKENS_LIMIT` is the session bucket, the second is weekly, and the
 * `TIME_LIMIT` entry is the monthly MCP-tool ceiling.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor} from '../severity.js';
import {format as formatCountdown} from '../countdown.js';

/** @type {string} Panel icon glyph. */
export const ICON = '󰚩';
/** @type {string} Short vendor tag shown in the bar. */
export const VENDOR_SHORT = 'zai';
/** @type {number} Session window length in ms (5h, fixed per-position constant). */
export const SESSION_MS = 5 * 3600 * 1000;
/** @type {number} Weekly window length in ms (7d). */
export const WEEKLY_MS = 7 * 86400 * 1000;
/** @type {number} MCP-tools window length in ms (30d). */
export const MCP_MS = 30 * 86400 * 1000;

/**
 * Thrown by {@link parseEnvelope} when the top-level body is not valid JSON or
 * not an object. A valid object with no `data` projects to all-null windows.
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
 * @property {number} windowMs - fixed window length in ms.
 */

/**
 * @typedef {object} ZaiSnapshot
 * @property {string} plan - rendered plan label, e.g. `GLM Coding Pro`.
 * @property {?UsageWindow} session - first TOKENS_LIMIT bucket (5h), or null.
 * @property {?UsageWindow} weekly - second TOKENS_LIMIT bucket (7d), or null.
 * @property {?UsageWindow} mcp - TIME_LIMIT bucket (30d), or null.
 */

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
 * Lift a raw limit entry into a {@link UsageWindow}: percentage rounded + clamped
 * 0-100; `nextResetTime` (unix ms; null/missing/0 → null) → resetsAt.
 * @param {*} l - raw limit entry.
 * @param {number} windowMs
 * @returns {UsageWindow}
 */
function toWindow(l, windowMs) {
    const pctRaw = typeof l.percentage === 'number' && Number.isFinite(l.percentage) ? l.percentage : 0;
    const utilizationPct = Math.min(100, Math.max(0, Math.round(pctRaw)));
    const ms = l.nextResetTime;
    const resetsAt = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
    return {utilizationPct, resetsAt, windowMs};
}

/**
 * Parse the monitor envelope into a normalized snapshot.
 * @param {Uint8Array | string} bytesOrText - raw response body.
 * @param {?string} [configPlanTier] - fallback plan tier when the response
 *   `level` is empty.
 * @returns {ZaiSnapshot}
 * @throws {SchemaError} when the body is not valid JSON or not an object.
 */
export function parseEnvelope(bytesOrText, configPlanTier) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);

    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`zai quota response unparseable: ${e?.message ?? e}`);
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        throw new SchemaError('zai quota response: top-level value is not an object');

    const data = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? obj.data : null;
    const limits = data && Array.isArray(data.limits) ? data.limits : [];

    const tokens = limits.filter(l => l && l.type === 'TOKENS_LIMIT');
    const session = tokens.length > 0 ? toWindow(tokens[0], SESSION_MS) : null;
    const weekly = tokens.length > 1 ? toWindow(tokens[1], WEEKLY_MS) : null;
    const timeLimit = limits.find(l => l && l.type === 'TIME_LIMIT');
    const mcp = timeLimit ? toWindow(timeLimit, MCP_MS) : null;

    const levelRaw = data && typeof data.level === 'string' ? data.level : '';
    const level = levelRaw || configPlanTier || 'unknown';
    const plan = `GLM Coding ${capitalize(level)}`;

    return {plan, session, weekly, mcp};
}

/**
 * Worst-of severity across the present windows (absent windows count as 0).
 * @param {ZaiSnapshot} snapshot
 * @returns {string} a {@link module:lib/severity.Severity} tier.
 */
export function zaiSeverity(snapshot) {
    const s = snapshot.session ? snapshot.session.utilizationPct : 0;
    const w = snapshot.weekly ? snapshot.weekly.utilizationPct : 0;
    const m = snapshot.mcp ? snapshot.mcp.utilizationPct : 0;
    return severityFor(Math.max(s, w, m));
}

/**
 * Build the Z.AI placeholder map: cross-vendor aliases plus the `zai_*` family.
 * @param {ZaiSnapshot} snapshot
 * @param {Date} now
 * @returns {Map<string, string>}
 */
export function placeholders(snapshot, now) {
    const m = new Map();
    const sPct = snapshot.session ? snapshot.session.utilizationPct : 0;
    const wPct = snapshot.weekly ? snapshot.weekly.utilizationPct : 0;
    const mPct = snapshot.mcp ? snapshot.mcp.utilizationPct : 0;
    const sReset = formatCountdown(snapshot.session ? snapshot.session.resetsAt : null, now);
    const wReset = formatCountdown(snapshot.weekly ? snapshot.weekly.resetsAt : null, now);
    const mReset = formatCountdown(snapshot.mcp ? snapshot.mcp.resetsAt : null, now);

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', String(sPct));
    m.set('session_reset', sReset);
    m.set('weekly_pct', String(wPct));
    m.set('weekly_reset', wReset);
    m.set('plan', snapshot.plan);

    m.set('zai_plan', snapshot.plan);
    m.set('zai_session_pct', String(sPct));
    m.set('zai_session_reset', sReset);
    m.set('zai_weekly_pct', String(wPct));
    m.set('zai_weekly_reset', wReset);
    m.set('zai_mcp_pct', String(mPct));
    m.set('zai_mcp_reset', mReset);

    return m;
}

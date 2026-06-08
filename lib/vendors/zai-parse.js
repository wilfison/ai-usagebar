import {severityFor} from '../severity.js';
import {format as formatCountdown} from '../countdown.js';

export const ICON = '󰚩';
export const VENDOR_SHORT = 'zai';
export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;
export const MCP_MS = 30 * 86400 * 1000;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function capitalize(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function toWindow(l, windowMs) {
    const pctRaw = typeof l.percentage === 'number' && Number.isFinite(l.percentage) ? l.percentage : 0;
    const utilizationPct = Math.min(100, Math.max(0, Math.round(pctRaw)));
    const ms = l.nextResetTime;
    const resetsAt = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
    return {utilizationPct, resetsAt, windowMs};
}

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

// Peak utilization and the resets_at of the window that produced it.
export function zaiPeakUsage(snapshot) {
    let percent = 0;
    let resetsAt = null;
    for (const w of [snapshot.session, snapshot.weekly, snapshot.mcp]) {
        if (w && w.utilizationPct > percent) {
            percent = w.utilizationPct;
            resetsAt = w.resetsAt;
        }
    }
    return {percent, resetsAt};
}

export function zaiSeverity(snapshot) {
    return severityFor(zaiPeakUsage(snapshot).percent);
}

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

import {severityFor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';

export const ICON = '󱢆';
export const VENDOR_SHORT = 'gpt';
export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function intLenient(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return 0;
    return Math.trunc(v);
}

function optInt(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

function capitalize(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function moneyString(v) {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' && Number.isFinite(v))
        return `$${v.toFixed(2)}`;
    return '$0.00';
}

function rangeFromArray(v) {
    if (!Array.isArray(v) || v.length === 0)
        return null;
    if (v.length === 1)
        return [v[0], v[0]];
    return [v[0], v[1]];
}

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

// Peak utilization and the resets_at of the window that produced it.
export function openaiPeakUsage(snapshot) {
    let percent = snapshot.session.utilizationPct;
    let resetsAt = snapshot.session.resetsAt;
    if (snapshot.weekly.utilizationPct > percent) {
        percent = snapshot.weekly.utilizationPct;
        resetsAt = snapshot.weekly.resetsAt;
    }
    if (snapshot.codeReview && snapshot.codeReview.utilizationPct > percent) {
        percent = snapshot.codeReview.utilizationPct;
        resetsAt = snapshot.codeReview.resetsAt;
    }
    return {percent, resetsAt};
}

export function openaiSeverity(snapshot) {
    return severityFor(openaiPeakUsage(snapshot).percent);
}

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

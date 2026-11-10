import {severityFor} from '../../severity.js';
import {calc, paceGlyph} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {fakeWindow} from '../fake.js';
import {sanitizeUntrusted, checkedResetTitle, resetsAvailableText} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';

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
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n))
        return 0;
    return Math.trunc(n);
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

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

function countString(n) {
    const s = n.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
    return s === '-0' ? '0' : s;
}

// A count of Codex credits, not dollars: at most two decimals, no symbol.
export function creditCount(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return countString(v);
    if (typeof v !== 'string')
        return '';
    const trimmed = v.trim();
    const n = Number(trimmed);
    return NUMERIC_STRING.test(trimmed) && Number.isFinite(n) ? countString(n) : sanitizeUntrusted(v, 64);
}

function rangeFromArray(v) {
    if (!Array.isArray(v) || v.length === 0)
        return null;
    if (v.length === 1)
        return [v[0], v[0]];
    return [v[0], v[1]];
}

// OpenAI sends `null` for an empty collection; any other non-collection is a shape change.
function checkCollection(v, field, isMap) {
    if (v === undefined || v === null)
        return;
    const ok = isMap ? typeof v === 'object' && !Array.isArray(v) : Array.isArray(v);
    if (!ok)
        throw new SchemaError(`usage response: ${field} is not ${isMap ? 'an object' : 'a list'}`);
}

function usedPercent(v) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 101)
        throw new SchemaError(`usage response: used_percent ${JSON.stringify(v)} outside 0..=100`);
    return Math.min(100, Math.round(n));
}

function toWindow(w, defaultMs, now) {
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

    return {utilizationPct: usedPercent(w.used_percent), resetsAt, windowMs};
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Wire position is not semantic: OpenAI has sent the 7d window alone in
// `primary_window` (openai/codex#32707), so the duration decides first.
function windowKind(w, fallback) {
    const lws = intLenient(w.limit_window_seconds);
    if (lws === SESSION_MS / 1000)
        return 'session';
    if (lws === WEEKLY_MS / 1000)
        return 'weekly';
    return fallback;
}

function classifyRateLimit(rl, now) {
    const out = {session: null, weekly: null};
    for (const [w, fallback] of [[rl.primary_window, 'session'], [rl.secondary_window, 'weekly']]) {
        if (!isObject(w))
            continue;
        const kind = windowKind(w, fallback);
        if (out[kind] !== null) {
            throw new SchemaError(`duplicate OpenAI ${kind === 'session' ? '5h' : '7d'} window with ` +
                `limit_window_seconds=${w.limit_window_seconds}; expected at most one 5h and one 7d window`);
        }
        out[kind] = toWindow(w, kind === 'session' ? SESSION_MS : WEEKLY_MS, now);
    }
    return out;
}

function parseRfc3339(s) {
    if (typeof s !== 'string')
        return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
}

function parseObject(bytesOrText, what) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);

    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`${what} unparseable: ${e?.message ?? e}`);
    }
    if (!isObject(obj))
        throw new SchemaError(`${what}: top-level value is not an object`);
    return obj;
}

// Only an available credit is one still held; the redemption `id` is never read.
function availableCredits(list) {
    checkCollection(list, 'rate_limit_reset_credits.credits', false);
    return (list ?? [])
        .filter(c => isObject(c) && c.status === 'available')
        .map(c => ({title: checkedResetTitle(c.title), expiresAt: parseRfc3339(c.expires_at)}));
}

// `credits` only ever arrives from the separate reset-credits call, so it is
// routinely empty while the count is not. An absent block is null: a stated
// zero ("none available") is a different answer from no answer.
function parseResetBlock(block) {
    if (!isObject(block))
        return null;
    return {available: Math.max(0, intLenient(block.available_count)), credits: availableCredits(block.credits)};
}

export function parseResetCredits(bytesOrText) {
    return availableCredits(parseObject(bytesOrText, 'reset credits response').credits);
}

// The count always stays the usage endpoint's: it is the response the rest
// of the snapshot is consistent with.
export function mergeResetCredits(snapshot, credits) {
    return {...snapshot, resetCredits: {available: snapshot.resetCredits.available, credits}};
}

export function parseUsage(bytesOrText, planHint) {
    const obj = parseObject(bytesOrText, 'usage response');

    const now = new Date();
    const planType = (typeof obj.plan_type === 'string' && obj.plan_type) || planHint || 'Unknown';
    const plan = `ChatGPT ${capitalize(sanitizeUntrusted(planType, 64))}`;

    const {session, weekly} = classifyRateLimit(isObject(obj.rate_limit) ? obj.rate_limit : {}, now);

    let codeReview = null;
    const crl = obj.code_review_rate_limit;
    if (isObject(crl) && isObject(crl.primary_window))
        codeReview = toWindow(crl.primary_window, WEEKLY_MS, now);

    checkCollection(obj.additional_rate_limits, 'additional_rate_limits', false);
    checkCollection(obj.model_usage, 'model_usage', true);
    const resetCredits = parseResetBlock(obj.rate_limit_reset_credits);

    let credits = null;
    const c = obj.credits;
    if (isObject(c)) {
        credits = {
            balance: creditCount(c.balance),
            hasCredits: c.has_credits === true,
            unlimited: c.unlimited === true,
            approxLocalMessages: rangeFromArray(c.approx_local_messages),
            approxCloudMessages: rangeFromArray(c.approx_cloud_messages),
        };
    }

    return {plan, session, weekly, codeReview, credits, resetCredits};
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT).
export function fakeSnapshot(pct, now = new Date()) {
    return {
        plan: 'ChatGPT Plus (fake)',
        session: fakeWindow(pct, SESSION_MS, now),
        weekly: fakeWindow(pct, WEEKLY_MS, now),
        codeReview: fakeWindow(pct, WEEKLY_MS, now),
        credits: null,
        resetCredits: {
            available: 2,
            credits: [
                {title: 'Full reset (fake)', expiresAt: new Date(now.getTime() + WEEKLY_MS)},
                {title: null, expiresAt: null},
            ],
        },
    };
}

// Peak utilization over the windows present, and the resets_at of the one that produced it.
export function openaiPeakUsage(snapshot) {
    let peak = null;
    for (const w of [snapshot.session, snapshot.weekly, snapshot.codeReview]) {
        if (w && (peak === null || w.utilizationPct > peak.utilizationPct))
            peak = w;
    }
    return {percent: peak ? peak.utilizationPct : 0, resetsAt: peak ? peak.resetsAt : null};
}

export function openaiSeverity(snapshot) {
    return severityFor(openaiPeakUsage(snapshot).percent);
}

function windowPlaceholders(w, now) {
    if (!w)
        return {pct: '', reset: '', elapsed: '', ratioPace: '', pointPace: ''};
    const pace = calc({usagePct: w.utilizationPct, reset: w.resetsAt, now, windowMs: w.windowMs});
    return {
        pct: String(w.utilizationPct),
        reset: formatCountdown(w.resetsAt, now),
        elapsed: String(pace.elapsedPct),
        ratioPace: paceGlyph(pace.ratioPace, pace.state),
        pointPace: paceGlyph(pace.pointPace, pace.state),
    };
}

export function placeholders(snapshot, now, ngettext) {
    const m = new Map();
    const {codeReview, credits} = snapshot;
    const session = windowPlaceholders(snapshot.session, now);
    const weekly = windowPlaceholders(snapshot.weekly, now);

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('session_pct', session.pct);
    m.set('session_reset', session.reset);
    m.set('session_elapsed', session.elapsed);
    m.set('session_pace', session.ratioPace);
    m.set('weekly_pct', weekly.pct);
    m.set('weekly_reset', weekly.reset);
    m.set('weekly_elapsed', weekly.elapsed);
    m.set('weekly_pace', weekly.ratioPace);
    m.set('plan', snapshot.plan);

    m.set('oai_plan', snapshot.plan);
    m.set('oai_session_pct', session.pct);
    m.set('oai_session_reset', session.reset);
    m.set('oai_session_elapsed', session.elapsed);
    m.set('oai_session_pace', session.ratioPace);
    m.set('oai_session_pace_indicator', session.pointPace);
    m.set('oai_weekly_pct', weekly.pct);
    m.set('oai_weekly_reset', weekly.reset);
    m.set('oai_weekly_elapsed', weekly.elapsed);
    m.set('oai_weekly_pace', weekly.ratioPace);
    m.set('oai_weekly_pace_indicator', weekly.pointPace);
    m.set('oai_code_review_pct', String(codeReview ? codeReview.utilizationPct : 0));
    m.set('oai_credit_balance', credits ? credits.balance : 'n/a');
    m.set('oai_local_msgs', credits && credits.approxLocalMessages
        ? `${credits.approxLocalMessages[0]}-${credits.approxLocalMessages[1]}` : '');
    m.set('oai_cloud_msgs', credits && credits.approxCloudMessages
        ? `${credits.approxCloudMessages[0]}-${credits.approxCloudMessages[1]}` : '');

    const resets = snapshot.resetCredits?.available ?? 0;
    m.set('oai_resets_available', String(resets));
    m.set('oai_resets', resetsAvailableText(resets, ngettext));

    return m;
}

export function notifyRows(snapshot, _ = (s) => s) {
    const windows = [
        ['session', _('Codex 5h'), snapshot.session],
        ['weekly', _('Codex weekly'), snapshot.weekly],
        ['code-review', _('Code review (weekly)'), snapshot.codeReview],
    ];
    return windows.filter(([, , w]) => w)
        .map(([key, label, w]) => ({key, label, percent: w.utilizationPct, resetsAt: w.resetsAt}));
}

export function resetCredits(snapshot) {
    return snapshot.resetCredits?.credits ?? [];
}

export const CACHE_VERSION = 3;

export function snapshotToCacheJson(snapshot) {
    return encodeSnapshot(snapshot, CACHE_VERSION);
}

export function parseCacheJson(bytesOrText) {
    return decodeSnapshot(bytesOrText, CACHE_VERSION, SchemaError);
}

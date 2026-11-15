import {fakeWindow} from '../fake.js';
import {sanitizeUntrusted, checkedResetTitle, resetsAvailableText} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';
import {
    SchemaError, isObject, isFiniteNumber, decodeJsonObject, parseInstant, capitalize, SESSION_MS, WEEKLY_MS,
} from '../parse-common.js';
import {windowFields, setWindowPlaceholders, peakOf, EMPTY_FIELDS, SHARED_SUFFIXES} from '../placeholder-common.js';

export {SchemaError, SESSION_MS, WEEKLY_MS};

export const ICON = '󱢆';
export const VENDOR_SHORT = 'gpt';

function intLenient(v) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!isFiniteNumber(n))
        return 0;
    return Math.trunc(n);
}

function optInt(v) {
    if (!isFiniteNumber(v))
        return null;
    return Math.trunc(v);
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


// Only an available credit is one still held; the redemption `id` is never read.
function availableCredits(list) {
    checkCollection(list, 'rate_limit_reset_credits.credits', false);
    return (list ?? [])
        .filter(c => isObject(c) && c.status === 'available')
        .map(c => ({title: checkedResetTitle(c.title), expiresAt: parseInstant(c.expires_at)}));
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
    return availableCredits(decodeJsonObject(bytesOrText, 'reset credits response').credits);
}

// The count always stays the usage endpoint's: it is the response the rest
// of the snapshot is consistent with.
export function mergeResetCredits(snapshot, credits) {
    return {...snapshot, resetCredits: {available: snapshot.resetCredits.available, credits}};
}

export function parseUsage(bytesOrText, planHint) {
    const obj = decodeJsonObject(bytesOrText, 'usage response');

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
    return peakOf([snapshot.session, snapshot.weekly, snapshot.codeReview]
        .filter(Boolean)
        .map(w => ({percent: w.utilizationPct, resetsAt: w.resetsAt})));
}

export function placeholders(snapshot, now, ngettext) {
    const m = new Map();
    const {codeReview, credits} = snapshot;
    // An absent window renders empty, never an invented 0%.
    const fields = {
        session: snapshot.session ? windowFields(snapshot.session, now) : EMPTY_FIELDS,
        weekly: snapshot.weekly ? windowFields(snapshot.weekly, now) : EMPTY_FIELDS,
    };

    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('plan', snapshot.plan);
    m.set('oai_plan', snapshot.plan);
    for (const name of ['session', 'weekly']) {
        setWindowPlaceholders(m, `oai_${name}`, fields[name]);
        setWindowPlaceholders(m, name, fields[name], SHARED_SUFFIXES);
    }
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
    return decodeSnapshot(bytesOrText, CACHE_VERSION);
}

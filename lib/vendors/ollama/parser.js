import {severityFor} from '../../severity.js';
import {calc, paceGlyph} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {fakeWindow} from '../fake.js';
import {formatMoney} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';

// Nerd Fonts has no llama glyph; md-robot, like the other API-key vendors.
export const ICON = '󰚩';
export const VENDOR_SHORT = 'oll';
export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;
export const MONTHLY_MS = 30 * 86400 * 1000;

const WINDOWS = Object.freeze(['session', 'weekly', 'monthly']);

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function parseInstant(v) {
    if (typeof v !== 'string')
        return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
}

function clampRound(v, max) {
    return Math.round(Math.min(max, Math.max(0, v)));
}

// `remaining_percent` is what is left, so the usage is its complement.
function remainingWindow(w, windowMs) {
    if (!isObject(w) || !isNumber(w.remaining_percent))
        return null;
    const resetsAt = parseInstant(w.resets_at);
    if (resetsAt === null)
        return null;
    return {utilizationPct: clampRound(100 - w.remaining_percent, 100), resetsAt, windowMs};
}

function creditsPeriod(included) {
    if (!isNumber(included.balance_usd) || !isNumber(included.allowance_usd) || !isObject(included.period))
        return null;
    const from = parseInstant(included.period.from);
    const until = parseInstant(included.period.until);
    return from && until ? {from, until} : null;
}

function purchasedUsd(purchased) {
    if (purchased === undefined || purchased === null)
        return null;
    if (!isObject(purchased) || !isNumber(purchased.balance_usd))
        throw new SchemaError('ollama: purchased.balance_usd is not a number');
    return purchased.balance_usd;
}

// `/api/balance` comes in two shapes: monthly included credits, or the
// session/weekly quota. Anything else (the request/token history `/api/usage`
// now returns, an empty object) is rejected rather than read as empty limits.
export function parseUsage(bytesOrText, plan = null) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`ollama: balance response unparseable: ${e?.message ?? e}`);
    }
    if (!isObject(obj) || !isObject(obj.included))
        throw new SchemaError('ollama: balance response has no `included` block');
    const included = obj.included;
    const purchased = purchasedUsd(obj.purchased);
    const snapshot = {plan: plan || null, session: null, weekly: null, monthly: null, credits: null};

    const period = creditsPeriod(included);
    if (period) {
        const balance = included.balance_usd;
        const allowance = included.allowance_usd;
        // A zero allowance has no measurable share; the balance is still shown.
        if (allowance > 0) {
            snapshot.monthly = {
                utilizationPct: clampRound((1 - balance / allowance) * 100, 100),
                resetsAt: period.until,
                windowMs: period.until.getTime() - period.from.getTime(),
            };
        }
        snapshot.credits = {balanceUsd: balance, allowanceUsd: allowance, purchasedUsd: purchased};
        return snapshot;
    }

    const session = remainingWindow(included.session, SESSION_MS);
    const weekly = remainingWindow(included.weekly, WEEKLY_MS);
    if (session === null || weekly === null)
        throw new SchemaError('ollama: `included` is neither monthly credits nor a session/weekly quota');
    snapshot.session = session;
    snapshot.weekly = weekly;
    return snapshot;
}

// Every window and the credits block at once, so the popup shows each row.
export function fakeSnapshot(pct, now = new Date()) {
    return {
        plan: 'Pro (fake)',
        session: fakeWindow(pct, SESSION_MS, now),
        weekly: fakeWindow(pct, WEEKLY_MS, now),
        monthly: fakeWindow(pct, MONTHLY_MS, now),
        credits: {balanceUsd: 60 * (1 - pct / 100), allowanceUsd: 60, purchasedUsd: 12.5},
    };
}

function presentWindows(snapshot) {
    return WINDOWS.map(name => [name, snapshot[name]]).filter(([, w]) => w);
}

export function ollamaPeakUsage(snapshot) {
    let peak = null;
    for (const [, w] of presentWindows(snapshot)) {
        if (peak === null || w.utilizationPct > peak.percent)
            peak = {percent: w.utilizationPct, resetsAt: w.resetsAt};
    }
    return peak ?? {percent: 0, resetsAt: null};
}

export function ollamaSeverity(snapshot) {
    return severityFor(ollamaPeakUsage(snapshot).percent);
}

export function planLabel(snapshot) {
    return snapshot.plan ?? 'Ollama';
}

export function windowPace(win, now) {
    return calc({usagePct: win.utilizationPct, reset: win.resetsAt, now, windowMs: win.windowMs});
}

function setWindow(m, prefix, win, now) {
    if (!win) {
        for (const suffix of ['pct', 'reset', 'elapsed', 'pace', 'pace_indicator'])
            m.set(`${prefix}_${suffix}`, '');
        return;
    }
    const pace = windowPace(win, now);
    m.set(`${prefix}_pct`, String(win.utilizationPct));
    m.set(`${prefix}_reset`, formatCountdown(win.resetsAt, now));
    m.set(`${prefix}_elapsed`, String(pace.elapsedPct));
    m.set(`${prefix}_pace`, paceGlyph(pace.ratioPace, pace.state));
    m.set(`${prefix}_pace_indicator`, paceGlyph(pace.pointPace, pace.state));
}

export function placeholders(snapshot, now) {
    const m = new Map();
    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('plan', planLabel(snapshot));
    m.set('oll_plan', planLabel(snapshot));
    // `/api/balance` carries no activity cost; kept so a saved format still renders.
    m.set('oll_cost', '-');

    const credits = snapshot.credits;
    m.set('oll_balance', credits ? formatMoney(credits.balanceUsd) : '');
    m.set('oll_allowance', credits ? formatMoney(credits.allowanceUsd) : '');
    m.set('oll_purchased', credits && credits.purchasedUsd !== null ? formatMoney(credits.purchasedUsd) : '');

    for (const name of WINDOWS)
        setWindow(m, `oll_${name}`, snapshot[name], now);
    for (const alias of ['session', 'weekly'])
        setWindow(m, alias, snapshot[alias], now);
    return m;
}

export function notifyRows(snapshot, _ = (s) => s) {
    const labels = {session: _('Session'), weekly: _('Weekly'), monthly: _('Monthly')};
    return presentWindows(snapshot)
        .map(([key, w]) => ({key, label: labels[key], percent: w.utilizationPct, resetsAt: w.resetsAt}));
}

export function resetCredits(_snapshot) {
    return [];
}

export const CACHE_VERSION = 2;

export function snapshotToCacheJson(snapshot) {
    return encodeSnapshot(snapshot, CACHE_VERSION);
}

export function parseCacheJson(bytesOrText) {
    return decodeSnapshot(bytesOrText, CACHE_VERSION, SchemaError);
}

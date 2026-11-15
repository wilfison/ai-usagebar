import {severityFor} from '../../severity.js';
import {fakeWindow} from '../fake.js';
import {formatMoney} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';
import {SchemaError, isObject, isFiniteNumber, decodeJson, parseInstant, SESSION_MS, WEEKLY_MS, MONTH_MS} from '../parse-common.js';
import {windowFields, setWindowPlaceholders, peakOf, EMPTY_FIELDS} from '../placeholder-common.js';

export {SchemaError, SESSION_MS, WEEKLY_MS};

// Nerd Fonts has no llama glyph; md-robot, like the other API-key vendors.
export const ICON = '󰚩';
export const VENDOR_SHORT = 'oll';
export const MONTHLY_MS = MONTH_MS;

const WINDOWS = Object.freeze(['session', 'weekly', 'monthly']);

function clampRound(v, max) {
    return Math.round(Math.min(max, Math.max(0, v)));
}

// `remaining_percent` is what is left, so the usage is its complement.
function remainingWindow(w, windowMs) {
    if (!isObject(w) || !isFiniteNumber(w.remaining_percent))
        return null;
    const resetsAt = parseInstant(w.resets_at);
    if (resetsAt === null)
        return null;
    return {utilizationPct: clampRound(100 - w.remaining_percent, 100), resetsAt, windowMs};
}

function creditsPeriod(included) {
    if (!isFiniteNumber(included.balance_usd) || !isFiniteNumber(included.allowance_usd) || !isObject(included.period))
        return null;
    const from = parseInstant(included.period.from);
    const until = parseInstant(included.period.until);
    return from && until ? {from, until} : null;
}

function purchasedUsd(purchased) {
    if (purchased === undefined || purchased === null)
        return null;
    if (!isObject(purchased) || !isFiniteNumber(purchased.balance_usd))
        throw new SchemaError('ollama: purchased.balance_usd is not a number');
    return purchased.balance_usd;
}

// `/api/balance` comes in two shapes: monthly included credits, or the
// session/weekly quota. Anything else (the request/token history `/api/usage`
// now returns, an empty object) is rejected rather than read as empty limits.
export function parseUsage(bytesOrText, plan = null) {
    const obj = decodeJson(bytesOrText, 'ollama: balance response');
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
    return peakOf(presentWindows(snapshot).map(([, w]) => ({percent: w.utilizationPct, resetsAt: w.resetsAt})));
}

export function ollamaSeverity(snapshot) {
    return severityFor(ollamaPeakUsage(snapshot).percent);
}

export function planLabel(snapshot) {
    return snapshot.plan ?? 'Ollama';
}

function setWindow(m, prefix, win, now) {
    setWindowPlaceholders(m, prefix, win ? windowFields(win, now) : EMPTY_FIELDS);
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
    return decodeSnapshot(bytesOrText, CACHE_VERSION);
}

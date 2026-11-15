import {calc} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {sanitizeUntrusted, formatMoney} from '../../format.js';
import {fakeWindow, clampPct} from '../fake.js';
import {resolve} from '../../json-pointer.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';
import {SchemaError, isFiniteNumber, decodeJson} from '../parse-common.js';
import {peakOf} from '../placeholder-common.js';

export {SchemaError};

export const ICON = '󰒓';
export const VENDOR_SHORT = 'cst';
export const MAX_STRING_CHARS = 200;
// A Unix epoch at or above this is read as milliseconds, below it as seconds.
const EPOCH_MS_THRESHOLD = 1e11;
// Plain decimal or exponent notation only: "1,234", "inf" and "0x10" are not numbers here.
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u;

function clean(s) {
    return sanitizeUntrusted(s, MAX_STRING_CHARS).replace(/\n/gu, ' ');
}

function describe(v) {
    if (v === null)
        return 'null';
    if (Array.isArray(v))
        return 'an array';
    return `a ${typeof v}`;
}

function lookup(body, pointer) {
    const v = resolve(body, pointer);
    if (v === undefined)
        throw new SchemaError(`custom: ${pointer} is missing`);
    return v;
}

function parseNumericString(s) {
    const t = s.trim();
    if (!NUMERIC.test(t))
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

function readNumber(body, pointer) {
    const v = lookup(body, pointer);
    if (isFiniteNumber(v))
        return v;
    if (typeof v === 'string') {
        const n = parseNumericString(v);
        if (n !== null)
            return n;
        throw new SchemaError(`custom: ${pointer} is a string that does not hold a number`);
    }
    throw new SchemaError(`custom: ${pointer} is ${describe(v)}, expected a number`);
}

function epochToDate(n) {
    if (!Number.isFinite(n) || n < 0)
        return null;
    return new Date(n < EPOCH_MS_THRESHOLD ? Math.trunc(n) * 1000 : Math.trunc(n));
}

function readTimestamp(body, pointer) {
    const v = lookup(body, pointer);
    let date = null;
    if (typeof v === 'number') {
        date = epochToDate(v);
    } else if (typeof v === 'string') {
        const n = parseNumericString(v);
        if (n !== null) {
            date = epochToDate(n);
        } else if (/^\d{4}-\d{2}-\d{2}T/u.test(v.trim())) {
            const t = Date.parse(v.trim());
            date = Number.isNaN(t) ? null : new Date(t);
        }
    } else {
        throw new SchemaError(`custom: ${pointer} is ${describe(v)}, expected an RFC 3339 string or a Unix epoch`);
    }
    if (date === null)
        throw new SchemaError(`custom: ${pointer} is not an RFC 3339 timestamp or a non-negative Unix epoch`);
    return date;
}

export function formatNumber(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15)
        return String(n);
    return n.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
}

// An optional `currency` turns a figure into money, formatted like the
// built-in vendors' money rows.
export function figure(n, currency) {
    return currency ? formatMoney(n, currency) : formatNumber(n);
}

function projectMetric(body, spec, now) {
    let pct;
    let amount = null;
    if (spec.percent) {
        pct = clampPct(readNumber(body, spec.percent));
    } else {
        const used = readNumber(body, spec.used);
        const limit = readNumber(body, spec.limit);
        if (limit <= 0)
            throw new SchemaError(`custom: ${spec.limit} must be greater than zero`);
        pct = clampPct((used / limit) * 100);
        amount = {used, limit, currency: spec.currency ?? null};
    }

    let resetsAt = null;
    if (spec.resetsAt) {
        resetsAt = readTimestamp(body, spec.resetsAt);
    } else if (spec.resetsAfterSeconds) {
        const secs = readNumber(body, spec.resetsAfterSeconds);
        if (secs < 0)
            throw new SchemaError(`custom: ${spec.resetsAfterSeconds} cannot be negative`);
        resetsAt = new Date(now.getTime() + secs * 1000);
    }

    return {
        label: clean(spec.label),
        pct,
        amount,
        resetsAt,
        windowMs: Number.isInteger(spec.windowSecs) ? spec.windowSecs * 1000 : null,
    };
}

function projectText(body, spec) {
    if (spec.currency)
        return {label: clean(spec.label), value: formatMoney(readNumber(body, spec.value), spec.currency)};
    const v = lookup(body, spec.value);
    let value;
    if (typeof v === 'string')
        value = clean(v);
    else if (isFiniteNumber(v))
        value = formatNumber(v);
    else if (typeof v === 'boolean')
        value = String(v);
    else
        throw new SchemaError(`custom: ${spec.value} is ${describe(v)}, expected a string, number, or boolean`);
    return {label: clean(spec.label), value};
}

// A pointer that does not resolve, or resolves to the wrong type, fails the
// whole projection so the fetch falls back to the stale cache.
export function parseUsage(bytesOrText, mapping, now = new Date()) {
    const body = decodeJson(bytesOrText, 'custom response');

    let plan = null;
    if (mapping.planPath) {
        const v = lookup(body, mapping.planPath);
        if (typeof v !== 'string')
            throw new SchemaError(`custom: ${mapping.planPath} is ${describe(v)}, expected a string`);
        plan = clean(v);
    } else if (typeof mapping.plan === 'string' && mapping.plan !== '') {
        plan = clean(mapping.plan);
    }

    return {
        plan,
        metrics: (mapping.metrics ?? []).map(m => projectMetric(body, m, now)),
        texts: (mapping.texts ?? []).map(t => projectText(body, t)),
    };
}

export function customPeakUsage(snapshot) {
    return peakOf(snapshot.metrics.map(m => ({percent: m.pct, resetsAt: m.resetsAt})), {percent: null, resetsAt: null});
}

export function placeholders(snapshot, now) {
    const m = new Map();
    const plan = snapshot.plan ?? '';
    m.set('icon', ICON);
    m.set('vendor_short', shortCode(snapshot.name).toLowerCase());
    m.set('plan', plan);
    m.set('custom_plan', plan);

    snapshot.metrics.forEach((metric, i) => {
        const reset = formatCountdown(metric.resetsAt, now);
        m.set(`custom_${i}_pct`, String(metric.pct));
        m.set(`custom_${i}_reset`, reset);
        const alias = ['session', 'weekly'][i];
        if (alias) {
            m.set(`${alias}_pct`, String(metric.pct));
            m.set(`${alias}_reset`, reset);
            m.set(`${alias}_elapsed`, String(metricPace(metric, now)?.elapsedPct ?? 0));
        }
    });
    return m;
}

// Pace needs both an absolute reset and the window length to measure against.
export function metricPace(metric, now) {
    if (metric.resetsAt === null || metric.windowMs === null)
        return null;
    return calc({usagePct: metric.pct, reset: metric.resetsAt, now, windowMs: metric.windowMs});
}

// The panel badge for a user-named provider: its first three ASCII letters,
// accents folded ("Café Pro" → "CAF"), or CST when it has none.
export function shortCode(name) {
    const letters = String(name ?? '')
        .normalize('NFD')
        .replace(/[^A-Za-z]/gu, '')
        .toUpperCase();
    return letters.slice(0, 3) || VENDOR_SHORT.toUpperCase();
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT): one
// paced 5h metric, one money metric and one text, like a typical mapping. The
// adapter adds the configured name, as main.js does for a real fetch.
export function fakeSnapshot(pctVal, now = new Date()) {
    const {utilizationPct: pct, resetsAt, windowMs} = fakeWindow(pctVal, 5 * 3600_000, now);
    return {
        plan: 'Custom (fake)',
        metrics: [
            {label: 'Requests', pct, amount: null, resetsAt, windowMs},
            {label: 'Budget', pct, amount: {used: pct / 2, limit: 50, currency: 'USD'}, resetsAt: null, windowMs: null},
        ],
        texts: [{label: 'Tier', value: 'fake'}],
    };
}

export function notifyRows(snapshot) {
    return snapshot.metrics.map(m => ({key: `metric:${m.label}`, label: m.label, percent: m.pct, resetsAt: m.resetsAt}));
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

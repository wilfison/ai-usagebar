import {severityFor} from '../../severity.js';
import {calc} from '../../pacing.js';
import {format as formatCountdown} from '../../countdown.js';
import {sanitizeUntrusted, formatMoney} from '../../format.js';
import {resolve, isValidPointer} from '../../json-pointer.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';

export const ICON = '󰒓';
export const VENDOR_SHORT = 'cst';
export const MAX_STRING_CHARS = 200;
export const DEFAULT_NAME = 'Custom';
export const MAX_NAME_CHARS = 48;
const LABEL_MAX = 64;
const MIN_WINDOW_SECS = 60;
// A Unix epoch at or above this is read as milliseconds, below it as seconds.
const EPOCH_MS_THRESHOLD = 1e11;
// Plain decimal or exponent notation only: "1,234", "inf" and "0x10" are not numbers here.
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

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
    if (typeof v === 'number' && Number.isFinite(v))
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

const CURRENCY_CODE = /^[A-Z]{3}$/u;

// An optional `currency` turns a figure into money, formatted like the
// built-in vendors' money rows.
function figure(n, currency) {
    return currency ? formatMoney(n, currency) : formatNumber(n);
}

function clampPct(v) {
    return Math.min(100, Math.max(0, Math.round(v)));
}

function projectMetric(body, spec, now) {
    let pct;
    let footnote = '';
    if (spec.percent) {
        pct = clampPct(readNumber(body, spec.percent));
    } else {
        const used = readNumber(body, spec.used);
        const limit = readNumber(body, spec.limit);
        if (limit <= 0)
            throw new SchemaError(`custom: ${spec.limit} must be greater than zero`);
        pct = clampPct((used / limit) * 100);
        footnote = `${figure(used, spec.currency)} of ${figure(limit, spec.currency)}`;
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
        footnote,
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
    else if (typeof v === 'number' && Number.isFinite(v))
        value = formatNumber(v);
    else if (typeof v === 'boolean')
        value = String(v);
    else
        throw new SchemaError(`custom: ${spec.value} is ${describe(v)}, expected a string, number, or boolean`);
    return {label: clean(spec.label), value};
}

function checkPointer(errors, where, pointer) {
    if (pointer !== undefined && pointer !== null && !isValidPointer(pointer))
        errors.push(`${where}: ${JSON.stringify(pointer)} is not a JSON Pointer (it must start with /)`);
}

function checkCurrency(errors, where, currency) {
    if (currency !== undefined && currency !== null && !(typeof currency === 'string' && CURRENCY_CODE.test(currency)))
        errors.push(`${where}.currency: ${JSON.stringify(currency)} is not a three-letter uppercase currency code`);
}

function checkLabel(errors, where, label, seen) {
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (typeof label !== 'string' || label.length < 1 || label.length > LABEL_MAX || /[\u0000-\u001F\u007F-\u009F]/u.test(label)) {
        errors.push(`${where}: label must be 1–${LABEL_MAX} characters without control characters`);
        return;
    }
    if (seen.has(label))
        errors.push(`${where}: label ${JSON.stringify(label)} is used twice`);
    seen.add(label);
}

// Every problem with a mapping, as messages; an empty list means it is valid.
export function validateMapping(mapping) {
    const errors = [];
    if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping))
        return ['mapping must be a JSON object'];
    const metrics = mapping.metrics ?? [];
    const texts = mapping.texts ?? [];
    if (!Array.isArray(metrics) || !Array.isArray(texts))
        return ['metrics and texts must be lists'];
    if (metrics.length === 0 && texts.length === 0)
        errors.push('mapping needs at least one metric or text');
    checkPointer(errors, 'planPath', mapping.planPath);

    const seen = new Set();
    metrics.forEach((m, i) => {
        const where = `metrics[${i}]`;
        if (m === null || typeof m !== 'object') {
            errors.push(`${where}: must be an object`);
            return;
        }
        checkLabel(errors, where, m.label, seen);
        for (const key of ['used', 'limit', 'percent', 'resetsAt', 'resetsAfterSeconds'])
            checkPointer(errors, `${where}.${key}`, m[key]);
        if (m.percent && (m.used || m.limit))
            errors.push(`${where}: percent cannot be combined with used/limit`);
        else if (!m.percent && !(m.used && m.limit))
            errors.push(`${where}: needs percent, or both used and limit`);
        checkCurrency(errors, where, m.currency);
        if (m.currency && m.percent)
            errors.push(`${where}: currency cannot be combined with percent`);
        if (m.windowSecs !== undefined && m.windowSecs !== null && !(Number.isInteger(m.windowSecs) && m.windowSecs >= MIN_WINDOW_SECS))
            errors.push(`${where}.windowSecs: must be an integer of at least ${MIN_WINDOW_SECS}`);
    });
    texts.forEach((t, i) => {
        const where = `texts[${i}]`;
        if (t === null || typeof t !== 'object') {
            errors.push(`${where}: must be an object`);
            return;
        }
        checkLabel(errors, where, t.label, seen);
        if (!isValidPointer(t.value))
            errors.push(`${where}.value: must be a JSON Pointer`);
        checkCurrency(errors, where, t.currency);
    });
    return errors;
}

// A pointer that does not resolve, or resolves to the wrong type, fails the
// whole projection so the fetch falls back to the stale cache.
export function parseUsage(bytesOrText, mapping, now = new Date()) {
    const text = bytesOrText instanceof Uint8Array
        ? new TextDecoder().decode(bytesOrText)
        : String(bytesOrText);
    let body;
    try {
        body = JSON.parse(text);
    } catch (e) {
        throw new SchemaError(`custom response unparseable: ${e?.message ?? e}`);
    }

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
    let peak = null;
    for (const m of snapshot.metrics) {
        if (peak === null || m.pct > peak.pct)
            peak = m;
    }
    return peak ? {percent: peak.pct, resetsAt: peak.resetsAt} : {percent: null, resetsAt: null};
}

export function customSeverity(snapshot) {
    return severityFor(customPeakUsage(snapshot).percent ?? 0);
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

export function providerName(raw) {
    const name = String(raw ?? '').trim();
    return name === '' ? DEFAULT_NAME : Array.from(name).slice(0, MAX_NAME_CHARS).join('');
}

// Why a URL may not be fetched, or null when it may. Only https unless the
// user allowed http; no credentials embedded in the URL; a host is required.
export function urlProblem(url, allowHttp) {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/iu.exec(String(url ?? '').trim());
    if (!m)
        return 'custom provider: set an absolute https:// URL in the preferences';
    const scheme = m[1].toLowerCase();
    if (scheme !== 'https' && !(scheme === 'http' && allowHttp))
        return scheme === 'http'
            ? 'custom provider: http:// is refused unless "Allow plain HTTP" is on'
            : `custom provider: unsupported URL scheme ${scheme}`;
    if (m[2].includes('@'))
        return 'custom provider: the URL must not embed a user name or password';
    if (m[2] === '' || m[2].startsWith(':'))
        return 'custom provider: the URL has no host';
    return null;
}

function parseJsonObject(text) {
    try {
        const v = JSON.parse(text);
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (_e) {
        return null;
    }
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

// The extra-headers pref: '' is none; anything but an object of plain string
// header values, or one repeating the auth header, is invalid (null).
export function parseExtraHeaders(text, authHeader) {
    if (String(text ?? '').trim() === '')
        return {};
    const obj = parseJsonObject(text);
    if (obj === null)
        return null;
    for (const [name, value] of Object.entries(obj)) {
        // eslint-disable-next-line no-control-regex -- a header value must not carry control characters
        if (!HEADER_NAME.test(name) || typeof value !== 'string' || /[\u0000-\u001F\u007F]/u.test(value))
            return null;
        if (authHeader && name.toLowerCase() === authHeader.toLowerCase())
            return null;
    }
    return obj;
}

// The mapping pref: null when empty, unparseable, or invalid.
export function parseMapping(text) {
    const obj = parseJsonObject(String(text ?? ''));
    return obj !== null && validateMapping(obj).length === 0 ? obj : null;
}

// The request headers: Accept, the extras, then the auth header when a key
// is set. An empty scheme sends the key bare.
export function requestHeaders({authHeader, authScheme, extraHeaders}, apiKey) {
    const headers = {Accept: 'application/json', ...extraHeaders};
    if (apiKey)
        headers[authHeader || 'Authorization'] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
    return headers;
}

export function notifyRows(snapshot) {
    return snapshot.metrics.map(m => ({key: `metric:${m.label}`, label: m.label, percent: m.pct, resetsAt: m.resetsAt}));
}

export function resetCredits(_snapshot) {
    return [];
}

export const CACHE_VERSION = 1;

export function snapshotToCacheJson(snapshot) {
    return encodeSnapshot(snapshot, CACHE_VERSION);
}

export function parseCacheJson(bytesOrText) {
    return decodeSnapshot(bytesOrText, CACHE_VERSION, SchemaError);
}

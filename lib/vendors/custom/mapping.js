// The custom provider's configuration: the prefs it reads, checked and
// normalized. Pure, and kept apart from the parser so the prefs process loads
// only this.
import {isValidPointer} from '../../json-pointer.js';
import {isObject, isCurrencyCode} from '../parse-common.js';

export const DEFAULT_NAME = 'Custom';
export const MAX_NAME_CHARS = 48;
export const DEFAULT_AUTH_HEADER = 'Authorization';
const LABEL_MAX = 64;
const MIN_WINDOW_SECS = 60;

function checkPointer(errors, where, pointer) {
    if (pointer !== undefined && pointer !== null && !isValidPointer(pointer))
        errors.push(`${where}: ${JSON.stringify(pointer)} is not a JSON Pointer (it must start with /)`);
}

function checkCurrency(errors, where, currency) {
    if (currency !== undefined && currency !== null && !isCurrencyCode(currency))
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
    if (!isObject(mapping))
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
        return isObject(v) ? v : null;
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
        headers[authHeader || DEFAULT_AUTH_HEADER] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
    return headers;
}

// The auth header pref; blank is the default header.
export function authHeaderOf(raw) {
    return String(raw ?? '').trim() || DEFAULT_AUTH_HEADER;
}

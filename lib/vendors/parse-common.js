// Shared building blocks of the vendor parsers.

export const SESSION_MS = 5 * 3600 * 1000;
export const WEEKLY_MS = 7 * 86400 * 1000;
export const MONTH_MS = 30 * 86400 * 1000;

export class SchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaError';
    }
}

export function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

export function decodeText(bytesOrText) {
    return bytesOrText instanceof Uint8Array ? new TextDecoder().decode(bytesOrText) : String(bytesOrText);
}

// `what` names the document in the error ("zai quota response unparseable: …").
export function decodeJson(bytesOrText, what, {reviver, SchemaError: ErrorClass = SchemaError} = {}) {
    try {
        return JSON.parse(decodeText(bytesOrText), reviver);
    } catch (e) {
        throw new ErrorClass(`${what} unparseable: ${e?.message ?? e}`);
    }
}

export function decodeJsonObject(bytesOrText, what, opts = {}) {
    const obj = decodeJson(bytesOrText, what, opts);
    if (!isObject(obj))
        throw new (opts.SchemaError ?? SchemaError)(`${what}: top-level value is not an object`);
    return obj;
}

export function parseInstant(v) {
    if (typeof v !== 'string')
        return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
}

const CURRENCY_CODE = /^[A-Z]{3}$/u;

// A plausible ISO 4217 alpha code, safe to embed verbatim in a label.
export function isCurrencyCode(v) {
    return typeof v === 'string' && CURRENCY_CODE.test(v);
}

export function capitalize(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

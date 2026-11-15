// The cache holds the projected snapshot, never a raw response body: only
// fields a renderer reads reach disk, so a field a vendor adds later (an
// email, an account id) cannot quietly start living in ~/.cache.

import {SchemaError as DefaultSchemaError, isObject, decodeJson} from './parse-common.js';

const DATE_KEY = '$date';

export function encodeSnapshot(snapshot, cacheVersion) {
    return JSON.stringify({cacheVersion, snapshot}, function (key, value) {
        const raw = this[key];
        return raw instanceof Date ? {[DATE_KEY]: raw.getTime()} : value;
    });
}

function reviveDate(_key, value) {
    if (isObject(value) && Object.keys(value).length === 1 && Number.isFinite(value[DATE_KEY]))
        return new Date(value[DATE_KEY]);
    return value;
}

// Anything without our exact version (an older format, a raw body cached by
// a previous release) throws, so the caller treats it as corrupt and refetches.
export function decodeSnapshot(bytesOrText, cacheVersion, SchemaError = DefaultSchemaError) {
    const obj = decodeJson(bytesOrText, 'cache', {reviver: reviveDate, SchemaError});
    if (!isObject(obj) || obj.cacheVersion !== cacheVersion)
        throw new SchemaError(`cache: expected cacheVersion ${cacheVersion}`);
    if (!isObject(obj.snapshot))
        throw new SchemaError('cache: missing snapshot');
    return obj.snapshot;
}

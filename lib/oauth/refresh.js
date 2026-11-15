// The OAuth refresh-token exchange both CLIs' credentials use. Pure: the
// HTTP function is injected.
import {isSuccess, bodyText} from '../vendors/fetch-common.js';

export const REFRESH_BUFFER_SECS = 300;

export function needsRefresh(expiresAtSecs, nowSecs) {
    return expiresAtSecs < nowSecs + REFRESH_BUFFER_SECS;
}

export function decodeExpiresIn(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

export function parseErrorBody(text) {
    let v;
    try {
        v = JSON.parse(text);
    } catch (_) {
        return null;
    }
    if (v === null || typeof v !== 'object')
        return null;
    if (typeof v.error_description === 'string')
        return v.error_description;
    if (v.error !== null && typeof v.error === 'object' && typeof v.error.message === 'string')
        return v.error.message;
    if (typeof v.error === 'string')
        return v.error;
    return null;
}

// POSTs a refresh request: `{ok:true, accessToken, payload}`, or a failure
// of kind `transport` (silent), `http` (with the provider's error text) or
// `schema` (a 2xx we cannot use), its message prefixed with `label`.
export async function postTokenRefresh(http, {
    endpoint, headers, body, timeoutMs = 25_000, cancellable, label, httpFallback = () => 'Refresh failed',
}) {
    let res;
    try {
        res = await http({method: 'POST', url: endpoint, headers, body, timeoutMs, cancellable});
    } catch (e) {
        return {ok: false, kind: 'transport', message: e?.message ?? String(e)};
    }
    // Timeouts collapse into transport: callers treat both as a silent fallback.
    if (res.error)
        return {ok: false, kind: 'transport', message: res.error.message};

    const text = bodyText(res);
    if (!isSuccess(res.status))
        return {ok: false, kind: 'http', status: res.status, body: parseErrorBody(text) ?? httpFallback(res.status)};

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (e) {
        return {ok: false, kind: 'schema', message: `${label}: ${e?.message ?? e}`};
    }
    if (payload === null || typeof payload !== 'object')
        return {ok: false, kind: 'schema', message: `${label}: not a JSON object`};
    if (typeof payload.access_token !== 'string')
        return {ok: false, kind: 'schema', message: `${label}: missing access_token`};
    return {ok: true, accessToken: payload.access_token, payload};
}

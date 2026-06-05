import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const DEFAULT_USER_AGENT = 'ai-usagebar/0.1';
const DEFAULT_TIMEOUT_MS = 10_000;

let _session = null;
const _pendingCancellables = new Set();
const _activeTimeouts = new Set();

export function getSession() {
    if (_session === null)
        _session = new Soup.Session();
    return _session;
}

// disposeSession() returns immediately; cancelled promises drain on the
// next event-loop tick (Q4). `disable()` must never block on outstanding I/O.
export function disposeSession() {
    for (const c of _pendingCancellables) {
        try {
            c.cancel();
        } catch (_) { /* best-effort */ }
    }
    _pendingCancellables.clear();
    for (const id of _activeTimeouts) {
        try {
            GLib.Source.remove(id);
        } catch (_) { /* best-effort */ }
    }
    _activeTimeouts.clear();
    _session = null;
}

export function _debug() {
    return {
        activeTimeouts: _activeTimeouts.size,
        pendingCancellables: _pendingCancellables.size,
        sessionExists: _session !== null,
    };
}

function isPlainObject(v) {
    if (v === null || typeof v !== 'object')
        return false;
    if (Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
}

function validateHeaders(headers) {
    if (headers === undefined || headers === null)
        return {};
    if (!isPlainObject(headers))
        throw new TypeError('request: headers must be a plain object whose values are strings');
    return headers;
}

function encodeBody(body) {
    if (body === undefined || body === null)
        return null;
    if (body instanceof Uint8Array)
        return body;
    if (typeof body === 'string')
        return new TextEncoder().encode(body);
    throw new TypeError('request: body must be string, Uint8Array, or omitted');
}

function headersToObject(messageHeaders) {
    const result = {};
    messageHeaders.foreach((name, value) => {
        result[name.toLowerCase()] = value;
    });
    return result;
}

function bytesToU8(bytes) {
    if (bytes === null || bytes === undefined)
        return new Uint8Array(0);
    const data = bytes.get_data?.();
    if (data === null || data === undefined)
        return new Uint8Array(0);
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function request(opts) {
    const o = opts ?? {};
    const method = o.method ?? 'GET';
    const url = o.url;
    if (!url || typeof url !== 'string')
        throw new TypeError('request: url is required');
    const headers = validateHeaders(o.headers);
    const bodyBytes = encodeBody(o.body);
    const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const callerCancellable = o.cancellable ?? null;

    return new Promise((resolve) => {
        const session = getSession();
        const internalCancellable = new Gio.Cancellable();
        _pendingCancellables.add(internalCancellable);

        let timeoutId = 0;
        let timedOut = false;
        let linkHandlerId = 0;
        let settled = false;

        const cleanup = () => {
            if (timeoutId !== 0) {
                GLib.Source.remove(timeoutId);
                _activeTimeouts.delete(timeoutId);
                timeoutId = 0;
            }
            if (linkHandlerId !== 0 && callerCancellable) {
                try {
                    callerCancellable.disconnect(linkHandlerId);
                } catch (_) { /* best-effort */ }
                linkHandlerId = 0;
            }
            _pendingCancellables.delete(internalCancellable);
        };

        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const fail = (kind, message) => settle({
            status: 0,
            headers: {},
            bodyBytes: new Uint8Array(0),
            error: {kind, message},
        });

        let msg;
        try {
            msg = Soup.Message.new(method, url);
        } catch (e) {
            fail('transport', `invalid URL: ${e?.message ?? e}`);
            return;
        }
        if (msg === null) {
            fail('transport', `invalid URL: ${url}`);
            return;
        }

        const reqHeaders = msg.get_request_headers();
        let hasUserAgent = false;
        for (const [name, value] of Object.entries(headers)) {
            reqHeaders.replace(name, String(value));
            if (name.toLowerCase() === 'user-agent')
                hasUserAgent = true;
        }
        if (!hasUserAgent)
            reqHeaders.replace('User-Agent', DEFAULT_USER_AGENT);

        if (bodyBytes !== null)
            msg.set_request_body_from_bytes(null, GLib.Bytes.new(bodyBytes));

        if (callerCancellable) {
            if (callerCancellable.is_cancelled()) {
                internalCancellable.cancel();
            } else {
                linkHandlerId = callerCancellable.connect(() => {
                    internalCancellable.cancel();
                });
            }
        }

        if (timeoutMs > 0) {
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                timedOut = true;
                _activeTimeouts.delete(timeoutId);
                timeoutId = 0;
                internalCancellable.cancel();
                return GLib.SOURCE_REMOVE;
            });
            _activeTimeouts.add(timeoutId);
        }

        session.send_and_read_async(
            msg,
            GLib.PRIORITY_DEFAULT,
            internalCancellable,
            (s, result) => {
                let bytes;
                try {
                    bytes = s.send_and_read_finish(result);
                } catch (e) {
                    if (timedOut) {
                        fail('timeout', `request timed out after ${timeoutMs}ms`);
                        return;
                    }
                    if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        fail('cancelled', 'request cancelled');
                        return;
                    }
                    fail('transport', e?.message ?? String(e));
                    return;
                }
                const status = msg.get_status();
                const respHeaders = headersToObject(msg.get_response_headers());
                settle({
                    status,
                    headers: respHeaders,
                    bodyBytes: bytesToU8(bytes),
                    error: null,
                });
            }
        );
    });
}

export default request;

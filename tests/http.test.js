import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {request, getSession, disposeSession, _debug} from '../lib/http.js';
import {startServer} from './_http-server.js';
import {describe, it, assertEqual, summary} from './_assert.js';

function runSync(promiseOrThunk) {
    const loop = GLib.MainLoop.new(null, false);
    let value, err, done = false;
    Promise.resolve()
        .then(() => typeof promiseOrThunk === 'function' ? promiseOrThunk() : promiseOrThunk)
        .then(v => { value = v; done = true; loop.quit(); },
            e => { err = e; done = true; loop.quit(); });
    if (!done)
        loop.run();
    if (err)
        throw err;
    return value;
}

function decode(u8) {
    return new TextDecoder().decode(u8);
}

function withServer(handler, fn) {
    return () => {
        const {url, stop} = runSync(startServer(handler));
        try {
            fn(url);
        } finally {
            stop();
        }
    };
}

describe('http.request', () => {
    it('GET 200 round-trip', withServer(
        () => ({status: 200, headers: {'content-type': 'application/json'}, body: '{"ok":true}'}),
        (url) => {
            const res = runSync(request({url, timeoutMs: 1000}));
            assertEqual(res.status, 200);
            assertEqual(decode(res.bodyBytes), '{"ok":true}');
            assertEqual(res.error, null);
            const ct = res.headers['content-type'] ?? '';
            if (!ct.includes('application/json'))
                throw new Error(`expected content-type to include application/json, got ${ct}`);
        }
    ));

    it('POST with JSON body + Authorization header', () => {
        let captured = null;
        const {url, stop} = runSync(startServer((req) => {
            captured = req;
            return {status: 200, body: 'ok'};
        }));
        try {
            const res = runSync(request({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer abc',
                    'User-Agent': 'test-agent/9.9',
                },
                body: '{"hello":"world"}',
                timeoutMs: 1000,
            }));
            assertEqual(res.status, 200);
            assertEqual(captured.method, 'POST');
            assertEqual(decode(captured.bodyBytes), '{"hello":"world"}');
            assertEqual(captured.headers['authorization'], 'Bearer abc');
            assertEqual(captured.headers['user-agent'], 'test-agent/9.9');
            assertEqual(captured.headers['content-type'], 'application/json');
        } finally {
            stop();
        }
    });

    it('HTTP 4xx is not an error', withServer(
        () => ({status: 404, body: 'gone'}),
        (url) => {
            const res = runSync(request({url, timeoutMs: 1000}));
            assertEqual(res.status, 404);
            assertEqual(decode(res.bodyBytes), 'gone');
            assertEqual(res.error, null);
        }
    ));

    it('HTTP 5xx is not an error', withServer(
        () => ({status: 500, body: 'boom'}),
        (url) => {
            const res = runSync(request({url, timeoutMs: 1000}));
            assertEqual(res.status, 500);
            assertEqual(decode(res.bodyBytes), 'boom');
            assertEqual(res.error, null);
        }
    ));

    it('Timeout resolves with kind=timeout', withServer(
        () => ({status: 200, body: 'late', delayMs: 2000}),
        (url) => {
            const t0 = GLib.get_monotonic_time();
            const res = runSync(request({url, timeoutMs: 50}));
            const elapsedMs = (GLib.get_monotonic_time() - t0) / 1000;
            assertEqual(res.error?.kind, 'timeout');
            if (elapsedMs > 1000)
                throw new Error(`timeout took ${elapsedMs}ms, expected <1000ms`);
        }
    ));

    it('Cancellation by caller', withServer(
        () => ({status: 200, body: 'late', delayMs: 2000}),
        (url) => {
            const cancellable = new Gio.Cancellable();
            const p = request({url, timeoutMs: 5000, cancellable});
            cancellable.cancel();
            const res = runSync(p);
            assertEqual(res.error?.kind, 'cancelled');
        }
    ));

    it('Transport failure on closed port', () => {
        const res = runSync(request({url: 'http://127.0.0.1:1', timeoutMs: 2000}));
        assertEqual(res.error?.kind, 'transport');
        if (!res.error.message || res.error.message.length === 0)
            throw new Error('expected non-empty transport error message');
    });

    it('Session reuse: two requests share one session', withServer(
        () => ({status: 200, body: 'ok'}),
        (url) => {
            runSync(request({url, timeoutMs: 1000}));
            const s1 = getSession();
            runSync(request({url, timeoutMs: 1000}));
            const s2 = getSession();
            if (s1 !== s2)
                throw new Error('expected identical session across requests');
        }
    ));

    it('Session disposal: subsequent request constructs a new session', withServer(
        () => ({status: 200, body: 'ok'}),
        (url) => {
            runSync(request({url, timeoutMs: 1000}));
            const s1 = getSession();
            disposeSession();
            runSync(request({url, timeoutMs: 1000}));
            const s2 = getSession();
            if (s1 === s2)
                throw new Error('expected a fresh session after disposeSession');
        }
    ));

    it('Timeout source cleanup on success (no leaked GLib.Sources)', withServer(
        () => ({status: 200, body: 'ok'}),
        (url) => {
            const before = _debug().activeTimeouts;
            for (let i = 0; i < 50; i++) {
                const res = runSync(request({url, timeoutMs: 5000}));
                assertEqual(res.status, 200);
            }
            const after = _debug().activeTimeouts;
            assertEqual(after, before, 'no leftover timeout sources');
            assertEqual(_debug().pendingCancellables, 0, 'no leftover cancellables');
        }
    ));
});

system.exit(summary());

import GLib from 'gi://GLib';
import system from 'system';

import {refresh, TOKEN_URL, CLIENT_ID, BETA_HEADER, USER_AGENT} from '../../../lib/oauth/anthropic.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';

function runSync(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value, err, done = false;
    Promise.resolve(promise).then(
        v => { value = v; done = true; loop.quit(); },
        e => { err = e; done = true; loop.quit(); }
    );
    if (!done)
        loop.run();
    if (err)
        throw err;
    return value;
}

function utf8(s) {
    return new TextEncoder().encode(s);
}

function stub(result) {
    const calls = [];
    const fn = (opts) => {
        calls.push(opts);
        return Promise.resolve(typeof result === 'function' ? result(opts) : result);
    };
    fn.calls = calls;
    return fn;
}

describe('refresh', () => {
    it('success with rotated refresh token', () => {
        const http = stub({
            status: 200,
            headers: {},
            bodyBytes: utf8('{"access_token":"new-at","refresh_token":"new-rt","expires_in":3600}'),
            error: null,
        });
        const res = runSync(refresh(http, 'old-rt'));
        assertDeepEqual(res, {ok: true, accessToken: 'new-at', refreshToken: 'new-rt', expiresIn: 3600});

        assertEqual(http.calls.length, 1);
        const call = http.calls[0];
        assertEqual(call.method, 'POST');
        assertEqual(call.url, TOKEN_URL);
        assertEqual(call.headers['Content-Type'], 'application/json');
        assertEqual(call.headers['anthropic-beta'], BETA_HEADER);
        assertEqual(call.headers['User-Agent'], USER_AGENT);
        const body = JSON.parse(call.body);
        assertDeepEqual(body, {
            grant_type: 'refresh_token',
            client_id: CLIENT_ID,
            refresh_token: 'old-rt',
        });
    });

    it('success without refresh token → refreshToken: null', () => {
        const http = stub({
            status: 200, headers: {}, error: null,
            bodyBytes: utf8('{"access_token":"x","expires_in":3600}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertEqual(res.ok, true);
        assertEqual(res.refreshToken, null);
        assertEqual(res.expiresIn, 3600);
    });

    it('float expires_in truncates', () => {
        const http = stub({
            status: 200, headers: {}, error: null,
            bodyBytes: utf8('{"access_token":"x","expires_in":3600.9}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertEqual(res.ok, true);
        assertEqual(res.expiresIn, 3600);
    });

    it('HTTP 400 with OAuth-style error → human body', () => {
        const http = stub({
            status: 400, headers: {}, error: null,
            bodyBytes: utf8('{"error":"invalid_grant","error_description":"Refresh token expired"}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertDeepEqual(res, {ok: false, kind: 'http', status: 400, body: 'Refresh token expired'});
    });

    it('HTTP 400 with unrecognized body → Refresh failed', () => {
        const http = stub({
            status: 400, headers: {}, error: null,
            bodyBytes: utf8('{"unknown":"shape"}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertDeepEqual(res, {ok: false, kind: 'http', status: 400, body: 'Refresh failed'});
    });

    it('HTTP 503 with unrecognized body → Invalid refresh response', () => {
        const http = stub({
            status: 503, headers: {}, error: null,
            bodyBytes: utf8('{"unknown":"shape"}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertDeepEqual(res, {ok: false, kind: 'http', status: 503, body: 'Invalid refresh response'});
    });

    it('transport failure surfaces as kind=transport', () => {
        const http = stub({
            status: 0, headers: {}, bodyBytes: new Uint8Array(0),
            error: {kind: 'transport', message: 'connection refused'},
        });
        const res = runSync(refresh(http, 'rt'));
        assertDeepEqual(res, {ok: false, kind: 'transport', message: 'connection refused'});
    });

    it('timeout collapses into transport', () => {
        const http = stub({
            status: 0, headers: {}, bodyBytes: new Uint8Array(0),
            error: {kind: 'timeout', message: 'request timed out after 25000ms'},
        });
        const res = runSync(refresh(http, 'rt'));
        assertEqual(res.ok, false);
        assertEqual(res.kind, 'transport');
        assertEqual(res.message, 'request timed out after 25000ms');
    });

    it('schema drift: 200 without access_token', () => {
        const http = stub({
            status: 200, headers: {}, error: null,
            bodyBytes: utf8('{"foo":"bar"}'),
        });
        const res = runSync(refresh(http, 'rt'));
        assertEqual(res.ok, false);
        assertEqual(res.kind, 'schema');
        if (!String(res.message).includes('access_token'))
            throw new Error(`message should mention access_token: ${res.message}`);
    });

    it('endpoint override is forwarded to http stub', () => {
        const custom = 'http://127.0.0.1:9999/v1/oauth/token';
        const http = stub({
            status: 200, headers: {}, error: null,
            bodyBytes: utf8('{"access_token":"x","expires_in":1}'),
        });
        runSync(refresh(http, 'rt', {endpoint: custom}));
        assertEqual(http.calls[0].url, custom);
    });
});

system.exit(summary());

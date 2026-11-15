import system from 'system';

import {
    postTokenRefresh, needsRefresh, decodeExpiresIn, parseErrorBody, REFRESH_BUFFER_SECS,
} from '../../../lib/oauth/refresh.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';
import {runSync, httpStub, res, resTransport} from '../../_harness.js';

const OPTS = {endpoint: 'https://auth.example/token', headers: {'Content-Type': 'application/json'}, body: '{"a":1}', label: 'token response'};
const post = (http, opts = {}) => runSync(postTokenRefresh(http, {...OPTS, ...opts}));

describe('needsRefresh', () => {
    it('true inside the buffer, false at or past it', () => {
        assertEqual(REFRESH_BUFFER_SECS, 300);
        assertEqual(needsRefresh(1000 + 299, 1000), true);
        assertEqual(needsRefresh(1000 + 300, 1000), false);
        assertEqual(needsRefresh(999, 1000), true);
    });
});

describe('decodeExpiresIn', () => {
    it('truncates a finite number, null otherwise', () => {
        assertDeepEqual([3600, 3600.9, '3600', null, NaN, Infinity].map(decodeExpiresIn), [3600, 3600, null, null, null, null]);
    });
});

describe('parseErrorBody', () => {
    it('reads error_description, error.message or error', () => {
        assertEqual(parseErrorBody('{"error_description":"expired"}'), 'expired');
        assertEqual(parseErrorBody('{"error":{"message":"bad"}}'), 'bad');
        assertEqual(parseErrorBody('{"error":"invalid_grant"}'), 'invalid_grant');
    });
    it('null for anything else', () => {
        assertDeepEqual(['nope', 'null', '{}', '[]'].map(parseErrorBody), [null, null, null, null]);
    });
});

describe('postTokenRefresh', () => {
    it('POSTs the body with the headers, timeout and cancellable', () => {
        const http = httpStub(res(200, '{"access_token":"at"}'));
        const c = {};
        post(http, {cancellable: c, timeoutMs: 5});
        assertDeepEqual(http.calls[0], {
            method: 'POST', url: OPTS.endpoint, headers: OPTS.headers, body: OPTS.body, timeoutMs: 5, cancellable: c,
        });
    });
    it('defaults the timeout to 25 s', () => {
        const http = httpStub(res(200, '{"access_token":"at"}'));
        post(http);
        assertEqual(http.calls[0].timeoutMs, 25_000);
    });
    it('a 2xx with an access token answers the payload', () => {
        const r = post(httpStub(res(200, '{"access_token":"at","expires_in":60}')));
        assertDeepEqual(r, {ok: true, accessToken: 'at', payload: {access_token: 'at', expires_in: 60}});
    });
    it('a rejected request is a transport failure', () => {
        const http = () => Promise.reject(new Error('socket'));
        assertDeepEqual(post(http), {ok: false, kind: 'transport', message: 'socket'});
    });
    it('a transport error is a transport failure', () => {
        assertDeepEqual(post(httpStub(resTransport('refused'))), {ok: false, kind: 'transport', message: 'refused'});
    });
    it('a non-2xx keeps the parsed error, or the fallback', () => {
        assertDeepEqual(post(httpStub(res(400, '{"error":"invalid_grant"}'))), {ok: false, kind: 'http', status: 400, body: 'invalid_grant'});
        assertDeepEqual(post(httpStub(res(400, '<html>'))), {ok: false, kind: 'http', status: 400, body: 'Refresh failed'});
        const r = post(httpStub(res(502, '')), {httpFallback: status => (status < 500 ? 'a' : 'b')});
        assertEqual(r.body, 'b');
    });
    it('schema failures name the label', () => {
        assertDeepEqual(post(httpStub(res(200, 'x'))).kind, 'schema');
        assertEqual(post(httpStub(res(200, 'x'))).message.startsWith('token response: '), true);
        assertEqual(post(httpStub(res(200, 'null'))).message, 'token response: not a JSON object');
        assertEqual(post(httpStub(res(200, '{"access_token":5}'))).message, 'token response: missing access_token');
    });
});

system.exit(summary());

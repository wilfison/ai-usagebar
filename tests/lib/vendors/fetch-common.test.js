import system from 'system';

import {withMutex, staleResult, MAX_STALE_MS, RETRY_AFTER_MS, underBackoff, backoffResult, redactHttpError, recordHttpError,
    redactingCache, redactResult, redactedFetch, runFetch, errorResult, loading, CACHE_TTL_MS, HTTP_TIMEOUT_MS, settleRefresh, authorizeOAuth, vendorFetch, httpGet, optionalRequest,
} from '../../../lib/vendors/fetch-common.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';
import {runSync, res, resTransport} from '../../_harness.js';
import {bodyText} from '../../../lib/http-util.js';

function fakeCache({payload = null, lastError = null, ageMs = null, retryAfter = null} = {}) {
    return {
        maybePayload: () => payload,
        readLastError: () => lastError,
        payloadAgeMs: () => ageMs,
        readRetryAfter: () => retryAfter,
    };
}

const NO_CACHE = {ok: false, kind: 'loading'};

describe('staleResult', () => {
    it('returns the noCache fallback when nothing is cached', () => {
        const out = runSync(staleResult(fakeCache({payload: null}), () => ({}), NO_CACHE));
        assertEqual(out, NO_CACHE);
    });

    it('returns the noCache fallback when the payload will not parse', () => {
        const out = runSync(staleResult(fakeCache({payload: 'bad'}), () => { throw new Error('nope'); }, NO_CACHE));
        assertEqual(out, NO_CACHE);
    });

    it('builds a stale ok-result from a parseable payload', () => {
        const cache = fakeCache({payload: 'x', lastError: {code: 429}, ageMs: 1234});
        const out = runSync(staleResult(cache, () => ({pct: 7}), NO_CACHE));
        assertDeepEqual(out, {
            ok: true,
            snapshot: {pct: 7},
            stale: true,
            lastError: {code: 429},
            cacheAgeMs: 1234,
        });
    });

    it('coerces a null cache age to 0', () => {
        const out = runSync(staleResult(fakeCache({payload: 'x', ageMs: null}), () => ({}), NO_CACHE));
        assertEqual(out.cacheAgeMs, 0);
    });

    it('passes the raw payload bytes through to the parser', () => {
        let seen = null;
        runSync(staleResult(fakeCache({payload: 'PAYLOAD'}), (b) => { seen = b; return {}; }, NO_CACHE));
        assertEqual(seen, 'PAYLOAD');
    });
});

describe('staleResult: ceiling and original error', () => {
    const ORIGINAL = {ok: false, kind: 'error', status: 401, message: 'usage request failed (HTTP 401)'};
    const DAY = 86400 * 1000;

    it('MAX_STALE_MS is seven days', () => assertEqual(MAX_STALE_MS, 7 * DAY));

    it('an 8-day-old payload is not served; the original error is returned', () => {
        const out = runSync(staleResult(fakeCache({payload: 'x', ageMs: 8 * DAY}), () => ({}), ORIGINAL));
        assertEqual(out, ORIGINAL);
    });

    it('a payload exactly at the ceiling is still served', () => {
        const out = runSync(staleResult(fakeCache({payload: 'x', ageMs: MAX_STALE_MS}), () => ({v: 1}), ORIGINAL));
        assertEqual(out.ok, true);
        assertEqual(out.stale, true);
    });

    it('a corrupt stale payload returns the original error, not a synthesized one', () => {
        const out = runSync(staleResult(fakeCache({payload: '{', ageMs: 1000}), () => { throw new Error('bad'); }, ORIGINAL));
        assertEqual(out, ORIGINAL);
        assertEqual(out.status, 401);
    });

    it('no payload propagates the original error verbatim', () =>
        assertEqual(runSync(staleResult(fakeCache({payload: null}), () => ({}), ORIGINAL)), ORIGINAL));
});

describe('429 backoff', () => {
    const NOW = new Date(1_800_000_000_000);

    it('RETRY_AFTER_MS is five minutes', () => assertEqual(RETRY_AFTER_MS, 5 * 60 * 1000));

    it('underBackoff reports a future marker and ignores a past or absent one', () => {
        assertEqual(runSync(underBackoff(fakeCache({retryAfter: NOW.getTime() + 1000}), NOW)), NOW.getTime() + 1000);
        assertEqual(runSync(underBackoff(fakeCache({retryAfter: NOW.getTime() - 1}), NOW)), null);
        assertEqual(runSync(underBackoff(fakeCache({retryAfter: NOW.getTime()}), NOW)), null);
        assertEqual(runSync(underBackoff(fakeCache(), NOW)), null);
    });

    it('serves a usable payload stale, flagged rate-limited', () => {
        const until = NOW.getTime() + 240_000;
        const out = runSync(backoffResult(fakeCache({payload: 'x', ageMs: 1000}), () => ({v: 1}), until, NOW));
        assertEqual(out.ok, true);
        assertEqual(out.stale, true);
        assertEqual(out.lastError.code, 'rate-limited');
        assertEqual(out.lastError.retryInMs, 240_000);
    });

    it('with no usable payload returns a rate-limited error', () => {
        const until = NOW.getTime() + 60_000;
        for (const cache of [
            fakeCache(),
            fakeCache({payload: 'x', ageMs: MAX_STALE_MS + 1}),
            fakeCache({payload: '{', ageMs: 1000}),
        ]) {
            const out = runSync(backoffResult(cache, (b) => {
                if (b === '{')
                    throw new Error('bad');
                return {};
            }, until, NOW));
            assertEqual(out.ok, false);
            assertEqual(out.kind, 'error');
            assertEqual(out.code, 'rate-limited');
            assertEqual(out.retryInMs, 60_000);
        }
    });
});

describe('redactHttpError / recordHttpError', () => {
    const TOKEN_BODY = JSON.stringify({error: 'invalid_token', access_token: 'sk-ant-secret-123'});

    it('a 401/403 keeps only the status', () => {
        for (const status of [401, 403]) {
            const e = redactHttpError(status, TOKEN_BODY);
            assertEqual(e.code, 'auth-rejected');
            assertEqual(e.status, status);
            assertEqual(JSON.stringify(e).includes('sk-ant-secret-123'), false);
        }
    });

    it('any other status keeps a sanitized, capped body', () => {
        const e = redactHttpError(500, `boom‮${'x'.repeat(5000)}`);
        assertEqual(e.code, 'http');
        assertEqual(e.body.startsWith('boom'), true);
        assertEqual(e.body.includes('‮'), false);
        assertEqual(Array.from(e.body).length, 4096);
    });

    it('records the redacted pair and returns the matching result', () => {
        const written = [];
        const cache = {writeLastError: (code, msg) => written.push([code, msg])};
        const r = recordHttpError(cache, 401, TOKEN_BODY, 'usage request failed (HTTP 401)');
        assertDeepEqual(written, [[401, '']]);
        assertEqual(r.code, 'auth-rejected');
        assertEqual(JSON.stringify(r).includes('sk-ant-secret-123'), false);

        const r500 = recordHttpError(cache, 500, 'down', 'usage request failed (HTTP 500)');
        assertDeepEqual(written[1], [500, 'down']);
        assertEqual(r500.message, 'usage request failed (HTTP 500)');
        assertEqual(r500.status, 500);
    });
});

describe('withMutex', () => {
    it('serializes calls sharing a key (no interleaving)', () => {
        const order = [];
        const make = (tag) => async () => {
            order.push(`${tag}:start`);
            await Promise.resolve();
            order.push(`${tag}:end`);
            return tag;
        };
        const a = withMutex('k', make('a'));
        const b = withMutex('k', make('b'));
        assertDeepEqual(runSync(Promise.all([a, b])), ['a', 'b']);
        assertDeepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
    });

    it('returns the wrapped function result', () => {
        assertEqual(runSync(withMutex('ret', () => 42)), 42);
    });

    it('keeps the chain alive after a rejection (next call still runs)', () => {
        const recovered = runSync(
            withMutex('err', () => Promise.reject(new Error('boom'))).then(
                () => 'unexpected',
                () => withMutex('err', () => 'recovered')
            )
        );
        assertEqual(recovered, 'recovered');
    });
});


describe('redaction of the request secret', () => {
    const KEY = 'sk-abcdefgh12345678';

    it('redactingCache scrubs every .last_error write and delegates the rest', () => {
        const writes = [];
        const cache = {dir: '/c', writeLastError: (status, body) => writes.push([status, body]), readLastError: () => 'x'};
        const wrapped = redactingCache(cache, [KEY]);
        wrapped.writeLastError(0, `zai: API reported failure: bad key ${KEY}`);
        assertDeepEqual(writes, [[0, 'zai: API reported failure: bad key [key]']]);
        assertEqual(wrapped.dir, '/c');
        assertEqual(wrapped.readLastError(), 'x');
    });

    it('redactResult scrubs the message and the stale lastError body', () => {
        assertEqual(redactResult({ok: false, kind: 'error', message: `no ${KEY}`}, [KEY]).message, 'no [key]');
        const stale = redactResult({ok: true, stale: true, lastError: {code: 0, body: KEY}}, [KEY]);
        assertEqual(stale.lastError.body, '[key]');
        assertEqual(redactResult({ok: false, kind: 'loading'}, [KEY]).kind, 'loading');
    });

    it('redactedFetch hands the wrapped cache in and redacts what comes out', () => {
        const writes = [];
        const cache = {writeLastError: (s, b) => writes.push(b)};
        const r = runSync(redactedFetch([KEY, null], {cache}, async (deps) => {
            deps.cache.writeLastError(0, `echo ${KEY}`);
            return {ok: false, kind: 'error', message: `echo ${KEY}`};
        }));
        assertEqual(r.message, 'echo [key]');
        assertDeepEqual(writes, ['echo [key]']);
    });

    it('several secrets are all removed', () => {
        const r = runSync(redactedFetch(['inference-key-123', 'management-key-456'], {cache: {}},
            async () => ({ok: false, kind: 'error', message: 'inference-key-123 / management-key-456'})));
        assertEqual(r.message, '[key] / [key]');
    });

    it('with no secret the fetch runs untouched', () => {
        const cache = {};
        const r = runSync(redactedFetch([null, ''], {cache}, async (deps) => ({same: deps.cache === cache})));
        assertEqual(r.same, true);
    });
});

// A cache that keeps everything in memory and logs every write.
function memCache({fresh = null, payload = null, ageMs = 0, lastError = null, retryAfter = null} = {}) {
    const log = [];
    return {
        log,
        freshPayload: ttl => {
            log.push(['fresh?', ttl]);
            return fresh;
        },
        maybePayload: () => payload,
        payloadAgeMs: () => ageMs,
        readLastError: () => lastError,
        readRetryAfter: () => retryAfter,
        markStale: () => log.push(['markStale']),
        writeLastError: (code, msg) => log.push(['lastError', code, msg]),
        writePayload: bytes => log.push(['payload', bytes]),
    };
}

const NOW = new Date(1_800_000_000_000);
const parseCached = text => ({from: 'cache', text: String(text)});
const parseBody = r => ({from: 'net', body: bodyText(r)});
const writes = cache => cache.log.filter(e => e[0] !== 'fresh?');

function run(cache, opts = {}) {
    return runSync(runFetch({
        cache,
        now: NOW,
        parseCached,
        request: () => Promise.resolve(res(200, 'live')),
        parse: parseBody,
        toCache: snap => `cached:${snap.body}`,
        httpErrorMessage: status => `request failed (HTTP ${status})`,
        ...opts,
    }));
}

describe('helpers', () => {
    it('loading is a fresh, writable result each time', () => {
        const a = loading();
        assertDeepEqual(a, {ok: false, kind: 'loading'});
        assertEqual(a === loading(), false);
        assertEqual(Object.isFrozen(a), false);
    });
    it('errorResult carries the message of an Error or a string', () => {
        assertDeepEqual(errorResult(new Error('no key')), {ok: false, kind: 'error', message: 'no key'});
        assertDeepEqual(errorResult('plain'), {ok: false, kind: 'error', message: 'plain'});
    });
    it('the shared TTL and timeout', () => {
        assertEqual(CACHE_TTL_MS, 60_000);
        assertEqual(HTTP_TIMEOUT_MS, 10_000);
    });
});

describe('runFetch: cache fast path', () => {
    it('a fresh payload is served without a request', () => {
        let asked = 0;
        const cache = memCache({fresh: 'F', ageMs: 1234});
        const r = run(cache, {request: () => {
            asked++;
            return Promise.resolve(res(200, 'live'));
        }});
        assertEqual(asked, 0);
        assertDeepEqual(r, {ok: true, snapshot: {from: 'cache', text: 'F'}, stale: false, lastError: null, cacheAgeMs: 1234});
        assertDeepEqual(cache.log[0], ['fresh?', CACHE_TTL_MS]);
    });
    it('uses the given TTL', () => {
        const cache = memCache();
        run(cache, {cacheTtlMs: 5});
        assertDeepEqual(cache.log[0], ['fresh?', 5]);
    });
    it('a corrupt fresh payload falls through to the network', () => {
        const r = run(memCache({fresh: 'F'}), {parseCached: () => {
            throw new Error('corrupt');
        }});
        assertEqual(r.snapshot.from, 'net');
    });
});

describe('runFetch: backoff', () => {
    it('under a backoff no request is made and the cache is served stale', () => {
        let asked = 0;
        const cache = memCache({payload: 'P', ageMs: 10, retryAfter: NOW.getTime() + 60_000});
        const r = run(cache, {request: () => {
            asked++;
            return Promise.resolve(res(200));
        }});
        assertEqual(asked, 0);
        assertEqual(r.stale, true);
        assertDeepEqual(r.lastError, {code: 'rate-limited', retryInMs: 60_000});
    });
    it('authorize is skipped under a backoff too', () => {
        let authorized = 0;
        run(memCache({retryAfter: NOW.getTime() + 1}), {authorize: () => {
            authorized++;
            return Promise.resolve(null);
        }});
        assertEqual(authorized, 0);
    });
});

describe('runFetch: authorize', () => {
    it('a null answer goes on to the request', () => {
        const r = run(memCache(), {authorize: () => Promise.resolve(null)});
        assertEqual(r.snapshot.from, 'net');
    });
    it('a result stops before the request and falls back to the cache', () => {
        let asked = 0;
        const r = run(memCache({payload: 'P', lastError: {code: 401}}), {
            authorize: () => Promise.resolve({ok: false, kind: 'error', message: 'log in'}),
            request: () => {
                asked++;
                return Promise.resolve(res(200));
            },
        });
        assertEqual(asked, 0);
        assertDeepEqual(r, {ok: true, snapshot: {from: 'cache', text: 'P'}, stale: true, lastError: {code: 401}, cacheAgeMs: 0});
    });
    it('without a cache the authorize result itself is returned', () => {
        const blocked = {ok: false, kind: 'loading'};
        assertEqual(run(memCache(), {authorize: () => Promise.resolve(blocked)}), blocked);
    });
});

describe('runFetch: transport failure', () => {
    it('is a silent loading fallback that records nothing', () => {
        const cache = memCache();
        const r = run(cache, {request: () => Promise.resolve(resTransport())});
        assertDeepEqual(r, {ok: false, kind: 'loading'});
        assertEqual(Object.isFrozen(r), false, 'a result the caller may annotate');
        assertDeepEqual(writes(cache), []);
    });
    it('any failed response of a list counts', () => {
        const r = run(memCache(), {request: () => Promise.resolve([res(200), resTransport()])});
        assertEqual(r.kind, 'loading');
    });
});

describe('runFetch: success', () => {
    it('parses, caches the projection and answers fresh', () => {
        const cache = memCache();
        const r = run(cache);
        assertDeepEqual(r, {ok: true, snapshot: {from: 'net', body: 'live'}, stale: false, lastError: null, cacheAgeMs: 0});
        assertDeepEqual(writes(cache), [['payload', 'cached:live']]);
    });
    it('hands parse whatever request returned', () => {
        const r = run(memCache(), {
            request: () => Promise.resolve([res(200, 'a'), res(204, 'b')]),
            parse: list => ({body: list.map(bodyText).join('+')}),
        });
        assertEqual(r.snapshot.body, 'a+b');
    });
    it('enrich runs after parse and before caching', () => {
        const cache = memCache();
        const r = run(cache, {enrich: snap => Promise.resolve({...snap, body: `${snap.body}!`})});
        assertEqual(r.snapshot.body, 'live!');
        assertDeepEqual(writes(cache), [['payload', 'cached:live!']]);
    });
    it('a parse failure is recorded, marks stale and falls back', () => {
        const cache = memCache({payload: 'P'});
        const r = run(cache, {parse: () => {
            throw new Error('drift');
        }});
        assertDeepEqual(writes(cache), [['markStale'], ['lastError', 0, 'drift']]);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.text, 'P');
    });
    it('a parse failure with no cache is the error', () => {
        const r = run(memCache(), {parse: () => {
            throw new Error('drift');
        }, errorExtras: {plan: 'Max'}});
        assertDeepEqual(r, {ok: false, kind: 'error', message: 'drift', plan: 'Max'});
    });
});

describe('runFetch: HTTP error', () => {
    it('marks stale, records the body and names the status', () => {
        const cache = memCache();
        const r = run(cache, {request: () => Promise.resolve(res(503, 'busy'))});
        assertDeepEqual(writes(cache), [['markStale'], ['lastError', 503, 'busy']]);
        assertDeepEqual(r, {ok: false, kind: 'error', status: 503, message: 'request failed (HTTP 503)'});
    });
    it('a 401 keeps only the status', () => {
        const cache = memCache();
        const r = run(cache, {request: () => Promise.resolve(res(401, 'key sk-123 is bad'))});
        assertDeepEqual(writes(cache), [['markStale'], ['lastError', 401, '']]);
        assertEqual(r.code, 'auth-rejected');
    });
    it('the first failing response of a list is reported', () => {
        const r = run(memCache(), {request: () => Promise.resolve([res(200), res(404, 'a'), res(500, 'b')])});
        assertEqual(r.status, 404);
    });
    it('httpErrorBody replaces what is recorded', () => {
        const cache = memCache();
        run(cache, {request: () => Promise.resolve(res(500, 'raw')), httpErrorBody: () => 'generic'});
        assertDeepEqual(writes(cache)[1], ['lastError', 500, 'generic']);
    });
    it('errorExtras ride on the error', () => {
        const r = run(memCache(), {request: () => Promise.resolve(res(500)), errorExtras: {plan: 'Pro'}});
        assertEqual(r.plan, 'Pro');
    });
    it('a cached payload is served stale instead', () => {
        const r = run(memCache({payload: 'P'}), {request: () => Promise.resolve(res(500))});
        assertEqual(r.stale, true);
    });
});

describe('settleRefresh', () => {
    const settle = (rr, cache, apply = () => Promise.resolve({rotated: false, saved: {ok: true}})) =>
        runSync(settleRefresh(rr, cache, {loginCommand: 'claude', apply}));

    it('a saved refresh is no failure', () => {
        const cache = memCache();
        let applied = null;
        const r = settle({ok: true, accessToken: 'n'}, cache, rr => {
            applied = rr;
            return Promise.resolve({rotated: true, saved: {ok: true}});
        });
        assertEqual(r, null);
        assertEqual(applied.accessToken, 'n');
        assertDeepEqual(writes(cache), []);
    });
    it('an unsaved access token alone is best-effort', () => {
        assertEqual(settle({ok: true}, memCache(), () => Promise.resolve({rotated: false, saved: {ok: false, message: 'ro'}})), null);
    });
    it('an unsaved rotated refresh token fails and says so', () => {
        const cache = memCache();
        const r = settle({ok: true}, cache, () => Promise.resolve({rotated: true, saved: {ok: false, message: 'EACCES'}}));
        assertDeepEqual(writes(cache), [['lastError', 0,
            'refreshed token could not be saved (EACCES); the rotated refresh token is lost; re-run `claude`']]);
        assertDeepEqual(r, {ok: false, kind: 'error', message: 'token refresh failed; run `claude` to re-authenticate'});
    });
    it('an HTTP refusal records its status', () => {
        const cache = memCache();
        const r = settle({ok: false, kind: 'http', status: 400, body: 'invalid_grant'}, cache);
        assertDeepEqual(writes(cache), [['lastError', 400, 'invalid_grant']]);
        assertDeepEqual(r, {ok: false, kind: 'error', message: 'token refresh failed; run `claude` to re-authenticate', status: 400});
    });
    it('a 401 refusal keeps no body', () => {
        const cache = memCache();
        settle({ok: false, kind: 'http', status: 401, body: 'secret'}, cache);
        assertDeepEqual(writes(cache), [['lastError', 401, '']]);
    });
    it('a transport failure is silent loading', () => {
        const cache = memCache();
        const r = settle({ok: false, kind: 'transport', message: 'x'}, cache);
        assertDeepEqual(r, {ok: false, kind: 'loading'});
        assertEqual(Object.isFrozen(r), false);
        assertDeepEqual(writes(cache), []);
    });
    it('a schema failure records its message', () => {
        const cache = memCache();
        const r = settle({ok: false, kind: 'schema', message: 'missing access_token'}, cache);
        assertDeepEqual(writes(cache), [['lastError', 0, 'missing access_token']]);
        assertEqual(r.kind, 'error');
        assertEqual('status' in r, false);
    });
});

describe('authorizeOAuth', () => {
    const NOW = 1_000_000;
    const run = ({accessToken = 'AT', refreshToken = 'RT', expiresAtSecs = NOW + 3600, rr = {ok: true, accessToken: 'NEW'}} = {}) => {
        const tokens = {accessToken, refreshToken};
        const calls = [];
        const r = runSync(authorizeOAuth({
            tokens,
            expiresAtSecs,
            nowSecs: NOW,
            cache: memCache(),
            loginCommand: 'claude',
            extras: {plan: 'Pro'},
            refresh: token => {
                calls.push(token);
                return Promise.resolve(rr);
            },
            apply: got => {
                tokens.accessToken = got.accessToken;
                return Promise.resolve({rotated: false, saved: {ok: true}});
            },
        }));
        return {r, calls, tokens};
    };

    it('a valid token needs nothing', () => {
        const {r, calls} = run();
        assertEqual(r, null);
        assertEqual(calls.length, 0);
    });
    it('an expiring token is refreshed and applied', () => {
        const {r, calls, tokens} = run({expiresAtSecs: NOW});
        assertEqual(r, null);
        assertDeepEqual(calls, ['RT']);
        assertEqual(tokens.accessToken, 'NEW');
    });
    it('an empty refresh token is never sent', () => {
        const {r, calls} = run({expiresAtSecs: NOW, refreshToken: '  '});
        assertEqual(r, null);
        assertEqual(calls.length, 0);
    });
    it('a blank access token asks to log in, with the extras', () => {
        const {r} = run({accessToken: ' '});
        assertEqual(r.kind, 'error');
        assertEqual(r.message, 'no access token; run `claude` to log in');
        assertEqual(r.plan, 'Pro');
    });
    it('a failed refresh stops the fetch with the extras', () => {
        const {r} = run({expiresAtSecs: NOW, rr: {ok: false, kind: 'other', message: 'nope'}});
        assertEqual(r.kind, 'error');
        assertEqual(r.plan, 'Pro');
    });
    it('a transport failure is loading, without extras', () => {
        const {r} = run({expiresAtSecs: NOW, rr: {ok: false, kind: 'transport'}});
        assertEqual(r.kind, 'loading');
        assertEqual(r.plan, undefined);
    });
});

describe('vendorFetch', () => {
    const KEY = 'sk-abcdefgh12345678';

    it('serializes on the cache dir and redacts the named secrets', () => {
        const order = [];
        const doFetch = async deps => {
            order.push('start');
            await Promise.resolve();
            order.push('end');
            deps.cache.writeLastError(500, `echo ${deps.apiKey}`);
            return {ok: false, kind: 'error', message: `bad ${deps.apiKey}`};
        };
        const fetch = vendorFetch('zz', deps => [deps.apiKey], doFetch);
        const cache = memCache();
        const [a] = runSync(Promise.all([fetch({cache, apiKey: KEY}), fetch({cache, apiKey: KEY})]));
        assertDeepEqual(order, ['start', 'end', 'start', 'end']);
        assertEqual(a.message.includes(KEY), false);
        assertEqual(cache.log.some(([, , msg]) => String(msg).includes(KEY)), false);
    });
});

describe('httpGet', () => {
    it('sends a GET with the shared timeout and the fetch signal', () => {
        const calls = [];
        const deps = {http: req => calls.push(req), signal: 'S'};
        httpGet(deps, 'https://x', {A: '1'});
        assertDeepEqual(calls, [{method: 'GET', url: 'https://x', headers: {A: '1'}, timeoutMs: HTTP_TIMEOUT_MS, cancellable: 'S'}]);
    });
    it('no signal is undefined, not null', () => {
        const calls = [];
        httpGet({http: req => calls.push(req), signal: null}, 'u', {});
        assertEqual(calls[0].cancellable, undefined);
    });
});

describe('optionalRequest', () => {
    const ok = {status: 200, bodyBytes: 'b'};
    const parse = res => `parsed ${res.bodyBytes}`;

    it('parses a successful response', () =>
        assertEqual(runSync(optionalRequest(Promise.resolve(ok), parse, 'fb')), 'parsed b'));
    it('a transport error is the fallback', () =>
        assertEqual(runSync(optionalRequest(Promise.resolve({error: 'x'}), parse, 'fb')), 'fb'));
    it('an HTTP error is the fallback', () =>
        assertEqual(runSync(optionalRequest(Promise.resolve({status: 500}), parse, 'fb')), 'fb'));
    it('a parse error is the fallback', () =>
        assertEqual(runSync(optionalRequest(Promise.resolve(ok), () => { throw new Error('no'); }, 'fb')), 'fb'));
    it('a rejected request is the fallback', () =>
        assertEqual(runSync(optionalRequest(Promise.reject(new Error('x')), parse, 'fb')), 'fb'));
});

system.exit(summary());

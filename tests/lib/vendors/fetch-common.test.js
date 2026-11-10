import GLib from 'gi://GLib';
import system from 'system';

import {withMutex, staleResult, MAX_STALE_MS, RETRY_AFTER_MS, underBackoff, backoffResult, redactHttpError, recordHttpError,
    redactingCache, redactResult, redactedFetch} from '../../../lib/vendors/fetch-common.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';

// The `it` harness is synchronous, so resolve promises against a main loop.
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

system.exit(summary());

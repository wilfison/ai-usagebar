import GLib from 'gi://GLib';
import system from 'system';

import {withMutex, staleResult} from '../../../lib/vendors/fetch-common.js';
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

function fakeCache({payload = null, lastError = null, ageMs = null} = {}) {
    return {
        maybePayload: () => payload,
        readLastError: () => lastError,
        payloadAgeMs: () => ageMs,
    };
}

const NO_CACHE = {ok: false, kind: 'loading'};

describe('staleResult', () => {
    it('returns the noCache fallback when nothing is cached', () => {
        const out = staleResult(fakeCache({payload: null}), () => ({}), NO_CACHE);
        assertEqual(out, NO_CACHE);
    });

    it('returns the noCache fallback when the payload will not parse', () => {
        const out = staleResult(fakeCache({payload: 'bad'}), () => { throw new Error('nope'); }, NO_CACHE);
        assertEqual(out, NO_CACHE);
    });

    it('builds a stale ok-result from a parseable payload', () => {
        const cache = fakeCache({payload: 'x', lastError: {code: 429}, ageMs: 1234});
        const out = staleResult(cache, () => ({pct: 7}), NO_CACHE);
        assertDeepEqual(out, {
            ok: true,
            snapshot: {pct: 7},
            stale: true,
            lastError: {code: 429},
            cacheAgeMs: 1234,
        });
    });

    it('coerces a null cache age to 0', () => {
        const out = staleResult(fakeCache({payload: 'x', ageMs: null}), () => ({}), NO_CACHE);
        assertEqual(out.cacheAgeMs, 0);
    });

    it('passes the raw payload bytes through to the parser', () => {
        let seen = null;
        staleResult(fakeCache({payload: 'PAYLOAD'}), (b) => { seen = b; return {}; }, NO_CACHE);
        assertEqual(seen, 'PAYLOAD');
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

system.exit(summary());

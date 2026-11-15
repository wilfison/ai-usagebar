import system from 'system';

import {VendorPoller} from '../../lib/vendor-poller.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';
import {runSync} from '../_harness.js';

const NOW = 1_800_000_000_000;

// A run whose fetches settle when the test says so.
function deferredRun() {
    const pending = [];
    const run = id => new Promise(resolve => pending.push({id, resolve}));
    return {run, pending, settle: (res, i = 0) => pending.splice(i, 1)[0].resolve({res})};
}

function poller({run, polled = ['a']} = {}) {
    const events = [];
    const p = new VendorPoller({
        run,
        isPolled: id => polled.includes(id),
        onStart: id => events.push(['start', id]),
        onResult: (id, out, {all}) => events.push(['result', id, out.res.kind ?? 'ok', all]),
        now: () => NOW,
    });
    return {p, events};
}

const ok = (cacheAgeMs = 0) => ({ok: true, snapshot: {}, stale: false, cacheAgeMs});

describe('VendorPoller', () => {
    it('stores the result and the instant it was fetched', () => {
        const {p, events} = poller({run: () => Promise.resolve({res: ok(5000)})});
        runSync(p.refresh('a'));
        assertEqual(p.result('a').ok, true);
        assertEqual(p.fetchedAt('a').getTime(), NOW - 5000);
        assertDeepEqual(events, [['start', 'a'], ['result', 'a', 'ok', false]]);
    });

    it('a failed fetch keeps the last fetch instant', () => {
        let res = ok();
        const {p} = poller({run: () => Promise.resolve({res})});
        runSync(p.refresh('a'));
        res = {ok: false, kind: 'error', message: 'x'};
        runSync(p.refresh('a'));
        assertEqual(p.result('a').kind, 'error');
        assertEqual(p.fetchedAt('a').getTime(), NOW);
    });

    it('a throwing run becomes an error result', () => {
        const {p} = poller({run: () => Promise.reject(new Error('boom'))});
        runSync(p.refresh('a'));
        assertDeepEqual(p.result('a'), {ok: false, kind: 'error', message: 'boom'});
    });

    it('requests during a fetch coalesce into one rerun for a polled vendor', () => {
        const d = deferredRun();
        const {p, events} = poller({run: d.run});
        const first = p.refresh('a');
        p.refresh('a');
        p.refresh('a');
        d.settle(ok());
        runSync(Promise.resolve());
        assertEqual(d.pending.length, 1, 'one rerun');
        d.settle(ok());
        runSync(first);
        assertEqual(events.filter(e => e[0] === 'start').length, 2);
    });

    it('a coalesced rerun for a vendor no longer polled is dropped', () => {
        const d = deferredRun();
        const {p} = poller({run: d.run, polled: []});
        const first = p.refresh('b');
        p.refresh('b');
        d.settle(ok());
        runSync(first);
        assertEqual(d.pending.length, 0);
    });

    it('a coalesced "refresh all" reruns even when not polled, and says so', () => {
        const d = deferredRun();
        const {p, events} = poller({run: d.run, polled: []});
        const first = p.refresh('b');
        p.refresh('b', {all: true});
        d.settle(ok());
        runSync(Promise.resolve());
        d.settle(ok());
        runSync(first);
        assertDeepEqual(events.filter(e => e[0] === 'result'), [['result', 'b', 'ok', false], ['result', 'b', 'ok', true]]);
    });

    it('after destroy a late result is dropped', () => {
        const d = deferredRun();
        const {p, events} = poller({run: d.run});
        const first = p.refresh('a');
        p.destroy();
        d.settle(ok());
        runSync(first);
        assertEqual(p.result('a'), undefined);
        assertDeepEqual(events, [['start', 'a']]);
    });

    it('seed marks a vendor loading only when it has nothing yet', () => {
        const {p} = poller({run: () => Promise.resolve({res: ok()})});
        p.seed('a');
        assertEqual(p.result('a').kind, 'loading');
        runSync(p.refresh('a'));
        p.seed('a');
        assertEqual(p.result('a').ok, true);
        assertDeepEqual(p.entries().map(([id]) => id), ['a']);
    });
});

system.exit(summary());

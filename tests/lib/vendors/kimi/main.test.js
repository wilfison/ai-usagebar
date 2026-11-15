import system from 'system';

import {parseUsage, snapshotToCacheJson} from '../../../../lib/vendors/kimi/parser.js';
import {fetchSnapshot, USAGES_URL, ME_URL} from '../../../../lib/vendors/kimi/main.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, backdate, routeStub, withCacheHome} from '../../../_harness.js';

const LIVE = JSON.stringify({
    user: {membership: {level: 'LEVEL_PRO'}},
    usage: {limit: '100', used: '42', remaining: '58', resetTime: '2026-02-11T17:32:50Z'},
    limits: [
        {
            window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'},
            detail: {limit: '100', used: '15', remaining: '85'},
        },
    ],
});
const SEED = JSON.stringify({usage: {limit: '100', used: '10', remaining: '90'}});

const cached = (raw) => snapshotToCacheJson(parseUsage(raw));

const withTemp = fn => withCacheHome('kimi', fn);

describe('fetchSnapshot (kimi)', () => {
    it('live 200 parses the shape and sends Bearer + Accept headers', withTemp(({cache}) => {
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-test'}));
        assertEqual(http.calls[0].url, USAGES_URL);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer sk-test');
        assertEqual(http.calls[0].headers.Accept, 'application/json');
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.plan, 'Pro'); // /me stub returns the same body → no tier name
        assertEqual(r.snapshot.weekly.utilizationPct, 42);
        assertEqual(r.snapshot.window.utilizationPct, 15);
    }));

    it('/me runs alongside /usages and its tier name is the plan, kept through the cache', withTemp(({cache}) => {
        const http = routeStub({
            [USAGES_URL]: res(200, LIVE),
            [ME_URL]: res(200, JSON.stringify({email: 'x@example.com', user_level_name: 'Allegretto'})),
        });
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-test'}));
        assertEqual(http.calls.length, 2);
        const me = http.calls.find(c => c.url === ME_URL);
        assertEqual(me.headers.Authorization, 'Bearer sk-test');
        assertEqual(me.headers.Accept, 'application/json');
        assertEqual(r.snapshot.plan, 'Allegretto');

        const cached = runSync(fetchSnapshot({cache, http: routeStub({}), apiKey: 'sk-test'}));
        assertEqual(cached.ok, true);
        assertEqual(cached.snapshot.plan, 'Allegretto');
    }));

    it('a failing /me falls back to the humanized level and keeps ok', withTemp(({cache}) => {
        for (const me of [res(404, '{"error":"no coding profile"}'), new Error('boom'),
            {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport', message: 'down'}}]) {
            const http = routeStub({[USAGES_URL]: res(200, LIVE), [ME_URL]: me});
            const r = runSync(fetchSnapshot({cache, http, apiKey: 'k', cacheTtlMs: 0}));
            assertEqual(r.ok, true);
            assertEqual(r.snapshot.plan, 'Pro');
            assertEqual(r.snapshot.weekly.utilizationPct, 42);
        }
    }));

    it('HTTP 401 falls back to stale cache with lastError.code 401', withTemp(({cache}) => {
        runSync(cache.writePayload(cached(SEED)));
        backdate(cache, 120);
        const http = httpStub(res(401, '{"secret":"do-not-leak"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.weekly.utilizationPct, 10);
        assertEqual(r.lastError.code, 401);
        // The persisted diagnostic never echoes the upstream body.
        assertEqual(r.lastError.body, '');
    }));

    it('HTTP 401 with no cache → auth-rejected, body never echoed', withTemp(({cache}) => {
        const http = httpStub(res(401, '{"secret":"do-not-leak"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(r.code, 'auth-rejected');
        assertEqual(r.status, 401);
        assertEqual(JSON.stringify(r).includes('do-not-leak'), false);
    }));

    it('HTTP 500 with no cache → kind:error mentioning the status', withTemp(({cache}) => {
        const http = httpStub(res(500, 'upstream boom'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(r.message.includes('500'), true);
        assertEqual(r.message.includes('boom'), false); // body never echoed
    }));

    it('transient failure with no cache → kind:loading (never error)', withTemp(({cache}) => {
        const http = httpStub({status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: new Error('network down')});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'loading');
    }));

    it('schema drift (2xx unparseable) with no cache → error, body not cached', withTemp(({cache}) => {
        const http = httpStub(res(200, 'not json'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(runSync(cache.maybePayload()), null);
    }));
});

system.exit(summary());

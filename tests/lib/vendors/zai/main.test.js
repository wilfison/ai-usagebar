import system from 'system';

import {parseEnvelope, snapshotToCacheJson} from '../../../../lib/vendors/zai/parser.js';
import {fetchSnapshot, QUOTA_URL} from '../../../../lib/vendors/zai/main.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, backdate, withCacheHome} from '../../../_harness.js';

const LIVE = JSON.stringify({
    code: 200, msg: 'Operation successful',
    data: {
        limits: [
            {type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42},
            {type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 15, nextResetTime: 1779792169974},
        ],
        level: 'pro',
    },
    success: true,
});
const SEED = JSON.stringify({
    code: 200, data: {limits: [{type: 'TOKENS_LIMIT', unit: 3, percentage: 10}], level: 'lite'}, success: true,
});

const cached = (raw) => snapshotToCacheJson(parseEnvelope(raw, null));

const withTemp = fn => withCacheHome('zai', fn);

describe('fetchSnapshot (zai)', () => {
    it('live 200 parses the real shape', withTemp(({cache}) => {
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls[0].url, QUOTA_URL);
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.plan, 'GLM Coding Pro');
        assertEqual(r.snapshot.session.utilizationPct, 42);
        assertEqual(r.snapshot.weekly.utilizationPct, 15);
    }));

    it('sends Authorization as the bare key (no Bearer prefix)', withTemp(({cache}) => {
        const http = httpStub(res(200, LIVE));
        runSync(fetchSnapshot({cache, http, apiKey: 'sk-test'}));
        assertEqual(http.calls[0].headers.Authorization, 'sk-test');
    }));

    it('HTTP 401 falls back to stale cache with lastError.code 401', withTemp(({cache}) => {
        runSync(cache.writePayload(cached(SEED)));
        backdate(cache, 120);
        const http = httpStub(res(401, '{"code":401,"msg":"Unauthorized"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.session.utilizationPct, 10);
        assertEqual(r.lastError.code, 401);
    }));

    it('a 200 with success:false is not cached and falls back to the good cache', withTemp(({cache}) => {
        runSync(cache.writePayload(cached(SEED)));
        backdate(cache, 120);
        const http = httpStub(res(200, '{"code":1001,"msg":"Token expired","success":false,"data":null}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.session.utilizationPct, 10);
        assertEqual(new TextDecoder().decode(runSync(cache.maybePayload())), cached(SEED));
    }));

    it('a 200 with data:null and no cache → error, nothing cached', withTemp(({cache}) => {
        const http = httpStub(res(200, '{"code":200,"success":true,"data":null}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(runSync(cache.maybePayload()), null);
    }));

    it('an invalid envelope already in the cache is never served', withTemp(({cache}) => {
        runSync(cache.writePayload('{"code":500,"success":false}'));
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.session.utilizationPct, 42);
    }));

    it('transient failure with no cache → kind:loading (never error)', withTemp(({cache}) => {
        // Transport/timeout/cancel surfaces as res.error; with nothing cached the
        // panel must show Loading…, not the ⚠ error state.
        const http = httpStub({status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: new Error('network down')});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'loading');
    }));

    it('HTTP failure with no cache → kind:error with a message', withTemp(({cache}) => {
        const http = httpStub(res(500, '{"code":500,"msg":"boom"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(typeof r.message, 'string');
        assertEqual(r.message.includes('500'), true);
    }));
});


describe('fetchSnapshot (zai): a failure that quotes the key', () => {
    const KEY = 'sk-abcdefgh12345678';
    const ECHO = JSON.stringify({success: false, code: 1000, msg: `bad key ${KEY}`});

    it('neither the result nor .last_error carries the key', withTemp(({cache}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, ECHO)), apiKey: KEY}));
        assertEqual(r.ok, false);
        assertEqual(r.message.includes(KEY), false);
        assertEqual(r.message.includes('[key]'), true);
        const onDisk = runSync(cache.readLastError());
        assertEqual(onDisk.body.includes(KEY), false);
        assertEqual(onDisk.body.includes('1000'), true);
    }));

    it('a stale fallback shows the redacted error too', withTemp(({cache}) => {
        runSync(cache.writePayload(cached(SEED)));
        backdate(cache, 120);
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, ECHO)), apiKey: KEY}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(JSON.stringify(r).includes(KEY), false);
    }));
});

system.exit(summary());

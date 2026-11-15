import system from 'system';

import {fetchSnapshot, BALANCE_URL} from '../../../../lib/vendors/deepseek/main.js';
import {snapshotToCacheJson} from '../../../../lib/vendors/deepseek/parser.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, backdate, withCacheHome} from '../../../_harness.js';

const LIVE = JSON.stringify({
    is_available: true,
    balance_infos: [{currency: 'USD', total_balance: '5.00', granted_balance: '5.00', topped_up_balance: '0.00'}],
});
const SEED = snapshotToCacheJson({isAvailable: true, balance: 3.0, granted: 3.0, toppedUp: 0.0, currency: 'USD'});

const withTemp = fn => withCacheHome('deepseek', fn);

describe('fetchSnapshot (deepseek)', () => {
    it('live 200 returns the USD balance, non-stale', withTemp(({cache}) => {
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-test'}));
        assertEqual(http.calls[0].url, BALANCE_URL);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer sk-test');
        assertEqual(http.calls[0].headers.Accept, 'application/json');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.snapshot.isAvailable, true);
        assertEqual(r.snapshot.balance, 5);
        assertEqual(r.snapshot.currency, 'USD');
    }));

    it('an unsupported currency is an error, keeps the good cache and is not cached', withTemp(({cache}) => {
        runSync(cache.writePayload(SEED));
        backdate(cache, 120);
        const eur = JSON.stringify({is_available: true, balance_infos: [
            {currency: 'EUR', total_balance: '9.00', granted_balance: '9.00', topped_up_balance: '0.00'}]});
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, eur)), apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.balance, 3);
        assertEqual(new TextDecoder().decode(runSync(cache.maybePayload())), SEED);
    }));

    it('a corrupt fresh cache triggers a live fetch', withTemp(({cache}) => {
        runSync(cache.writePayload('{"is_available":true}'));
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.balance, 5);
    }));

    it('a cache older than 7 days is not served: the real error surfaces', withTemp(({cache}) => {
        runSync(cache.writePayload(SEED));
        backdate(cache, 8 * 86400);
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(401, '{"error":"invalid api key"}')), apiKey: 'bad'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(r.status, 401);
    }));

    it('HTTP 401 falls back to seeded cache with lastError.code 401', withTemp(({cache}) => {
        runSync(cache.writePayload(SEED));
        backdate(cache, 120);
        const http = httpStub(res(401, '{"error":"invalid api key"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'bad'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.balance, 3);
        assertEqual(r.lastError.code, 401);
    }));
});

system.exit(summary());

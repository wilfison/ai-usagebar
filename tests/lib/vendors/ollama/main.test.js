import system from 'system';

import {parseUsage, snapshotToCacheJson} from '../../../../lib/vendors/ollama/parser.js';
import {fetchSnapshot, USAGE_URL} from '../../../../lib/vendors/ollama/main.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, backdate, withCacheHome} from '../../../_harness.js';

const LIVE = JSON.stringify({
    included: {
        session: {remaining_percent: 58, resets_at: '2026-10-08T19:00:00Z'},
        weekly: {remaining_percent: 90, resets_at: '2026-10-12T00:00:00Z'},
    },
    purchased: {balance_usd: 0},
});
const SEED = JSON.stringify({
    included: {
        session: {remaining_percent: 100, resets_at: '2026-10-08T19:00:00Z'},
        weekly: {remaining_percent: 90, resets_at: '2026-10-12T00:00:00Z'},
    },
});
// The request/token history `/api/usage` returns now.
const HISTORY = JSON.stringify({range: '7d', totals: {request_count: 213, usage_usd: 0.2}, buckets: []});
const cached = (raw) => snapshotToCacheJson(parseUsage(raw));

const withTemp = fn => withCacheHome('ollama', fn);

describe('fetchSnapshot (ollama)', () => {
    it('live 200 sends Bearer + Accept and parses the body', withTemp(({cache}) => {
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k', plan: 'Pro'}));
        assertEqual(http.calls.length, 1);
        assertEqual(http.calls[0].url, USAGE_URL);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer k');
        assertEqual(http.calls[0].headers.Accept, 'application/json');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.snapshot.session.utilizationPct, 42);
        assertEqual(r.snapshot.plan, 'Pro');
    }));

    it('the cache holds only the projected snapshot', withTemp(({cache}) => {
        const body = JSON.stringify({...JSON.parse(LIVE), email: 'someone@example.com', account_id: 'acct-1'});
        runSync(fetchSnapshot({cache, http: httpStub(res(200, body)), apiKey: 'k'}));
        const onDisk = new TextDecoder().decode(runSync(cache.maybePayload()));
        assertEqual(onDisk.includes('someone@example.com'), false);
        assertEqual(onDisk.includes('acct-1'), false);
    }));

    it('a fresh cache skips the network and shows the current plan pref', withTemp(({cache}) => {
        cache.writePayload(cached(SEED));
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k', plan: 'Max'}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.snapshot.weekly.utilizationPct, 10);
        assertEqual(r.snapshot.plan, 'Max');
    }));

    it('HTTP 401 with no cache → auth-rejected, body never echoed', withTemp(({cache}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(401, '{"secret":"do-not-leak"}')), apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.code, 'auth-rejected');
        assertEqual(r.status, 401);
        assertEqual(JSON.stringify(r).includes('do-not-leak'), false);
        assertEqual(runSync(cache.readLastError()).body, '');
    }));

    it('HTTP 401 with a cache → stale, lastError 401 with no body', withTemp(({cache}) => {
        cache.writePayload(cached(SEED));
        backdate(cache, 120);
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(401, 'do-not-leak')), apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError.code, 401);
        assertEqual(r.lastError.body, '');
    }));

    it('after a 429 the next poll makes no request', withTemp(({cache}) => {
        cache.writePayload(cached(SEED));
        backdate(cache, 120);
        const first = runSync(fetchSnapshot({cache, http: httpStub(res(429, 'slow down')), apiKey: 'k'}));
        assertEqual(first.stale, true);
        assertEqual(first.lastError.code, 429);
        const http = httpStub(res(200, LIVE));
        const second = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls.length, 0);
        assertEqual(second.ok, true);
        assertEqual(second.stale, true);
    }));

    it('a 429 with no cache → rate-limited error, then no request', withTemp(({cache}) => {
        runSync(fetchSnapshot({cache, http: httpStub(res(429, '')), apiKey: 'k'}));
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.code, 'rate-limited');
    }));

    it('transient failure with no cache → loading', withTemp(({cache}) => {
        const http = httpStub({status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport', message: 'refused'}});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'loading');
    }));

    it('the balance route is the one requested', () =>
        assertEqual(USAGE_URL, 'https://ollama.com/api/balance'));

    it('a usage-history body is never cached as an empty quota', withTemp(({cache}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, HISTORY)), apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(runSync(cache.maybePayload()), null);
    }));

    it('a cache from the old /api/usage format is refetched, not served', withTemp(({cache}) => {
        cache.writePayload(JSON.stringify({cacheVersion: 1, snapshot: {plan: null, session: {utilizationPct: 5, resetsAt: null}}}));
        const http = httpStub(res(200, LIVE));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.snapshot.session.utilizationPct, 42);
        assertEqual(r.snapshot.session.resetsAt instanceof Date, true);
    }));

    it('schema drift with no cache → error, nothing cached', withTemp(({cache}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, '{"limits":[]}')), apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(runSync(cache.maybePayload()), null);
    }));
});

system.exit(summary());

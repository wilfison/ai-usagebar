import system from 'system';

import {fetchSnapshot} from '../../../../lib/vendors/openrouter/main.js';
import {balance, snapshotToCacheJson} from '../../../../lib/vendors/openrouter/parser.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, backdate, routeStub, withCacheHome} from '../../../_harness.js';

const CREDITS = '{"data":{"total_credits":100.0,"total_usage":25.5}}';
const KEY = '{"data":{"label":"prod","limit":50.0,"limit_remaining":24.5,"usage":25.5,"usage_daily":1.0,"usage_weekly":7.0,"usage_monthly":25.5,"is_free_tier":false}}';
const SEED = snapshotToCacheJson({
    label: 'OpenRouter - seed', totalCredits: 50, totalUsage: 10,
    usageDaily: 1, usageWeekly: 3, usageMonthly: 10, isFreeTier: false, limit: null, limitRemaining: null, recentModels: [],
});

const withTemp = fn => withCacheHome('openrouter', fn);

describe('fetchSnapshot (openrouter)', () => {
    it('combines both endpoints into a non-stale snapshot', withTemp(({cache}) => {
        const http = httpStub([res(200, CREDITS), res(200, KEY)]);
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-or-test'}));
        assertEqual(http.calls.length, 2);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer sk-or-test');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.snapshot.label, 'OpenRouter - prod');
        assertEqual(r.snapshot.totalCredits, 100);
        assertEqual(balance(r.snapshot), 74.5);
    }));

    it('401 on /credits falls back to seeded cache with lastError.code 401', withTemp(({cache}) => {
        runSync(cache.writePayload(SEED));
        backdate(cache, 120);
        const http = httpStub([res(401, '{"error":"unauthorized"}'), res(200, KEY)]);
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.label, 'OpenRouter - seed');
        assertEqual(r.lastError.code, 401);
    }));
});

// Answers by path, so the activity call's position among the parallel requests does not matter.
const byPath = routes => routeStub(routes, {key: opts => opts.url.replace(/^.*\/api\/v1/u, ''), fallback: res(404, '')});

const ACTIVITY = JSON.stringify({data: [
    {date: '2026-10-01', model: 'anthropic/claude-sonnet-4.5', usage: 0.5, requests: 7},
    {date: '2026-10-02', model: 'openai/gpt-5-codex', usage: 1.25, requests: 42},
]});

describe('fetchSnapshot (openrouter): recent models', () => {
    it('the management key, and only it, goes to /activity', withTemp(({cache}) => {
        const http = byPath({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': res(200, ACTIVITY)});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-or-test', managementKey: 'sk-or-mgmt'}));
        const activity = http.calls.filter(c => c.url.endsWith('/activity'));
        assertEqual(activity.length, 1);
        assertEqual(activity[0].headers.Authorization, 'Bearer sk-or-mgmt');
        for (const c of http.calls.filter(x => !x.url.endsWith('/activity')))
            assertEqual(c.headers.Authorization, 'Bearer sk-or-test');
        assertEqual(r.snapshot.recentModels.map(m => m.name).join(','), 'gpt-5-codex,claude-sonnet-4.5');
    }));

    it('without a management key /activity is never requested', withTemp(({cache}) => {
        const http = byPath({'/credits': res(200, CREDITS), '/key': res(200, KEY)});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-or-test'}));
        assertEqual(http.calls.some(c => c.url.endsWith('/activity')), false);
        assertEqual(r.snapshot.recentModels.length, 0);
    }));

    it('a failing activity call is an empty list, the fetch stays fresh', withTemp(({cache}) => {
        for (const bad of [res(401, 'nope'), res(200, 'not json'), {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport'}}]) {
            const http = byPath({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': bad});
            const r = runSync(fetchSnapshot({cache, http, apiKey: 'k', managementKey: 'm', cacheTtlMs: 0}));
            assertEqual(r.ok, true);
            assertEqual(r.stale, false);
            assertEqual(r.lastError, null);
            assertEqual(r.snapshot.recentModels.length, 0);
        }
    }));

    it('the recent models survive the cache', withTemp(({cache}) => {
        const http = byPath({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': res(200, ACTIVITY)});
        runSync(fetchSnapshot({cache, http, apiKey: 'k', managementKey: 'm'}));
        const again = runSync(fetchSnapshot({cache, http: byPath({}), apiKey: 'k', managementKey: 'm'}));
        assertEqual(again.snapshot.recentModels[0].requests, 42);
    }));
});

system.exit(summary());

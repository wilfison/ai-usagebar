import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache} from '../../../../lib/cache.js';
import {fetchSnapshot} from '../../../../lib/vendors/openrouter/main.js';
import {balance} from '../../../../lib/vendors/openrouter/parser.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';

const CREDITS = '{"data":{"total_credits":100.0,"total_usage":25.5}}';
const KEY = '{"data":{"label":"prod","limit":50.0,"limit_remaining":24.5,"usage":25.5,"usage_daily":1.0,"usage_weekly":7.0,"usage_monthly":25.5,"is_free_tier":false}}';
const SEED = JSON.stringify({snapshot: {
    label: 'OpenRouter - seed', total_credits: 50, total_usage: 10,
    usage_daily: 1, usage_weekly: 3, usage_monthly: 10, is_free_tier: false, limit: null, limit_remaining: null,
}});

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

function httpStub(responses) {
    const seq = Array.isArray(responses) ? responses : [responses];
    const calls = [];
    let i = 0;
    const fn = (opts) => {
        calls.push(opts);
        const r = seq[Math.min(i, seq.length - 1)];
        i++;
        return Promise.resolve(r);
    };
    fn.calls = calls;
    return fn;
}
function res(status, text) {
    return {status, headers: {}, bodyBytes: new TextEncoder().encode(text ?? ''), error: null};
}

function rmRf(path) {
    const f = Gio.File.new_for_path(path);
    if (!f.query_exists(null))
        return;
    let info;
    try {
        info = f.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (_) { return; }
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const en = f.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let child;
        while ((child = en.next_file(null)))
            rmRf(GLib.build_filenamev([path, child.get_name()]));
        en.close(null);
    }
    try { f.delete(null); } catch (_) { /* best-effort */ }
}

function withTemp(fn) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-or-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            fn({cache: Cache.forVendor('openrouter'), dir});
        } finally {
            if (prev !== null && prev !== undefined)
                GLib.setenv('XDG_CACHE_HOME', prev, true);
            else
                GLib.unsetenv('XDG_CACHE_HOME');
            rmRf(dir);
        }
    };
}

function backdate(cache, secs) {
    const f = Gio.File.new_for_path(cache.payloadPath);
    f.set_attribute_uint64('time::modified', Math.floor(Date.now() / 1000) - secs, Gio.FileQueryInfoFlags.NONE, null);
    f.set_attribute_uint32('time::modified-usec', 0, Gio.FileQueryInfoFlags.NONE, null);
}

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
        cache.writePayload(SEED);
        backdate(cache, 120);
        const http = httpStub([res(401, '{"error":"unauthorized"}'), res(200, KEY)]);
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.label, 'OpenRouter - seed');
        assertEqual(r.lastError.code, 401);
    }));
});


// Answers by URL, so the activity call's position among the parallel requests does not matter.
function routeStub(routes) {
    const calls = [];
    const fn = (opts) => {
        calls.push(opts);
        const path = opts.url.replace(/^.*\/api\/v1/u, '');
        return Promise.resolve(routes[path] ?? res(404, ''));
    };
    fn.calls = calls;
    return fn;
}

const ACTIVITY = JSON.stringify({data: [
    {date: '2026-10-01', model: 'anthropic/claude-sonnet-4.5', usage: 0.5, requests: 7},
    {date: '2026-10-02', model: 'openai/gpt-5-codex', usage: 1.25, requests: 42},
]});

describe('fetchSnapshot (openrouter): recent models', () => {
    it('the management key, and only it, goes to /activity', withTemp(({cache}) => {
        const http = routeStub({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': res(200, ACTIVITY)});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-or-test', managementKey: 'sk-or-mgmt'}));
        const activity = http.calls.filter(c => c.url.endsWith('/activity'));
        assertEqual(activity.length, 1);
        assertEqual(activity[0].headers.Authorization, 'Bearer sk-or-mgmt');
        for (const c of http.calls.filter(x => !x.url.endsWith('/activity')))
            assertEqual(c.headers.Authorization, 'Bearer sk-or-test');
        assertEqual(r.snapshot.recentModels.map(m => m.name).join(','), 'gpt-5-codex,claude-sonnet-4.5');
    }));

    it('without a management key /activity is never requested', withTemp(({cache}) => {
        const http = routeStub({'/credits': res(200, CREDITS), '/key': res(200, KEY)});
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'sk-or-test'}));
        assertEqual(http.calls.some(c => c.url.endsWith('/activity')), false);
        assertEqual(r.snapshot.recentModels.length, 0);
    }));

    it('a failing activity call is an empty list, the fetch stays fresh', withTemp(({cache}) => {
        for (const bad of [res(401, 'nope'), res(200, 'not json'), {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport'}}]) {
            const http = routeStub({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': bad});
            const r = runSync(fetchSnapshot({cache, http, apiKey: 'k', managementKey: 'm', cacheTtlMs: 0}));
            assertEqual(r.ok, true);
            assertEqual(r.stale, false);
            assertEqual(r.lastError, null);
            assertEqual(r.snapshot.recentModels.length, 0);
        }
    }));

    it('the recent models survive the cache', withTemp(({cache}) => {
        const http = routeStub({'/credits': res(200, CREDITS), '/key': res(200, KEY), '/activity': res(200, ACTIVITY)});
        runSync(fetchSnapshot({cache, http, apiKey: 'k', managementKey: 'm'}));
        const again = runSync(fetchSnapshot({cache, http: routeStub({}), apiKey: 'k', managementKey: 'm'}));
        assertEqual(again.snapshot.recentModels[0].requests, 42);
    }));
});

system.exit(summary());

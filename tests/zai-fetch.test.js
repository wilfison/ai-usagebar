import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache} from '../lib/cache.js';
import {fetchSnapshot, QUOTA_URL} from '../lib/vendors/zai.js';
import {describe, it, assertEqual, summary} from './_assert.js';

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
    code: 200, data: {limits: [{type: 'TOKENS_LIMIT', percentage: 10}], level: 'lite'}, success: true,
});

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

function httpStub(response) {
    const calls = [];
    const fn = (opts) => {
        calls.push(opts);
        return Promise.resolve(response);
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
        const dir = GLib.Dir.make_tmp('ai-usagebar-zai-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            fn({cache: Cache.forVendor('zai'), dir});
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
        cache.writePayload(SEED);
        backdate(cache, 120);
        const http = httpStub(res(401, '{"code":401,"msg":"Unauthorized"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.session.utilizationPct, 10);
        assertEqual(r.lastError.code, 401);
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
        const http = httpStub(res(401, '{"code":401,"msg":"Unauthorized"}'));
        const r = runSync(fetchSnapshot({cache, http, apiKey: 'k'}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(typeof r.message, 'string');
        assertEqual(r.message.includes('401'), true);
    }));
});

system.exit(summary());

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache} from '../../../../lib/cache.js';
import {fetchSnapshot, USAGE_URL, USER_AGENT} from '../../../../lib/vendors/openai/main.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';

const USAGE = JSON.stringify({
    plan_type: 'plus',
    rate_limit: {
        primary_window: {used_percent: 1, limit_window_seconds: 18000, reset_at: 1779597324},
        secondary_window: {used_percent: 0, limit_window_seconds: 604800, reset_at: 1780184124},
    },
});
const CACHED = JSON.stringify({
    plan_type: 'pro',
    rate_limit: {primary_window: {used_percent: 50, limit_window_seconds: 18000}},
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
function resTransport() {
    return {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport', message: 'refused'}};
}

function b64url(str) {
    const bytes = new TextEncoder().encode(str);
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
        out += A[b0 >> 2];
        out += A[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
        if (b1 === undefined) break;
        out += A[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
        if (b2 === undefined) break;
        out += A[b2 & 63];
    }
    return out;
}
function fakeJwt(claims) {
    return `${b64url(JSON.stringify({alg: 'none'}))}.${b64url(JSON.stringify(claims))}.sig`;
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
        const dir = GLib.Dir.make_tmp('ai-usagebar-oai-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            const credsPath = GLib.build_filenamev([dir, 'auth.json']);
            const jwt = fakeJwt({
                exp: Math.trunc(Date.now() / 1000) + 3600,
                'https://api.openai.com/auth': {chatgpt_plan_type: 'plus'},
            });
            const doc = {tokens: {access_token: 'AT', refresh_token: 'RT', id_token: jwt, account_id: 'acc'}};
            Gio.File.new_for_path(credsPath).replace_contents(
                new TextEncoder().encode(JSON.stringify(doc)), null, false, Gio.FileCreateFlags.NONE, null);
            fn({cache: Cache.forVendor('openai'), credsPath, dir});
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

describe('fetchSnapshot (openai)', () => {
    it('live 200 returns a snapshot with the Codex headers, non-stale', withTemp(({cache, credsPath}) => {
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(http.calls[0].url, USAGE_URL);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer AT');
        assertEqual(http.calls[0].headers['User-Agent'], USER_AGENT);
        assertEqual(http.calls[0].headers['ChatGPT-Account-Id'], 'acc');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.snapshot.plan, 'ChatGPT Plus');
        assertEqual(r.snapshot.session.utilizationPct, 1);
    }));

    it('fresh cache skips the network', withTemp(({cache, credsPath}) => {
        cache.writePayload(USAGE);
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
    }));

    it('HTTP 500 falls back to stale cache with lastError.code 500', withTemp(({cache, credsPath}) => {
        cache.writePayload(CACHED);
        backdate(cache, 120);
        const http = httpStub(res(500, '{"error":{"message":"upstream"}}'));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.session.utilizationPct, 50);
        assertEqual(r.lastError.code, 500);
    }));

    it('transient failure with cache → silent stale', withTemp(({cache, credsPath}) => {
        cache.writePayload(CACHED);
        backdate(cache, 120);
        const r = runSync(fetchSnapshot({cache, http: httpStub(resTransport()), credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError, null);
    }));

    it('missing credentials → error, no fetch', withTemp(({cache}) => {
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath: '/nonexistent/auth.json'}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
    }));
});

system.exit(summary());

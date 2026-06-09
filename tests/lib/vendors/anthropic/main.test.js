import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache} from '../../../../lib/cache.js';
import {fetchSnapshot, USAGE_URL, USAGE_BETA_HEADER} from '../../../../lib/vendors/anthropic/main.js';
import {readCreds, TOKEN_URL} from '../../../../lib/oauth/anthropic.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';

const USAGE = JSON.stringify({
    five_hour: {utilization: 42, resets_at: '2026-05-23T17:30:00Z'},
    seven_day: {utilization: 10},
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

function rmRf(path) {
    const f = Gio.File.new_for_path(path);
    if (!f.query_exists(null))
        return;
    let info;
    try {
        info = f.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (_) {
        return;
    }
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const en = f.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let child;
        while ((child = en.next_file(null)))
            rmRf(GLib.build_filenamev([path, child.get_name()]));
        en.close(null);
    }
    try { f.delete(null); } catch (_) { /* best-effort */ }
}

function withTemp(fn, {expiresAt = 9_999_999_999_000} = {}) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-fetch-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            const credsPath = GLib.build_filenamev([dir, 'creds.json']);
            const doc = {
                claudeAiOauth: {
                    accessToken: 'at',
                    refreshToken: 'rt',
                    expiresAt,
                    subscriptionType: 'pro',
                    rateLimitTier: 'tier_5x',
                },
            };
            Gio.File.new_for_path(credsPath).replace_contents(
                new TextEncoder().encode(JSON.stringify(doc)), null, false,
                Gio.FileCreateFlags.NONE, null
            );
            fn({cache: Cache.forVendor('anthropic'), credsPath, dir});
        } finally {
            if (prev !== null && prev !== undefined)
                GLib.setenv('XDG_CACHE_HOME', prev, true);
            else
                GLib.unsetenv('XDG_CACHE_HOME');
            rmRf(dir);
        }
    };
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
    return {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport', message: 'connection refused'}};
}

function backdate(cache, secs) {
    const f = Gio.File.new_for_path(cache.payloadPath);
    const past = Math.floor(Date.now() / 1000) - secs;
    f.set_attribute_uint64('time::modified', past, Gio.FileQueryInfoFlags.NONE, null);
    f.set_attribute_uint32('time::modified-usec', 0, Gio.FileQueryInfoFlags.NONE, null);
}

describe('fetchSnapshot', () => {
    it('fresh cache skips the network', withTemp(({cache, credsPath}) => {
        cache.writePayload(USAGE);
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0, 'no HTTP call when cache is fresh');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.snapshot.session.utilizationPct, 42);
    }));

    it('live fetch writes cache and returns a fresh snapshot', withTemp(({cache, credsPath}) => {
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(http.calls[0].url, USAGE_URL);
        assertEqual(http.calls[0].headers.Authorization, 'Bearer at');
        assertEqual(http.calls[0].headers['anthropic-beta'], USAGE_BETA_HEADER);
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.cacheAgeMs, 0);
        assertEqual(r.snapshot.session.utilizationPct, 42);
        assertEqual(cache.maybePayload() === null, false, 'payload was cached');
    }));

    it('refresh runs first when the token is near expiry', withTemp(({cache, credsPath}) => {
        const http = httpStub([
            res(200, '{"access_token":"new-at","expires_in":3600}'),
            res(200, USAGE),
        ]);
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 2);
        assertEqual(http.calls[0].url, TOKEN_URL);
        assertEqual(http.calls[1].url, USAGE_URL);
        assertEqual(http.calls[1].headers.Authorization, 'Bearer new-at');
        assertEqual(r.ok, true);
        // Rotated token was written back to disk.
        assertEqual(readCreds(credsPath).oauth.accessToken, 'new-at');
    }, {expiresAt: 0}));

    it('HTTP 429 falls back to stale cache with lastError.code 429', withTemp(({cache, credsPath}) => {
        cache.writePayload(USAGE);
        backdate(cache, 120); // older than the 60s TTL → not "fresh"
        const http = httpStub(res(429, 'slow down'));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError.code, 429);
    }));

    it('transient failure with cache → silent stale (no last_error)', withTemp(({cache, credsPath}) => {
        cache.writePayload(USAGE);
        backdate(cache, 120);
        const http = httpStub(resTransport());
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError, null, 'no .last_error written on the transient path');
    }));

    it('transient failure with no cache → loading', withTemp(({cache, credsPath}) => {
        const http = httpStub(resTransport());
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'loading');
    }));

    it('missing credentials → error, no fetch', withTemp(({cache}) => {
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath: '/nonexistent/creds.json'}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
    }));

    it('schema drift (2xx non-JSON) with no cache → error, body not cached', withTemp(({cache, credsPath}) => {
        const http = httpStub(res(200, 'not json at all'));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(cache.maybePayload(), null, 'unparseable 2xx body is never cached');
        assertEqual(cache.isStale(), true);
        assertEqual(cache.readLastError().code, 0);
    }));
});

system.exit(summary());

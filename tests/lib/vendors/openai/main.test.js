import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache} from '../../../../lib/cache.js';
import {parseUsage, snapshotToCacheJson, CACHE_VERSION} from '../../../../lib/vendors/openai/parser.js';
import {fetchSnapshot, resetCreditsUrl, USAGE_URL, USER_AGENT} from '../../../../lib/vendors/openai/main.js';
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

const cached = (raw) => snapshotToCacheJson(parseUsage(raw, null));

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

function readText(path) {
    const [, contents] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(contents);
}

function chmod(path, mode) {
    Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
}

function expiredCreds(dir, rel) {
    const path = GLib.build_filenamev([dir, rel]);
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const doc = {tokens: {access_token: 'AT', refresh_token: 'RT', id_token: fakeJwt({exp: 1}), account_id: 'acc'}};
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(JSON.stringify(doc)), null, false, Gio.FileCreateFlags.NONE, null);
    return path;
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

    it('the cache holds the projected snapshot: no email, user_id or account_id', withTemp(({cache, credsPath}) => {
        const body = JSON.stringify(Object.assign(JSON.parse(USAGE),
            {email: 'someone@example.com', user_id: 'user-123', account_id: 'acct-456'}));
        runSync(fetchSnapshot({cache, http: httpStub(res(200, body)), credsPath}));
        const onDisk = new TextDecoder().decode(runSync(cache.maybePayload()));
        for (const needle of ['email', 'someone@example.com', 'user_id', 'user-123', 'account_id', 'acct-456'])
            assertEqual(onDisk.includes(needle), false, needle);
        assertEqual(JSON.parse(onDisk).cacheVersion, CACHE_VERSION);
    }));

    it('a raw body cached by an older release is refetched, not served', withTemp(({cache, credsPath}) => {
        cache.writePayload(USAGE);
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
    }));

    it('fresh cache skips the network', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(USAGE));
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
    }));

    it('HTTP 500 falls back to stale cache with lastError.code 500', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(CACHED));
        backdate(cache, 120);
        const http = httpStub(res(500, '{"error":{"message":"upstream"}}'));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.snapshot.session.utilizationPct, 50);
        assertEqual(r.lastError.code, 500);
    }));

    it('transient failure with cache → silent stale', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(CACHED));
        backdate(cache, 120);
        const r = runSync(fetchSnapshot({cache, http: httpStub(resTransport()), credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError, null);
    }));

    it('a refresh without a new id_token persists expires_at so the next poll skips refresh', withTemp(({cache, dir}) => {
        const credsPath = expiredCreds(dir, 'auth.json');
        const token = res(200, JSON.stringify({access_token: 'AT2', expires_in: 3600}));
        const http = httpStub([token, res(200, USAGE)]);
        const r = runSync(fetchSnapshot({cache, http, credsPath, cacheTtlMs: 0}));
        assertEqual(r.ok, true);
        const saved = JSON.parse(readText(credsPath)).tokens;
        assertEqual(saved.access_token, 'AT2');
        assertEqual(typeof saved.expires_at, 'string');

        const http2 = httpStub(res(200, USAGE));
        runSync(fetchSnapshot({cache, http: http2, credsPath, cacheTtlMs: 0}));
        assertEqual(http2.calls.length, 1);
        assertEqual(http2.calls[0].url, USAGE_URL);
    }));

    it('an unsaved rotated refresh token is an auth error with stale fallback', withTemp(({cache, dir}) => {
        cache.writePayload(cached(CACHED));
        backdate(cache, 120);
        const credsPath = expiredCreds(dir, 'ro/auth.json');
        chmod(GLib.path_get_dirname(credsPath), 0o555);
        try {
            const token = res(200, JSON.stringify({access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600}));
            const http = httpStub([token, res(200, USAGE)]);
            const r = runSync(fetchSnapshot({cache, http, credsPath}));
            assertEqual(http.calls.length, 1);
            assertEqual(r.ok, true);
            assertEqual(r.stale, true);
            assertEqual(r.snapshot.session.utilizationPct, 50);
            assertEqual(r.lastError.body.startsWith('refreshed token could not be saved'), true);
        } finally {
            chmod(GLib.path_get_dirname(credsPath), 0o755);
        }
    }));

    it('an unsaved access token alone stays best-effort', withTemp(({cache, dir}) => {
        const credsPath = expiredCreds(dir, 'ro/auth.json');
        chmod(GLib.path_get_dirname(credsPath), 0o555);
        try {
            const token = res(200, JSON.stringify({access_token: 'AT2', expires_in: 3600}));
            const http = httpStub([token, res(200, USAGE)]);
            const r = runSync(fetchSnapshot({cache, http, credsPath}));
            assertEqual(http.calls.length, 2);
            assertEqual(http.calls[1].headers.Authorization, 'Bearer AT2');
            assertEqual(r.ok, true);
            assertEqual(r.stale, false);
        } finally {
            chmod(GLib.path_get_dirname(credsPath), 0o755);
        }
    }));

    it('missing credentials → error, no fetch', withTemp(({cache}) => {
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath: '/nonexistent/auth.json'}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
    }));
});

describe('fetchSnapshot (openai): reset credit details', () => {
    const withCount = n => JSON.stringify(Object.assign(JSON.parse(USAGE), {rate_limit_reset_credits: {available_count: n}}));
    const DETAIL = JSON.stringify({
        available_count: 5,
        credits: [
            {id: 'c1', status: 'available', title: 'Full reset', expires_at: '2026-07-17T00:00:00Z'},
            {id: 'c2', status: 'available', title: 'Full reset', expires_at: '2026-07-20T00:00:00Z'},
        ],
    });

    it('derives the detail URL from the usage URL', () => {
        assertEqual(resetCreditsUrl(USAGE_URL), 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
    });

    it('a count > 0 makes a second GET with the same headers and merges the credits', withTemp(({cache, credsPath}) => {
        const http = httpStub([res(200, withCount(2)), res(200, DETAIL)]);
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 2);
        assertEqual(http.calls[1].url, resetCreditsUrl(USAGE_URL));
        assertEqual(http.calls[1].headers.Authorization, 'Bearer AT');
        assertEqual(http.calls[1].headers['User-Agent'], USER_AGENT);
        assertEqual(http.calls[1].headers['ChatGPT-Account-Id'], 'acc');
        assertEqual(r.snapshot.resetCredits.available, 2);
        assertEqual(r.snapshot.resetCredits.credits.length, 2);
    }));

    it('the merged credits are cached without their ids', withTemp(({cache, credsPath}) => {
        runSync(fetchSnapshot({cache, http: httpStub([res(200, withCount(2)), res(200, DETAIL)]), credsPath}));
        const onDisk = new TextDecoder().decode(runSync(cache.maybePayload()));
        assertEqual(onDisk.includes('Full reset'), true);
        assertEqual(onDisk.includes('"c1"'), false);
    }));

    it('a failing second call is silent: count kept, no detail, no lastError', withTemp(({cache, credsPath}) => {
        const http = httpStub([res(200, withCount(2)), res(500, '{"detail":"account acct-456 broke"}')]);
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.lastError, null);
        assertEqual(r.snapshot.resetCredits.available, 2);
        assertEqual(r.snapshot.resetCredits.credits.length, 0);
        assertEqual(runSync(cache.readLastError()), null);
    }));

    it('a transport failure on the second call is silent too', withTemp(({cache, credsPath}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub([res(200, withCount(1)), resTransport()]), credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.resetCredits.credits.length, 0);
    }));

    it('an unparseable detail body is ignored', withTemp(({cache, credsPath}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub([res(200, withCount(1)), res(200, 'nope')]), credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.resetCredits.available, 1);
    }));

    it('a count of 0 makes no second call', withTemp(({cache, credsPath}) => {
        const http = httpStub(res(200, withCount(0)));
        runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
    }));
});


function retryArmed(cache) {
    return Gio.File.new_for_path(GLib.build_filenamev([cache.dir, '.retry_after'])).query_exists(null);
}

function signedOutCreds(dir, {accessToken, refreshToken, exp}) {
    const path = GLib.build_filenamev([dir, 'signed-out.json']);
    const doc = {tokens: {access_token: accessToken, refresh_token: refreshToken, id_token: fakeJwt({exp}), account_id: 'acc'}};
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(JSON.stringify(doc)), null, false, Gio.FileCreateFlags.NONE, null);
    return path;
}

describe('fetchSnapshot (openai): a signed-out credentials file', () => {
    const future = Math.trunc(Date.now() / 1000) + 3600;

    it('a blank access token makes no request and asks to log in', withTemp(({cache, dir}) => {
        const http = httpStub(res(429, 'slow down'));
        const credsPath = signedOutCreds(dir, {accessToken: '', refreshToken: 'RT', exp: future});
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.message, 'no access token; run `codex login` to log in');
        assertEqual(retryArmed(cache), false, 'no 429 backoff is armed');
    }));

    it('an expired token with an empty refresh token is never POSTed', withTemp(({cache, dir}) => {
        const http = httpStub(res(200, USAGE));
        const credsPath = signedOutCreds(dir, {accessToken: 'AT', refreshToken: '  ', exp: 1});
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(http.calls[0].url, USAGE_URL);
        assertEqual(r.ok, true);
    }));

    it('both tokens blank: no POST, no GET, the login hint', withTemp(({cache, dir}) => {
        const http = httpStub(res(200, USAGE));
        const credsPath = signedOutCreds(dir, {accessToken: '', refreshToken: '', exp: 1});
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.message, 'no access token; run `codex login` to log in');
        assertEqual(retryArmed(cache), false);
    }));
});

system.exit(summary());

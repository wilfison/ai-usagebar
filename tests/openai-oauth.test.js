import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {
    refresh, needsRefresh, readAuth, writeBack, expiresAtSecs, planType, TOKEN_URL,
} from '../lib/oauth/openai.js';
import {describe, it, assertEqual, assertThrows, summary} from './_assert.js';

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

function withTempDir(fn) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-codex-XXXXXX');
        try {
            fn({dir, path: GLib.build_filenamev([dir, 'auth.json'])});
        } finally {
            rmRf(dir);
        }
    };
}

function writeText(path, text) {
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.PRIVATE, null);
}
function readText(path) {
    const [, contents] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(contents);
}

describe('needsRefresh', () => {
    it('true inside the 300s buffer', () => assertEqual(needsRefresh(1_000_000 + 100, 1_000_000), true));
    it('false outside the buffer', () => assertEqual(needsRefresh(1_000_000 + 1000, 1_000_000), false));
});

describe('refresh', () => {
    it('parses access/refresh/id tokens and expires_in on success', () => {
        const http = httpStub(res(200,
            '{"access_token":"new-at","refresh_token":"new-rt","id_token":"new-id","expires_in":3600}'));
        const r = runSync(refresh(http, 'old', {endpoint: TOKEN_URL}));
        assertEqual(r.ok, true);
        assertEqual(r.accessToken, 'new-at');
        assertEqual(r.refreshToken, 'new-rt');
        assertEqual(r.idToken, 'new-id');
        assertEqual(r.expiresIn, 3600);
    });

    it('sends the Codex client_id + scope in the JSON body', () => {
        const http = httpStub(res(200, '{"access_token":"x"}'));
        runSync(refresh(http, 'old', {endpoint: TOKEN_URL}));
        const body = JSON.parse(http.calls[0].body);
        assertEqual(body.client_id, 'app_EMoamEEZ73f0CkXaXp7hrann');
        assertEqual(body.grant_type, 'refresh_token');
        assertEqual(body.scope, 'openid profile email');
    });

    it('400 surfaces kind:http with the parsed description', () => {
        const http = httpStub(res(400, '{"error":"invalid_grant","error_description":"Refresh expired"}'));
        const r = runSync(refresh(http, 'x', {endpoint: TOKEN_URL}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'http');
        assertEqual(r.status, 400);
        assertEqual(r.body, 'Refresh expired');
    });
});

describe('readAuth / expiresAtSecs / planType', () => {
    it('reads tokens and infers expiry + plan from the id_token', withTempDir(({path}) => {
        const jwt = fakeJwt({exp: 1234567890, 'https://api.openai.com/auth': {chatgpt_plan_type: 'plus'}});
        writeText(path, JSON.stringify({tokens: {
            access_token: 'AT', refresh_token: 'RT', id_token: jwt, account_id: 'acc',
        }}));
        const {tokens} = readAuth(path);
        assertEqual(tokens.accessToken, 'AT');
        assertEqual(tokens.accountId, 'acc');
        assertEqual(expiresAtSecs(tokens), 1234567890);
        assertEqual(planType(tokens), 'plus');
    }));

    it('malformed file throws with the codex-login hint', withTempDir(({path}) => {
        writeText(path, 'not json');
        assertThrows(() => readAuth(path));
    }));

    it('expiresAtSecs falls back to 0 for an unparseable id_token', withTempDir(({path}) => {
        writeText(path, JSON.stringify({tokens: {access_token: 'x', refresh_token: 'y', id_token: 'bad'}}));
        assertEqual(expiresAtSecs(readAuth(path).tokens), 0);
    }));
});

describe('writeBack', () => {
    it('preserves unknown top-level and token fields through a round-trip', withTempDir(({path}) => {
        const jwt = fakeJwt({exp: 1234567890});
        writeText(path, JSON.stringify({
            tokens: {access_token: 'AT', refresh_token: 'RT', id_token: jwt, last_refresh_marker: 'keep-tok'},
            some_other_field: 'keep-me',
        }));
        const auth = readAuth(path);
        auth.tokens.accessToken = 'NEW';
        const r = writeBack(path, auth);
        assertEqual(r.ok, true);

        const round = JSON.parse(readText(path));
        assertEqual(round.some_other_field, 'keep-me');
        assertEqual(round.tokens.access_token, 'NEW');
        assertEqual(round.tokens.last_refresh_marker, 'keep-tok');
    }));
});

system.exit(summary());

import GLib from 'gi://GLib';
import system from 'system';

import {parseUsage, snapshotToCacheJson} from '../../../../lib/vendors/anthropic/parser.js';
import {fetchSnapshot, USAGE_URL, USAGE_BETA_HEADER, USAGE_USER_AGENT} from '../../../../lib/vendors/anthropic/main.js';
import {readCreds, TOKEN_URL} from '../../../../lib/oauth/anthropic.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';
import {runSync, httpStub, res, resTransport, chmod, backdate, writeText, withCacheHome, retryArmed} from '../../../_harness.js';

const USAGE = JSON.stringify({
    five_hour: {utilization: 42, resets_at: '2026-05-23T17:30:00Z'},
    seven_day: {utilization: 10},
});

const cached = (raw) => snapshotToCacheJson(parseUsage(raw, 'Pro'));

function writeCreds(dir, rel, {expiresAt, subscriptionType = 'pro', rateLimitTier = ''}) {
    const doc = {claudeAiOauth: {accessToken: 'at', refreshToken: 'rt', expiresAt, subscriptionType, rateLimitTier}};
    return writeText(GLib.build_filenamev([dir, rel]), JSON.stringify(doc));
}

const withTemp = (fn, {expiresAt = 9_999_999_999_000} = {}) => withCacheHome('anthropic', fn, {
    setup: dir => ({credsPath: writeCreds(dir, 'creds.json', {expiresAt, rateLimitTier: 'tier_5x'})}),
});

describe('fetchSnapshot', () => {
    it('fresh cache skips the network', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(USAGE));
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
        assertEqual(http.calls[0].headers['User-Agent'], USAGE_USER_AGENT);
        assertEqual(http.calls[0].headers['Content-Type'], 'application/json');
        assertEqual(http.calls[0].url.endsWith('?cedar_ember=1'), true);
        assertEqual(USAGE_USER_AGENT.startsWith('claude-cli/'), true, 'the endpoint gates on the CLI surface');
        assertEqual(USAGE_USER_AGENT.endsWith(' (external, cli)'), true, 'the grants block needs the external cli surface');
        assertEqual(USAGE_USER_AGENT, 'claude-cli/2.1.319 (external, cli)');
        assertEqual(r.ok, true);
        assertEqual(r.stale, false);
        assertEqual(r.cacheAgeMs, 0);
        assertEqual(r.snapshot.session.utilizationPct, 42);
        assertEqual(runSync(cache.maybePayload()) === null, false, 'payload was cached');
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
        assertEqual(runSync(readCreds(credsPath)).oauth.accessToken, 'new-at');
    }, {expiresAt: 0}));

    it('usage failure with no cache carries the plan from the credentials', withTemp(({cache, credsPath}) => {
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(500, 'boom')), credsPath}));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(r.plan, 'Pro');
    }));

    it('an unknown plan is omitted from the error', withTemp(({cache, dir}) => {
        const credsPath = writeCreds(dir, 'bare.json', {expiresAt: 9_999_999_999_000, subscriptionType: ''});
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(500, 'boom')), credsPath}));
        assertEqual(r.kind, 'error');
        assertEqual('plan' in r, false);
    }));

    it('an unsaved rotated refresh token is an auth error with stale fallback', withTemp(({cache, dir}) => {
        cache.writePayload(cached(USAGE));
        backdate(cache, 120);
        const credsPath = writeCreds(dir, 'ro/creds.json', {expiresAt: 0});
        chmod(GLib.path_get_dirname(credsPath), 0o555);
        try {
            const http = httpStub([res(200, '{"access_token":"new-at","refresh_token":"new-rt","expires_in":3600}'), res(200, USAGE)]);
            const r = runSync(fetchSnapshot({cache, http, credsPath}));
            assertEqual(http.calls.length, 1);
            assertEqual(r.ok, true);
            assertEqual(r.stale, true);
            assertEqual(r.lastError.body.startsWith('refreshed token could not be saved'), true);
        } finally {
            chmod(GLib.path_get_dirname(credsPath), 0o755);
        }
    }));

    it('an unsaved access token alone stays best-effort', withTemp(({cache, dir}) => {
        const credsPath = writeCreds(dir, 'ro/creds.json', {expiresAt: 0});
        chmod(GLib.path_get_dirname(credsPath), 0o555);
        try {
            const http = httpStub([res(200, '{"access_token":"new-at","expires_in":3600}'), res(200, USAGE)]);
            const r = runSync(fetchSnapshot({cache, http, credsPath}));
            assertEqual(http.calls.length, 2);
            assertEqual(http.calls[1].headers.Authorization, 'Bearer new-at');
            assertEqual(r.ok, true);
            assertEqual(r.stale, false);
        } finally {
            chmod(GLib.path_get_dirname(credsPath), 0o755);
        }
    }));

    it('a cached snapshot takes its plan from the current credentials', withTemp(({cache, credsPath}) => {
        cache.writePayload(snapshotToCacheJson(parseUsage(USAGE, 'Old Plan')));
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, USAGE)), credsPath}));
        assertEqual(r.ok, true);
        assertEqual(r.snapshot.plan, 'Pro');
    }));

    it('HTTP 429 falls back to stale cache with lastError.code 429', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(USAGE));
        backdate(cache, 120); // older than the 60s TTL → not "fresh"
        const http = httpStub(res(429, 'slow down'));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 1);
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError.code, 429);
    }));

    it('after a 429 the next poll makes no request, token refresh included', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(USAGE));
        backdate(cache, 120);
        runSync(fetchSnapshot({cache, http: httpStub(res(429, 'slow down')), credsPath}));

        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
        assertEqual(r.lastError.code, 'rate-limited');
        assertEqual(r.lastError.retryInMs > 4 * 60 * 1000, true);
    }));

    it('under backoff with no cache → rate-limited error, no request', withTemp(({cache, credsPath}) => {
        cache.writeRetryAfter(Date.now() + 60_000);
        const http = httpStub(res(200, USAGE));
        const r = runSync(fetchSnapshot({cache, http, credsPath}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.code, 'rate-limited');
    }, {expiresAt: 0}));

    it('transient failure with cache → silent stale (no last_error)', withTemp(({cache, credsPath}) => {
        cache.writePayload(cached(USAGE));
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
        assertEqual(runSync(cache.maybePayload()), null, 'unparseable 2xx body is never cached');
        assertEqual(cache.isStale(), true);
        assertEqual(runSync(cache.readLastError()).code, 0);
    }));
});


function blankCreds(dir, {accessToken = '  ', refreshToken = 'rt', expiresAt = 9_999_999_999_000} = {}) {
    const doc = {claudeAiOauth: {accessToken, refreshToken, expiresAt, subscriptionType: 'pro', rateLimitTier: ''}};
    return writeText(GLib.build_filenamev([dir, 'blank.json']), JSON.stringify(doc));
}

describe('fetchSnapshot: a signed-out credentials file', () => {
    it('a blank access token makes no request and asks to log in', withTemp(({cache, dir}) => {
        const http = httpStub(res(429, 'slow down'));
        const r = runSync(fetchSnapshot({cache, http, credsPath: blankCreds(dir)}));
        assertEqual(http.calls.length, 0);
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'error');
        assertEqual(r.message, 'no access token; run `claude` to log in');
        assertEqual(retryArmed(cache), false, 'no 429 backoff is armed');
    }));

    it('a blank access token serves the cached snapshot as stale', withTemp(({cache, dir}) => {
        cache.writePayload(cached(USAGE));
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(200, USAGE)), credsPath: blankCreds(dir), cacheTtlMs: 0}));
        assertEqual(r.ok, true);
        assertEqual(r.stale, true);
    }));

    it('an expired blank token is refreshed first, then used', withTemp(({cache, dir}) => {
        const token = res(200, JSON.stringify({access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600}));
        const http = httpStub([token, res(200, USAGE)]);
        const r = runSync(fetchSnapshot({cache, http, credsPath: blankCreds(dir, {accessToken: '', expiresAt: 0})}));
        assertEqual(http.calls.length, 2);
        assertEqual(http.calls[1].headers.Authorization, 'Bearer new-at');
        assertEqual(r.ok, true);
    }));
});

describe('fetchSnapshot: a failure that quotes the token', () => {
    const TOKEN = 'sk-ant-oat01-abcdefgh12345678';
    const REFRESH = 'sk-ant-ort01-zyxwvuts87654321';
    const credsOf = (dir, expiresAt) => writeText(GLib.build_filenamev([dir, 'secret.json']), JSON.stringify({
        claudeAiOauth: {accessToken: TOKEN, refreshToken: REFRESH, expiresAt, subscriptionType: 'pro'},
    }));

    it('neither the result nor .last_error carries the access token', withTemp(({cache, dir}) => {
        const credsPath = credsOf(dir, 9_999_999_999_000);
        const r = runSync(fetchSnapshot({cache, http: httpStub(res(500, `bad token ${TOKEN}`)), credsPath}));
        assertEqual(r.ok, false);
        assertEqual(JSON.stringify(r).includes(TOKEN), false);
        const onDisk = runSync(cache.readLastError());
        assertEqual(onDisk.body.includes(TOKEN), false);
        assertEqual(onDisk.body.includes('[key]'), true);
    }));

    it('a refreshed token is redacted too', withTemp(({cache, dir}) => {
        const credsPath = credsOf(dir, 0);
        const NEW = 'sk-ant-oat01-newnewnew99999999';
        const http = httpStub([
            res(200, JSON.stringify({access_token: NEW, expires_in: 3600})),
            res(500, `bad token ${NEW} after ${REFRESH}`),
        ]);
        runSync(fetchSnapshot({cache, http, credsPath}));
        const onDisk = runSync(cache.readLastError());
        assertEqual(onDisk.body.includes(NEW), false);
        assertEqual(onDisk.body.includes(REFRESH), false);
    }));
});

system.exit(summary());

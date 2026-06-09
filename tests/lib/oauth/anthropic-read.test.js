import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {readCreds, planLabel, defaultCredsPath} from '../../../lib/oauth/anthropic.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';

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

function writeFixture(text) {
    const dir = GLib.Dir.make_tmp('ai-usagebar-creds-XXXXXX');
    const path = GLib.build_filenamev([dir, '.credentials.json']);
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(text),
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        null
    );
    return {path, cleanup: () => rmRf(dir)};
}

function withFixture(text, fn) {
    return () => {
        const {path, cleanup} = writeFixture(text);
        try {
            fn(path);
        } finally {
            cleanup();
        }
    };
}

describe('oauth/anthropic readCreds', () => {
    it('defaultCredsPath ends with .claude/.credentials.json', () => {
        const p = defaultCredsPath();
        if (!p.endsWith('/.claude/.credentials.json'))
            throw new Error(`unexpected default path: ${p}`);
    });

    it('canonical shape: accessToken, expiresAtMs, planLabel Max 5x', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'AT',
                refreshToken: 'RT',
                expiresAt: 1735000000000,
                subscriptionType: 'max',
                rateLimitTier: 'default_claude_max_5x',
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertEqual(oauth.accessToken, 'AT');
            assertEqual(oauth.refreshToken, 'RT');
            assertEqual(oauth.expiresAtMs, 1735000000000);
            assertEqual(planLabel(oauth), 'Max 5x');
        }
    ));

    it('float expiresAt truncates to integer', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R',
                expiresAt: 5000.9,
                subscriptionType: 'max', rateLimitTier: '',
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertEqual(oauth.expiresAtMs, 5000);
        }
    ));

    it('pro with no tier → Pro', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: 'pro', rateLimitTier: '',
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertEqual(planLabel(oauth), 'Pro');
        }
    ));

    it('max with 20x tier → Max 20x', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x',
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertEqual(planLabel(oauth), 'Max 20x');
        }
    ));

    it('empty subscriptionType → Unknown', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: '', rateLimitTier: '',
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertEqual(planLabel(oauth), 'Unknown');
        }
    ));

    it('malformed JSON throws with re-authenticate phrase', withFixture('not json', (path) => {
        try {
            readCreds(path);
            throw new Error('expected throw');
        } catch (e) {
            if (!String(e.message).includes('Run `claude` to re-authenticate.'))
                throw new Error(`message missing phrase: ${e.message}`);
            if (!String(e.message).includes(path))
                throw new Error(`message missing path: ${e.message}`);
        }
    }));

    it('missing file throws with code === ENOENT', () => {
        try {
            readCreds('/nonexistent/ai-usagebar/does-not-exist.json');
            throw new Error('expected throw');
        } catch (e) {
            assertEqual(e.code, 'ENOENT');
        }
    });

    it('unknown top-level field preserved in raw', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: 'max', rateLimitTier: '',
            },
            mcpOAuth: {x: 1},
            someOtherField: 'keep me',
        }),
        (path) => {
            const {raw} = readCreds(path);
            assertEqual(raw.mcpOAuth.x, 1);
            assertEqual(raw.someOtherField, 'keep me');
        }
    ));

    it('scopes preserved verbatim', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: 'max', rateLimitTier: '',
                scopes: ['user:inference'],
            },
        }),
        (path) => {
            const {oauth} = readCreds(path);
            assertDeepEqual(oauth.scopes, ['user:inference']);
        }
    ));
});

system.exit(summary());

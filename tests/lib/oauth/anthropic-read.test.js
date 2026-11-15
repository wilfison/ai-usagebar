import GLib from 'gi://GLib';
import system from 'system';

import {readCreds, defaultCredsPath} from '../../../lib/oauth/anthropic.js';
import {credsPlanLabel as planLabel} from '../../../lib/vendors/anthropic/parser.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';
import {runSync, writeText, withTempDir} from '../../_harness.js';

function withFixture(text, fn) {
    return withTempDir(({dir}) => fn(writeText(GLib.build_filenamev([dir, '.credentials.json']), text, {private: true})));
}

describe('oauth/anthropic readCreds', () => {
    it('defaultCredsPath ends with .claude/.credentials.json', () => {
        const p = defaultCredsPath();
        if (!p.endsWith('/.claude/.credentials.json'))
            throw new Error(`unexpected default path: ${p}`);
    });

    it('canonical shape: accessToken, expiresAtMs, planLabel Max', withFixture(
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
            const {oauth} = runSync(readCreds(path));
            assertEqual(oauth.accessToken, 'AT');
            assertEqual(oauth.refreshToken, 'RT');
            assertEqual(oauth.expiresAtMs, 1735000000000);
            assertEqual(planLabel(oauth), 'Max');
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
            const {oauth} = runSync(readCreds(path));
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
            const {oauth} = runSync(readCreds(path));
            assertEqual(planLabel(oauth), 'Pro');
        }
    ));

    it('max with 20x tier → Ultra (renamed October 2026)', withFixture(
        JSON.stringify({
            claudeAiOauth: {
                accessToken: 'A', refreshToken: 'R', expiresAt: 0,
                subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x',
            },
        }),
        (path) => {
            const {oauth} = runSync(readCreds(path));
            assertEqual(planLabel(oauth), 'Ultra');
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
            const {oauth} = runSync(readCreds(path));
            assertEqual(planLabel(oauth), 'Unknown');
        }
    ));

    it('malformed JSON throws with re-authenticate phrase', withFixture('not json', (path) => {
        try {
            runSync(readCreds(path));
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
            runSync(readCreds('/nonexistent/ai-usagebar/does-not-exist.json'));
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
            const {raw} = runSync(readCreds(path));
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
            const {oauth} = runSync(readCreds(path));
            assertDeepEqual(oauth.scopes, ['user:inference']);
        }
    ));
});

system.exit(summary());

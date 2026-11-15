import system from 'system';

import {
    needsRefresh,
    parseErrorBody,
    TOKEN_URL,
    CLIENT_ID,
    BETA_HEADER,
    USER_AGENT,
    REFRESH_BUFFER_SECS,
    applyRefresh,
} from '../../../lib/oauth/anthropic.js';
import {describe, it, assertEqual, summary} from '../../_assert.js';

describe('needsRefresh', () => {
    const now = 1_000_000;

    it('true within buffer', () => {
        assertEqual(needsRefresh(now + 100, now), true);
    });

    it('false outside buffer', () => {
        assertEqual(needsRefresh(now + 1000, now), false);
    });

    it('true when already expired', () => {
        assertEqual(needsRefresh(now - 1, now), true);
    });

    it('boundary: now+300 is false, now+299 is true', () => {
        assertEqual(needsRefresh(now + 300, now), false);
        assertEqual(needsRefresh(now + 299, now), true);
    });
});

describe('parseErrorBody', () => {
    it('OAuth-style: error_description wins', () => {
        const s = '{"error":"invalid_grant","error_description":"Refresh token expired"}';
        assertEqual(parseErrorBody(s), 'Refresh token expired');
    });

    it('Anthropic-style: error.message', () => {
        const s = '{"error":{"type":"authentication_error","message":"Token invalid"}}';
        assertEqual(parseErrorBody(s), 'Token invalid');
    });

    it('bare string: error: "msg"', () => {
        const s = '{"error":"Something went wrong"}';
        assertEqual(parseErrorBody(s), 'Something went wrong');
    });

    it('unknown shape → null', () => {
        assertEqual(parseErrorBody('{"unknown":"shape"}'), null);
    });

    it('invalid JSON → null', () => {
        assertEqual(parseErrorBody('not json'), null);
    });
});

describe('constants', () => {
    it('expected values', () => {
        assertEqual(TOKEN_URL, 'https://platform.claude.com/v1/oauth/token');
        assertEqual(CLIENT_ID, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
        assertEqual(BETA_HEADER, 'oauth-2025-04-20');
        assertEqual(USER_AGENT, 'claude-cli/1.0');
        assertEqual(REFRESH_BUFFER_SECS, 300);
    });
});

describe('applyRefresh', () => {
    const NOW_MS = 1_800_000_000_000;
    const oauth = () => ({accessToken: 'AT', refreshToken: 'RT', expiresAtMs: 0});

    it('a new access token alone keeps the refresh token and is not a rotation', () => {
        const o = oauth();
        const r = applyRefresh(o, {accessToken: 'NEW', refreshToken: null, expiresIn: 3600}, NOW_MS);
        assertEqual(r.rotated, false);
        assertEqual(o.accessToken, 'NEW');
        assertEqual(o.refreshToken, 'RT');
        assertEqual(o.expiresAtMs, NOW_MS + 3_600_000);
    });

    it('a new refresh token is a rotation', () => {
        const o = oauth();
        const r = applyRefresh(o, {accessToken: 'NEW', refreshToken: 'RT2', expiresIn: 60}, NOW_MS);
        assertEqual(r.rotated, true);
        assertEqual(o.refreshToken, 'RT2');
    });
});

system.exit(summary());

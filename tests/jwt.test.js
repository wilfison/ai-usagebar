import system from 'system';

import {parseJwtClaims, jwtExpSecs, chatgptPlanType} from '../lib/oauth/jwt.js';
import {describe, it, assertEqual, summary} from './_assert.js';

/** Encode a UTF-8 string as no-pad base64url (matches the Codex CLI's tokens). */
function b64url(str) {
    const bytes = new TextEncoder().encode(str);
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = bytes[i + 1];
        const b2 = bytes[i + 2];
        out += A[b0 >> 2];
        out += A[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
        if (b1 === undefined)
            break;
        out += A[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
        if (b2 === undefined)
            break;
        out += A[b2 & 63];
    }
    return out;
}

/** Build a fake `{alg:none}` JWT with the given claims (no signature). */
function fakeJwt(claims) {
    return `${b64url(JSON.stringify({alg: 'none', typ: 'JWT'}))}.${b64url(JSON.stringify(claims))}.sig`;
}

describe('parseJwtClaims', () => {
    it('decodes the payload of a well-formed token', () => {
        const claims = parseJwtClaims(fakeJwt({exp: 1234567890, sub: 'u'}));
        assertEqual(claims.exp, 1234567890);
        assertEqual(claims.sub, 'u');
    });

    it('returns null for a non-JWT string', () =>
        assertEqual(parseJwtClaims('not.a.jwt'), null));

    it('returns null for a single-segment token', () =>
        assertEqual(parseJwtClaims('justonepart'), null));

    it('returns null for a non-string input', () =>
        assertEqual(parseJwtClaims(null), null));
});

describe('jwtExpSecs', () => {
    it('reads the exp claim as integer seconds', () =>
        assertEqual(jwtExpSecs(fakeJwt({exp: 1234567890})), 1234567890));

    it('truncates a float exp', () =>
        assertEqual(jwtExpSecs(fakeJwt({exp: 1234567890.9})), 1234567890));

    it('is null when exp is absent', () =>
        assertEqual(jwtExpSecs(fakeJwt({sub: 'u'})), null));

    it('is null for a malformed token', () =>
        assertEqual(jwtExpSecs('not.a.jwt'), null));
});

describe('chatgptPlanType', () => {
    it('reads the nested plan-type claim', () => {
        const jwt = fakeJwt({
            exp: 1234567890,
            'https://api.openai.com/auth': {chatgpt_plan_type: 'plus'},
        });
        assertEqual(chatgptPlanType(jwt), 'plus');
    });

    it('is null when the auth claim is absent', () =>
        assertEqual(chatgptPlanType(fakeJwt({exp: 1})), null));

    it('is null for a malformed token', () =>
        assertEqual(chatgptPlanType('not.a.jwt'), null));
});

system.exit(summary());

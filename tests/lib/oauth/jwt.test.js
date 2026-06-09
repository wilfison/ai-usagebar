import system from 'system';

import {parseJwtClaims, jwtExpSecs, chatgptPlanType} from '../../../lib/oauth/jwt.js';
import {describe, it, assertEqual, summary} from '../../_assert.js';

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

function fakeJwt(claims) {
    return `${b64url(JSON.stringify({alg: 'none', typ: 'JWT'}))}.${b64url(JSON.stringify(claims))}.sig`;
}

// Build a token from a raw payload string, for payloads JSON.stringify can't
// produce (literal null, bare primitives, non-finite numbers like 1e999).
function rawJwt(payload) {
    return `${b64url(JSON.stringify({alg: 'none', typ: 'JWT'}))}.${b64url(payload)}.sig`;
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

    it('returns null when the payload is a JSON array', () =>
        assertEqual(parseJwtClaims(fakeJwt([1, 2, 3])), null));

    it('returns null when the payload is literal JSON null', () =>
        assertEqual(parseJwtClaims(rawJwt('null')), null));

    it('returns null when the payload is a bare JSON primitive', () => {
        assertEqual(parseJwtClaims(rawJwt('42')), null);
        assertEqual(parseJwtClaims(rawJwt('"hi"')), null);
    });

    it('decodes an unpadded base64url payload (byte length not a multiple of 3)', () => {
        // {"sub":"ab"} is 12 bytes → no padding; {"sub":"a"} is 11 bytes → would
        // need padding, which base64url omits. Both must still round-trip.
        assertEqual(parseJwtClaims(fakeJwt({sub: 'a'})).sub, 'a');
        assertEqual(parseJwtClaims(fakeJwt({sub: 'ab'})).sub, 'ab');
    });
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

    it('is null when exp is non-finite', () =>
        assertEqual(jwtExpSecs(rawJwt('{"exp":1e999}')), null));

    it('is null when exp is a string', () =>
        assertEqual(jwtExpSecs(fakeJwt({exp: '123'})), null));
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

    it('is null when the auth claim is a non-object', () =>
        assertEqual(chatgptPlanType(fakeJwt({'https://api.openai.com/auth': 'nope'})), null));

    it('is null when the auth claim is JSON null', () =>
        assertEqual(chatgptPlanType(fakeJwt({'https://api.openai.com/auth': null})), null));

    it('is null when chatgpt_plan_type is not a string', () =>
        assertEqual(
            chatgptPlanType(fakeJwt({'https://api.openai.com/auth': {chatgpt_plan_type: 5}})),
            null
        ));
});

system.exit(summary());

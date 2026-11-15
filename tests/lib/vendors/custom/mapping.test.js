import system from 'system';

import {
    validateMapping, providerName, urlProblem, parseExtraHeaders, parseMapping, requestHeaders, authHeaderOf,
    DEFAULT_AUTH_HEADER,
} from '../../../../lib/vendors/custom/mapping.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

describe('validateMapping', () => {
    const valid = {metrics: [{label: 'Requests', used: '/u', limit: '/l', windowSecs: 3600}], texts: [{label: 'Region', value: '/r'}]};

    it('accepts a valid mapping', () => assertDeepEqual(validateMapping(valid), []));

    it('needs at least one metric or text', () => {
        assertEqual(validateMapping({}).length, 1);
        assertEqual(validateMapping({metrics: [], texts: []}).length, 1);
        assertEqual(validateMapping(null).length, 1);
    });

    it('rejects invalid pointers', () => {
        assertEqual(validateMapping({metrics: [{label: 'A', percent: 'p'}]}).length > 0, true);
        assertEqual(validateMapping({planPath: '', texts: [{label: 'A', value: '/v'}]}).length > 0, true);
        assertEqual(validateMapping({texts: [{label: 'A', value: ''}]}).length > 0, true);
    });

    it('percent cannot coexist with used/limit, and one of them is required', () => {
        assertEqual(validateMapping({metrics: [{label: 'A', percent: '/p', used: '/u', limit: '/l'}]}).length > 0, true);
        assertEqual(validateMapping({metrics: [{label: 'A', used: '/u'}]}).length > 0, true);
    });

    it('labels are 1–64 characters, without controls, and unique', () => {
        assertEqual(validateMapping({texts: [{label: '', value: '/v'}]}).length > 0, true);
        assertEqual(validateMapping({texts: [{label: 'x'.repeat(65), value: '/v'}]}).length > 0, true);
        assertEqual(validateMapping({texts: [{label: 'a\tb', value: '/v'}]}).length > 0, true);
        const dup = validateMapping({metrics: [{label: 'Same', percent: '/p'}], texts: [{label: 'Same', value: '/v'}]});
        assertEqual(dup.some(e => e.includes('used twice')), true);
    });

    it('windowSecs must be an integer of at least 60', () => {
        assertEqual(validateMapping({metrics: [{label: 'A', percent: '/p', windowSecs: 59}]}).length > 0, true);
        assertEqual(validateMapping({metrics: [{label: 'A', percent: '/p', windowSecs: 90.5}]}).length > 0, true);
        assertDeepEqual(validateMapping({metrics: [{label: 'A', percent: '/p', windowSecs: 60}]}), []);
    });
});

describe('providerName', () => {
    it('trims, defaults to Custom, caps at 48', () => {
        assertEqual(providerName('  Team API  '), 'Team API');
        assertEqual(providerName(''), 'Custom');
        assertEqual(providerName('é'.repeat(50)).length, 48);
    });
});

describe('urlProblem', () => {
    it('accepts https', () => assertEqual(urlProblem('https://api.example.com/usage', false), null));
    it('refuses http unless allowed', () => {
        assertEqual(urlProblem('http://localhost:8765/usage', false).includes('http://'), true);
        assertEqual(urlProblem('http://localhost:8765/usage', true), null);
    });
    it('refuses other schemes, user:pass@ and a missing host', () => {
        assertEqual(urlProblem('ftp://example.com', true) !== null, true);
        assertEqual(urlProblem('https://user:pass@example.com/x', false).includes('user name'), true);
        assertEqual(urlProblem('https://token@example.com/x', false) !== null, true);
        assertEqual(urlProblem('https:///usage', false).includes('host'), true);
        assertEqual(urlProblem('https://:443/usage', false).includes('host'), true);
    });
    it('refuses a relative or empty URL', () => {
        assertEqual(urlProblem('', false) !== null, true);
        assertEqual(urlProblem('example.com/usage', false) !== null, true);
    });
    it('never echoes the URL', () => {
        assertEqual(urlProblem('https://secret:pw@example.com', false).includes('secret'), false);
    });
});

describe('parseExtraHeaders', () => {
    it('empty is none', () => assertDeepEqual(parseExtraHeaders('  ', 'Authorization'), {}));
    it('an object of strings', () => assertDeepEqual(parseExtraHeaders('{"X-Team":"core"}', 'Authorization'), {'X-Team': 'core'}));
    it('invalid JSON, a non-object, non-string values or bad names → null', () => {
        for (const bad of ['{', '[]', '"x"', '{"X":1}', '{"Bad Name":"x"}', '{"X":"a\\nb"}'])
            assertEqual(parseExtraHeaders(bad, 'Authorization'), null, bad);
    });
    it('repeating the auth header (any case) → null', () => {
        assertEqual(parseExtraHeaders('{"authorization":"x"}', 'Authorization'), null);
        assertEqual(parseExtraHeaders('{"X-Api-Key":"x"}', 'x-api-key'), null);
    });
});

describe('parseMapping', () => {
    it('a valid mapping', () => assertEqual(parseMapping('{"texts":[{"label":"R","value":"/r"}]}').texts.length, 1));
    it('empty, invalid JSON or an invalid mapping → null', () => {
        for (const bad of ['', '{', '[]', '{"metrics":[]}', '{"metrics":[{"label":"A","percent":"x"}]}'])
            assertEqual(parseMapping(bad), null, bad);
    });
});

describe('requestHeaders', () => {
    const cfg = {authHeader: 'Authorization', authScheme: 'Bearer', extraHeaders: {'X-Team': 'core'}};
    it('Accept, the extras and the scheme-prefixed key', () =>
        assertDeepEqual(requestHeaders(cfg, 'k'), {Accept: 'application/json', 'X-Team': 'core', Authorization: 'Bearer k'}));
    it('an empty scheme sends the key bare, in the chosen header', () =>
        assertEqual(requestHeaders({...cfg, authHeader: 'X-Api-Key', authScheme: ''}, 'k')['X-Api-Key'], 'k'));
    it('no key → no auth header', () => assertEqual('Authorization' in requestHeaders(cfg, null), false));
});

describe('authHeaderOf', () => {
    it('a blank pref is the default header', () => {
        assertEqual(authHeaderOf(''), DEFAULT_AUTH_HEADER);
        assertEqual(authHeaderOf('   '), 'Authorization');
        assertEqual(authHeaderOf(null), 'Authorization');
    });
    it('a set header is trimmed', () => assertEqual(authHeaderOf('  X-Api-Key '), 'X-Api-Key'));
});

system.exit(summary());

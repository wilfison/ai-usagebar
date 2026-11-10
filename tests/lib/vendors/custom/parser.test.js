import system from 'system';

import {
    parseUsage, validateMapping, placeholders, customPeakUsage, customSeverity, formatNumber, SchemaError,
    shortCode, providerName, urlProblem, parseExtraHeaders, parseMapping, requestHeaders, notifyRows, resetCredits,
    snapshotToCacheJson, parseCacheJson,
} from '../../../../lib/vendors/custom/parser.js';
import {Severity} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const NOW = new Date('2026-06-05T12:00:00Z');

const BODY = JSON.stringify({
    account: {tier: 'Team'},
    usage: {used: 12, limit: 100, pct: '42.6', reset_ms: 1_780_000_000_000, reset_s: '1780000000',
        reset_iso: '2026-06-06T00:00:00Z', left: 3600},
    status: {ok: true, region: 'eu', count: 7, ratio: 0.125},
});

function parse(mapping, body = BODY) {
    return parseUsage(body, mapping, NOW);
}

function schemaError(fn) {
    try {
        fn();
    } catch (e) {
        return e instanceof SchemaError ? e.message : `wrong error: ${e}`;
    }
    return null;
}

const metric = (extra) => ({metrics: [Object.assign({label: 'Requests'}, extra)]});

describe('parseUsage: metrics', () => {
    it('used + limit → rounded, clamped percent with an "X of Y" footnote', () => {
        const m = parse(metric({used: '/usage/used', limit: '/usage/limit'})).metrics[0];
        assertEqual(m.pct, 12);
        assertEqual(m.footnote, '12 of 100');
        assertEqual(parse(metric({used: '/a', limit: '/b'}), '{"a":2,"b":3}').metrics[0].pct, 67);
        assertEqual(parse(metric({used: '/a', limit: '/b'}), '{"a":250,"b":100}').metrics[0].pct, 100);
    });

    it('a limit of 0 or less is a SchemaError', () => {
        assertEqual(schemaError(() => parse(metric({used: '/a', limit: '/b'}), '{"a":1,"b":0}')) !== null, true);
        assertEqual(schemaError(() => parse(metric({used: '/a', limit: '/b'}), '{"a":1,"b":-5}')) !== null, true);
    });

    it('percent alone is used directly (numeric strings accepted), with no footnote', () => {
        const m = parse(metric({percent: '/usage/pct'})).metrics[0];
        assertEqual(m.pct, 43);
        assertEqual(m.footnote, '');
    });

    it('rejects number-like strings that are not plain numbers', () => {
        for (const bad of ['"1,234"', '"inf"', '"0x10"', '""'])
            assertEqual(schemaError(() => parse(metric({percent: '/p'}), `{"p":${bad}}`)) !== null, true);
    });

    it('resetsAt accepts epoch ms, epoch s (number or string) and RFC 3339', () => {
        assertEqual(parse(metric({percent: '/usage/pct', resetsAt: '/usage/reset_ms'})).metrics[0].resetsAt.getTime(), 1_780_000_000_000);
        assertEqual(parse(metric({percent: '/usage/pct', resetsAt: '/usage/reset_s'})).metrics[0].resetsAt.getTime(), 1_780_000_000_000);
        assertEqual(parse(metric({percent: '/usage/pct', resetsAt: '/usage/reset_iso'})).metrics[0].resetsAt.toISOString(),
            '2026-06-06T00:00:00.000Z');
    });

    it('a negative or unreadable timestamp is a SchemaError', () => {
        assertEqual(schemaError(() => parse(metric({percent: '/p', resetsAt: '/r'}), '{"p":1,"r":-1}')) !== null, true);
        assertEqual(schemaError(() => parse(metric({percent: '/p', resetsAt: '/r'}), '{"p":1,"r":"tomorrow"}')) !== null, true);
        assertEqual(schemaError(() => parse(metric({percent: '/p', resetsAt: '/r'}), '{"p":1,"r":true}')) !== null, true);
    });

    it('resetsAfterSeconds is relative to now', () => {
        const m = parse(metric({percent: '/usage/pct', resetsAfterSeconds: '/usage/left'})).metrics[0];
        assertEqual(m.resetsAt.getTime(), NOW.getTime() + 3600 * 1000);
    });

    it('when both resolve, resetsAt wins', () => {
        const m = parse(metric({percent: '/usage/pct', resetsAt: '/usage/reset_ms', resetsAfterSeconds: '/usage/left'})).metrics[0];
        assertEqual(m.resetsAt.getTime(), 1_780_000_000_000);
    });

    it('windowSecs becomes windowMs; absent is null', () => {
        assertEqual(parse(metric({percent: '/usage/pct', windowSecs: 3600})).metrics[0].windowMs, 3_600_000);
        assertEqual(parse(metric({percent: '/usage/pct'})).metrics[0].windowMs, null);
    });

    it('a pointer that does not resolve fails the whole projection', () => {
        const msg = schemaError(() => parse(metric({used: '/usage/used', limit: '/usage/nope'})));
        assertEqual(msg.includes('/usage/nope'), true);
    });

    it('a wrong type is a SchemaError', () => {
        assertEqual(schemaError(() => parse(metric({percent: '/usage'}))) !== null, true);
        assertEqual(schemaError(() => parse(metric({percent: '/status/ok'}))) !== null, true);
    });
});

describe('parseUsage: plan and texts', () => {
    it('planPath wins over plan', () => {
        assertEqual(parse({plan: 'Static', planPath: '/account/tier', texts: [{label: 'x', value: '/status/region'}]}).plan, 'Team');
        assertEqual(parse({plan: 'Static', texts: [{label: 'x', value: '/status/region'}]}).plan, 'Static');
        assertEqual(parse({texts: [{label: 'x', value: '/status/region'}]}).plan, null);
    });

    it('texts accept strings, numbers and booleans', () => {
        const s = parse({texts: [
            {label: 'Region', value: '/status/region'},
            {label: 'Count', value: '/status/count'},
            {label: 'Ratio', value: '/status/ratio'},
            {label: 'OK', value: '/status/ok'},
        ]});
        assertDeepEqual(s.texts.map(t => t.value), ['eu', '7', '0.13', 'true']);
    });

    it('a text of another type is a SchemaError', () =>
        assertEqual(schemaError(() => parse({texts: [{label: 'x', value: '/usage'}]})) !== null, true));

    it('sanitizes and caps every string at 200 characters', () => {
        const body = JSON.stringify({name: `ev‮il\u0007${'x'.repeat(300)}`, plan: 'Pro‏'});
        const s = parse({planPath: '/plan', texts: [{label: 'Name', value: '/name'}]}, body);
        assertEqual(s.plan, 'Pro');
        assertEqual(s.texts[0].value.startsWith('evil'), true);
        assertEqual(Array.from(s.texts[0].value).length, 200);
    });

    it('an unparseable body is a SchemaError', () =>
        assertEqual(schemaError(() => parse(metric({percent: '/p'}), 'not json')) !== null, true));
});

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

describe('placeholders / peak / severity', () => {
    const s = parse({planPath: '/account/tier', metrics: [
        {label: 'A', used: '/usage/used', limit: '/usage/limit', resetsAfterSeconds: '/usage/left'},
        {label: 'B', percent: '/usage/pct'},
        {label: 'C', percent: '/status/count'},
    ]});

    it('indexes every metric and aliases the first two', () => {
        const m = placeholders(s, NOW);
        assertEqual(m.get('custom_plan'), 'Team');
        assertEqual(m.get('custom_0_pct'), '12');
        assertEqual(m.get('custom_1_pct'), '43');
        assertEqual(m.get('custom_2_pct'), '7');
        assertEqual(m.get('custom_0_reset'), '1h 00m');
        assertEqual(m.get('session_pct'), '12');
        assertEqual(m.get('weekly_pct'), '43');
    });

    it('session_elapsed/weekly_elapsed: 0 without a window to pace against', () => {
        const m = placeholders(s, NOW);
        assertEqual(m.get('session_elapsed'), '0');
        assertEqual(m.get('weekly_elapsed'), '0');
    });

    it('session_elapsed follows a paced first metric', () => {
        const paced = parse({metrics: [
            {label: 'A', used: '/usage/used', limit: '/usage/limit', resetsAfterSeconds: '/usage/left', windowSecs: 7200},
        ]});
        assertEqual(placeholders(paced, NOW).get('session_elapsed'), '50');
    });

    it('peak and severity follow the highest metric', () => {
        assertEqual(customPeakUsage(s).percent, 43);
        assertEqual(customSeverity(s), Severity.LOW);
        assertEqual(customPeakUsage({metrics: []}).percent, null);
    });
});

describe('formatNumber', () => {
    it('integers verbatim, fractions to at most 2 places', () => {
        assertEqual(formatNumber(100), '100');
        assertEqual(formatNumber(2.5), '2.5');
        assertEqual(formatNumber(1 / 3), '0.33');
        assertEqual(formatNumber(2.0), '2');
    });
});

describe('shortCode', () => {
    it('first three ASCII letters, upper-cased', () => assertEqual(shortCode('My Tool'), 'MYT'));
    it('folds accents and skips punctuation and digits', () => {
        assertEqual(shortCode('Café-Pro'), 'CAF');
        assertEqual(shortCode('9 Ö.k!y'), 'OKY');
    });
    it('keeps what there is when shorter', () => assertEqual(shortCode('AI'), 'AI'));
    it('falls back to CST', () => {
        assertEqual(shortCode('42 !!'), 'CST');
        assertEqual(shortCode(''), 'CST');
        assertEqual(shortCode(undefined), 'CST');
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

describe('notifyRows / resetCredits / cache / vendor_short', () => {
    const s = {...parse({metrics: [{label: 'A', percent: '/usage/pct'}]}), name: 'My Tool'};

    it('one notify row per metric', () => {
        assertDeepEqual(notifyRows(s), [{key: 'metric:A', label: 'A', percent: 43, resetsAt: null}]);
        assertEqual(resetCredits(s).length, 0);
    });

    it('round-trips through the cache', () => {
        assertDeepEqual(parseCacheJson(snapshotToCacheJson(s)), s);
    });

    it('{vendor_short} comes from the name', () => {
        assertEqual(placeholders(s, NOW).get('vendor_short'), 'myt');
        assertEqual(placeholders({...s, name: undefined}, NOW).get('vendor_short'), 'cst');
    });
});

describe('currency', () => {
    const body = JSON.stringify({spend: {used: 12.5, limit: '60'}, wallet: 7, name: 'x'});
    const now = new Date('2026-10-01T00:00:00Z');
    const metric = extra => ({label: 'Spend', used: '/spend/used', limit: '/spend/limit', ...extra});

    it('formats used and limit as money', () =>
        assertEqual(parseUsage(body, {metrics: [metric({currency: 'USD'})]}, now).metrics[0].footnote, '$12.50 of $60.00'));
    it('uses the currency\'s own symbol, or the code after an unknown one', () => {
        assertEqual(parseUsage(body, {metrics: [metric({currency: 'EUR'})]}, now).metrics[0].footnote, '€12.50 of €60.00');
        assertEqual(parseUsage(body, {metrics: [metric({currency: 'CHF'})]}, now).metrics[0].footnote, '12.50 CHF of 60.00 CHF');
    });
    it('without currency the bare numbers stay', () =>
        assertEqual(parseUsage(body, {metrics: [metric()]}, now).metrics[0].footnote, '12.5 of 60'));
    it('a text with currency is money', () =>
        assertEqual(parseUsage(body, {texts: [{label: 'Wallet', value: '/wallet', currency: 'USD'}]}, now).texts[0].value, '$7.00'));
    it('a text with currency must be numeric', () => {
        let threw = false;
        try {
            parseUsage(body, {texts: [{label: 'Name', value: '/name', currency: 'USD'}]}, now);
        } catch (e) {
            threw = e.name === 'SchemaError';
        }
        assertEqual(threw, true);
    });
    it('validateMapping rejects a malformed code, naming the item', () => {
        for (const bad of ['usd', 'US', 'USDT', 5, ''])
            assertEqual(validateMapping({metrics: [metric({currency: bad})]}).some(e => e.startsWith('metrics[0].currency')), true, String(bad));
        assertEqual(validateMapping({texts: [{label: 'W', value: '/w', currency: 'eur'}]}).some(e => e.startsWith('texts[0].currency')), true);
    });
    it('validateMapping rejects currency on a percent metric', () =>
        assertEqual(validateMapping({metrics: [{label: 'P', percent: '/p', currency: 'USD'}]}).some(e => e.includes('currency cannot be combined with percent')), true));
    it('a valid currency passes validation', () => {
        assertDeepEqual(validateMapping({metrics: [metric({currency: 'USD'})], texts: [{label: 'W', value: '/w', currency: 'BRL'}]}), []);
    });
});

system.exit(summary());

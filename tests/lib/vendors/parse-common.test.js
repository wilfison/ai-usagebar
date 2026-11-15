import system from 'system';

import {
    SchemaError, isObject, isFiniteNumber, decodeText, decodeJson, decodeJsonObject, parseInstant, capitalize, isCurrencyCode,
    SESSION_MS, WEEKLY_MS, MONTH_MS,
} from '../../../lib/vendors/parse-common.js';
import {describe, it, assertEqual, assertDeepEqual} from '../../_assert.js';
import {summary} from '../../_assert.js';

function thrown(fn) {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected throw');
}

describe('SchemaError', () => {
    it('is an Error named SchemaError', () => {
        const e = new SchemaError('bad');
        assertEqual(e instanceof Error, true);
        assertEqual(e.name, 'SchemaError');
        assertEqual(e.message, 'bad');
    });
});

describe('isObject / isFiniteNumber', () => {
    it('isObject accepts plain objects only', () => {
        assertDeepEqual([{}, [], null, 'x', 1, undefined].map(isObject), [true, false, false, false, false, false]);
    });
    it('isFiniteNumber rejects NaN, Infinity and numeric strings', () => {
        assertDeepEqual([0, -1.5, NaN, Infinity, '1', null].map(isFiniteNumber), [true, true, false, false, false, false]);
    });
});

describe('decodeText', () => {
    it('decodes UTF-8 bytes', () => assertEqual(decodeText(new TextEncoder().encode('ção')), 'ção'));
    it('stringifies anything else', () => assertEqual(decodeText(42), '42'));
});

describe('decodeJson', () => {
    it('parses bytes or text', () => {
        assertDeepEqual(decodeJson(new TextEncoder().encode('[1]'), 'x'), [1]);
        assertEqual(decodeJson('null', 'x'), null);
    });
    it('throws a SchemaError naming what failed', () => {
        const e = thrown(() => decodeJson('{', 'zai quota response'));
        assertEqual(e instanceof SchemaError, true);
        assertEqual(e.message.startsWith('zai quota response unparseable: '), true, e.message);
    });
    it('passes a reviver to JSON.parse', () => {
        assertEqual(decodeJson('{"a":1}', 'x', {reviver: (k, v) => (k === 'a' ? v + 1 : v)}).a, 2);
    });
});

describe('decodeJsonObject', () => {
    it('returns a top-level object', () => assertEqual(decodeJsonObject('{"a":1}', 'x').a, 1));
    for (const text of ['[]', 'null', '1', '"s"']) {
        it(`rejects ${text}`, () => {
            const e = thrown(() => decodeJsonObject(text, 'kimi usage response'));
            assertEqual(e instanceof SchemaError, true);
            assertEqual(e.message, 'kimi usage response: top-level value is not an object');
        });
    }
    it('keeps the unparseable message', () => {
        assertEqual(thrown(() => decodeJsonObject('x', 'usage response')).message.startsWith('usage response unparseable: '), true);
    });
});

describe('parseInstant', () => {
    it('parses an RFC 3339 string', () => assertEqual(parseInstant('2026-01-02T03:04:05Z').getTime(), Date.UTC(2026, 0, 2, 3, 4, 5)));
    it('is null for a non-string or garbage', () => {
        assertDeepEqual([null, 5, 'nope', undefined].map(parseInstant), [null, null, null, null]);
    });
});

describe('capitalize', () => {
    it('upper-cases the first character only', () => assertEqual(capitalize('pro max'), 'Pro max'));
    it('is empty for an empty or missing string', () => {
        assertEqual(capitalize(''), '');
        assertEqual(capitalize(null), '');
    });
});

describe('isCurrencyCode', () => {
    it('accepts three upper-case letters', () => assertDeepEqual(['USD', 'BRL'].map(isCurrencyCode), [true, true]));
    it('rejects anything else', () => {
        assertDeepEqual(['usd', 'US', 'USDT', 'U$D', '', null, 840].map(isCurrencyCode), [false, false, false, false, false, false, false]);
    });
});

describe('window lengths', () => {
    it('match 5 h, 7 d and 30 d', () => {
        assertEqual(SESSION_MS, 5 * 3600 * 1000);
        assertEqual(WEEKLY_MS, 7 * 86400 * 1000);
        assertEqual(MONTH_MS, 30 * 86400 * 1000);
    });
});

system.exit(summary());

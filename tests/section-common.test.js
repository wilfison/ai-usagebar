import system from 'system';

import {
    wrapWords,
    httpErrorRow,
    footerRow,
    ICON_ERR_SERVER,
    ICON_ERR_CLIENT,
    ICON_FOOTER,
} from '../lib/vendors/section-common.js';
import {localTimeHm} from '../lib/format.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

const theme = {red: '#red', orange: '#orange'};
const bracket = s => `[${s}]`;

describe('wrapWords', () => {
    it('empty string → []', () => {
        assertDeepEqual(wrapWords('', 10), []);
    });

    it('whitespace-only → []', () => {
        assertDeepEqual(wrapWords('   \n\t ', 10), []);
    });

    it('null/undefined → []', () => {
        assertDeepEqual(wrapWords(null, 10), []);
        assertDeepEqual(wrapWords(undefined, 10), []);
    });

    it('packs words greedily up to width', () => {
        assertDeepEqual(wrapWords('aa bb cc dd', 5), ['aa bb', 'cc dd']);
    });

    it('a word exactly at width stays on its line', () => {
        assertDeepEqual(wrapWords('abcde fg', 5), ['abcde', 'fg']);
    });

    it('a single over-long word gets its own line', () => {
        assertDeepEqual(wrapWords('xxxxxxxx yy', 5), ['xxxxxxxx', 'yy']);
    });

    it('collapses runs of whitespace', () => {
        assertDeepEqual(wrapWords('aa   bb', 10), ['aa bb']);
    });

    it('all words fit on one line', () => {
        assertDeepEqual(wrapWords('a b c', 80), ['a b c']);
    });
});

describe('httpErrorRow', () => {
    it('returns null when there is no error', () => {
        assertEqual(httpErrorRow({lastError: null}, theme), null);
    });

    it('returns null for transport/schema errors (code 0)', () => {
        assertEqual(httpErrorRow({lastError: {code: 0, body: 'x'}}, theme), null);
    });

    it('server error (>= 500) uses red + server icon', () => {
        const row = httpErrorRow({lastError: {code: 503, body: 'down'}}, theme);
        assertEqual(row.kind, 'http-error');
        assertEqual(row.icon, ICON_ERR_SERVER);
        assertEqual(row.color, theme.red);
        assertEqual(row.code, 503);
        assertEqual(row.status, 'HTTP 503');
        assertDeepEqual(row.lines, ['down']);
    });

    it('client error (< 500) uses orange + client icon', () => {
        const row = httpErrorRow({lastError: {code: 404, body: 'nope'}}, theme);
        assertEqual(row.icon, ICON_ERR_CLIENT);
        assertEqual(row.color, theme.orange);
        assertEqual(row.status, 'HTTP 404');
    });

    it('wraps a long body to multiple lines', () => {
        const body = 'the quick brown fox jumps over the lazy dog again and again';
        const row = httpErrorRow({lastError: {code: 500, body}}, theme);
        assertEqual(row.lines.length > 1, true);
    });

    it('injected translator localizes the status label', () => {
        const row = httpErrorRow({lastError: {code: 500, body: 'x'}}, theme, bracket);
        assertEqual(row.status, '[HTTP 500]');
    });
});

describe('footerRow', () => {
    const fetchedAt = new Date(2026, 0, 1, 9, 5);

    it('uses the served fetch instant, not now', () => {
        const row = footerRow({fetchedAt});
        assertEqual(row.kind, 'footer');
        assertEqual(row.icon, ICON_FOOTER);
        assertEqual(row.updated, localTimeHm(fetchedAt));
        assertEqual(row.text, `Updated ${localTimeHm(fetchedAt)}`);
    });

    it('falls back to — when fetchedAt is absent', () => {
        const row = footerRow({fetchedAt: null});
        assertEqual(row.updated, '—');
        assertEqual(row.text, 'Updated —');
    });
});

system.exit(summary());

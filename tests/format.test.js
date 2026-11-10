import system from 'system';

import {
    substitute,
    vformat,
    localTimeHm,
    localTimeHms,
    formatMoney,
    sanitizeUntrusted,
    checkedResetTitle,
    resetsAvailableText,
    redactSecret,
    PARTIAL_ECHO_NOTE,
} from '../lib/format.js';
import {describe, it, assertEqual, summary} from './_assert.js';

describe('substitute', () => {
    it('empty template', () => {
        assertEqual(substitute('', {a: '1'}), '');
    });

    it('no placeholders', () => {
        assertEqual(substitute('plain text', {}), 'plain text');
    });

    it('single substitution', () => {
        assertEqual(substitute('{name}', {name: 'cld'}), 'cld');
    });

    it('multiple substitutions', () => {
        assertEqual(substitute('{a}/{b}', {a: '1', b: '2'}), '1/2');
    });

    it('unknown placeholder passes through literal', () => {
        assertEqual(substitute('{unknown}', {}), '{unknown}');
    });

    it('single-pass: replacement containing {x} is not re-scanned', () => {
        assertEqual(substitute('{a}', {a: '{b}', b: 'X'}), '{b}');
    });

    it('unmatched left brace stays literal', () => {
        assertEqual(substitute('{a', {a: '1'}), '{a');
    });

    it('unmatched right brace stays literal', () => {
        assertEqual(substitute('a}', {a: '1'}), 'a}');
    });

    it('UTF-8 keys and values', () => {
        assertEqual(substitute('{ключ}', {'ключ': 'значение'}), 'значение');
    });

    it('Map input', () => {
        assertEqual(substitute('{a}', new Map([['a', '1']])), '1');
    });
});

describe('time formatting', () => {
    // Local-time anchor; relative offsets are computed off this.
    const anchor = new Date(2026, 5, 5, 14, 7, 3);

    it('localTimeHms zero-pads seconds', () => {
        assertEqual(localTimeHms(new Date(2026, 0, 1, 9, 5, 7)), '09:05:07');
    });

    it('localTimeHm zero-pads minutes', () => {
        assertEqual(localTimeHm(new Date(2026, 0, 1, 9, 5)), '09:05');
    });

    it('localTimeHm at anchor', () => {
        assertEqual(localTimeHm(anchor), '14:07');
    });
});

describe('formatMoney', () => {
    it('defaults to USD with two decimals', () => {
        assertEqual(formatMoney(5), '$5.00');
        assertEqual(formatMoney(12.345), '$12.35');
    });

    it('puts the sign ahead of the symbol', () => {
        assertEqual(formatMoney(-5.71), '-$5.71');
        assertEqual(formatMoney(-1.5, 'EUR'), '-€1.50');
        assertEqual(formatMoney(-12.3, 'XYZ'), '-12.30 XYZ');
    });

    it('never renders -$0.00', () => {
        assertEqual(formatMoney(-0), '$0.00');
        assertEqual(formatMoney(-0.001), '$0.00');
        assertEqual(formatMoney(-0.004, 'BRL'), 'R$0.00');
    });

    it('maps the known currencies to symbols, JPY keeping two decimals', () => {
        assertEqual(formatMoney(3.5, 'USD'), '$3.50');
        assertEqual(formatMoney(3.5, 'EUR'), '€3.50');
        assertEqual(formatMoney(3.5, 'GBP'), '£3.50');
        assertEqual(formatMoney(141.57, 'BRL'), 'R$141.57');
        assertEqual(formatMoney(1200, 'JPY'), '¥1200.00');
        assertEqual(formatMoney(20, 'CNY'), '¥20.00');
    });

    it('trails an unknown code', () => assertEqual(formatMoney(12.3, 'XYZ'), '12.30 XYZ'));
});

describe('sanitizeUntrusted', () => {
    it('keeps newlines and turns \t and \r into spaces', () =>
        assertEqual(sanitizeUntrusted('a\tb\r\nc'), 'a b \nc'));

    it('removes C0/C1 controls and DEL', () =>
        assertEqual(sanitizeUntrusted('a\u0000b\u001bc\u007fd\u0085e\u009ff'), 'abcdef'));

    it('removes bidi marks, overrides and isolates', () =>
        assertEqual(sanitizeUntrusted('Pro‮gnp.exe‎‏‪⁦⁩'), 'Prognp.exe'));

    it('truncates by characters, not UTF-16 units', () => {
        assertEqual(sanitizeUntrusted('abcdef', 3), 'abc');
        assertEqual(sanitizeUntrusted('😀😀😀', 2), '😀😀');
    });

    it('turns null and non-strings into text', () => {
        assertEqual(sanitizeUntrusted(null), '');
        assertEqual(sanitizeUntrusted(42), '42');
    });
});

describe('vformat', () => {
    it('substitutes %s in order', () => {
        assertEqual(vformat('%s of %s', '$1', '$2'), '$1 of $2');
    });

    it('substitutes %d (truncating to integer)', () => {
        assertEqual(vformat('Minimum %d s', 300), 'Minimum 300 s');
    });

    it('zero-pads with %02d', () => {
        assertEqual(vformat('%dh %02dm', 1, 5), '1h 05m');
    });

    it('does not pad a wide %02d value', () => {
        assertEqual(vformat('%02d', 123), '123');
    });

    it('renders a literal %% as %', () => {
        assertEqual(vformat('%s used (%s%%)', '$1', 26), '$1 used (26%)');
    });

    it('leaves a template with no conversions untouched', () => {
        assertEqual(vformat('plain'), 'plain');
    });
});

describe('checkedResetTitle', () => {
    it('trims a plausible title', () => {
        assertEqual(checkedResetTitle('  Full reset  '), 'Full reset');
    });

    it('drops a blank, non-string or over-80-character title', () => {
        assertEqual(checkedResetTitle('   '), null);
        assertEqual(checkedResetTitle(null), null);
        assertEqual(checkedResetTitle(42), null);
        assertEqual(checkedResetTitle('x'.repeat(81)), null);
    });

    it('keeps exactly 80 characters, counted as code points', () => {
        assertEqual(checkedResetTitle('é'.repeat(80)), 'é'.repeat(80));
    });

    it('drops a title with a control character', () => {
        assertEqual(checkedResetTitle('a\u0007b'), null);
        assertEqual(checkedResetTitle('a\nb'), null);
    });
});

describe('resetsAvailableText', () => {
    it('pluralizes in English by default', () => {
        assertEqual(resetsAvailableText(0), '0 resets available');
        assertEqual(resetsAvailableText(1), '1 reset available');
        assertEqual(resetsAvailableText(3), '3 resets available');
    });

    it('uses the injected ngettext', () => {
        const ngettext = (one, many, n) => (n === 1 ? `[${one}]` : `[${many}]`);
        assertEqual(resetsAvailableText(1, ngettext), '[1 reset available]');
    });
});


describe('redactSecret', () => {
    const KEY = 'sk-abcdefgh12345678';

    it('replaces each exact copy with [key]', () =>
        assertEqual(redactSecret(`bad key ${KEY}, again ${KEY}`, KEY), 'bad key [key], again [key]'));
    it('a partial echo of 8+ characters replaces the whole text', () =>
        assertEqual(redactSecret('key sk-abcdefgh… is invalid', KEY), PARTIAL_ECHO_NOTE));
    it('a partial echo from the middle of the key counts too', () =>
        assertEqual(redactSecret('fragment efgh1234 seen', KEY), PARTIAL_ECHO_NOTE));
    it('seven characters are not an echo', () =>
        assertEqual(redactSecret('prefix sk-abcd only', KEY), 'prefix sk-abcd only'));
    it('an empty or missing secret leaves the text alone', () => {
        assertEqual(redactSecret('anything', ''), 'anything');
        assertEqual(redactSecret('anything', null), 'anything');
    });
    it('a short secret is only removed when exact', () =>
        assertEqual(redactSecret('pin 1234 and 123', '1234'), 'pin [key] and 123'));
    it('counts code points, not UTF-16 units', () => {
        const emojiKey = '😀😀😀😀😀😀😀😀x';
        assertEqual(redactSecret('says 😀😀😀😀😀😀😀😀', emojiKey), PARTIAL_ECHO_NOTE);
        assertEqual(redactSecret('says 😀😀😀😀😀😀😀', emojiKey), 'says 😀😀😀😀😀😀😀');
    });
    it('non-string text passes through', () => assertEqual(redactSecret(null, KEY), null));
});

system.exit(summary());

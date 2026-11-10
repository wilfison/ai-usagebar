import system from 'system';

import {
    wrapWords,
    httpErrorRow,
    errorText,
    footerRow,
    groupHeading,
    groupedUsage,
    resetCreditRows,
    paceFootnote,
    paceFields,
    ICON_ERR_SERVER,
    ICON_ERR_CLIENT,
    ICON_FOOTER,
} from '../lib/vendors/section-common.js';
import {localTimeHm} from '../lib/format.js';
import {calc} from '../lib/pacing.js';
import {localDateHm, format as formatCountdown} from '../lib/countdown.js';
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

describe('rate-limited backoff', () => {
    it('renders a rate-limited lastError as a client-side row with the countdown', () => {
        const row = httpErrorRow({lastError: {code: 'rate-limited', retryInMs: 4 * 60 * 1000 + 1}}, theme);
        assertEqual(row.kind, 'http-error');
        assertEqual(row.icon, ICON_ERR_CLIENT);
        assertEqual(row.color, '#orange');
        assertEqual(row.status, 'rate limited; next attempt in 5m');
        assertDeepEqual(row.lines, []);
    });

    it('errorText translates the rate-limited code and passes other messages through', () => {
        assertEqual(errorText({ok: false, kind: 'error', code: 'rate-limited', retryInMs: 30 * 1000}),
            'rate limited; next attempt in 30s');
        assertEqual(errorText({ok: false, kind: 'error', code: 'rate-limited', retryInMs: 30 * 1000}, bracket),
            '[rate limited; next attempt in [30s]]');
        assertEqual(errorText({ok: false, kind: 'error', message: 'boom'}), 'boom');
    });
});

describe('auth-rejected', () => {
    it('a 401/403 lastError shows the translated notice and never its body', () => {
        const row = httpErrorRow({lastError: {code: 401, body: '{"access_token":"secret"}'}}, theme);
        assertEqual(row.status, 'HTTP 401: authentication rejected; credentials may be missing, expired, or invalid');
        assertDeepEqual(row.lines, []);
        assertEqual(httpErrorRow({lastError: {code: 403, body: 'x'}}, theme, bracket).status,
            '[HTTP 403: authentication rejected; credentials may be missing, expired, or invalid]');
    });

    it('other bodies are sanitized at render', () => {
        const row = httpErrorRow({lastError: {code: 500, body: 'bad‮gateway'}}, theme);
        assertDeepEqual(row.lines, ['badgateway']);
    });

    it('errorText translates an auth-rejected result', () =>
        assertEqual(errorText({ok: false, kind: 'error', code: 'auth-rejected', status: 403, message: 'x'}, bracket),
            '[HTTP 403: authentication rejected; credentials may be missing, expired, or invalid]'));
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

    it('falls back to - when fetchedAt is absent', () => {
        const row = footerRow({fetchedAt: null});
        assertEqual(row.updated, '-');
        assertEqual(row.text, 'Updated -');
    });
});

describe('groupHeading', () => {
    it('builds a group-heading row carrying its label', () => {
        assertDeepEqual(groupHeading('Session'), {kind: 'group-heading', label: 'Session'});
    });
});

describe('groupedUsage', () => {
    const palette = {red: '#red', orange: '#orange', yellow: '#yellow', green: '#green', fg: '#fg', dim: '#dim', barEmpty: '#empty'};

    it('builds a grouped row with the value, detail and track color', () => {
        const row = groupedUsage({
            group: 'Weekly',
            label: 'gpt-oss:120b',
            percent: 42,
            valueText: '42%',
            detail: '1.2M tokens',
            severity: null,
        }, palette);
        assertEqual(row.kind, 'grouped');
        assertEqual(row.label, 'gpt-oss:120b');
        assertEqual(row.pct, 42);
        assertEqual(row.valueText, '42%');
        assertEqual(row.detail, '1.2M tokens');
        assertEqual(row.trackColor, '#empty');
    });

    it('a null severity paints the fill muted', () => {
        const row = groupedUsage({label: 'm', percent: 95, valueText: '95%', severity: null}, palette);
        assertEqual(row.severity, null);
        assertEqual(row.color, '#dim');
    });

    it('a severity paints the fill in its color', () => {
        const row = groupedUsage({label: 'ctx', percent: 80, valueText: '80%', severity: 'high'}, palette);
        assertEqual(row.color, '#orange');
    });

    it('detail defaults to null', () => {
        assertEqual(groupedUsage({label: 'm', percent: 1, valueText: '1%'}, palette).detail, null);
    });

    it('the key is stable for the same group + label', () => {
        const a = groupedUsage({group: 'Session', label: 'm', percent: 1, valueText: '1%'}, palette);
        const b = groupedUsage({group: 'Session', label: 'm', percent: 99, valueText: '99%'}, palette);
        assertEqual(a.key, b.key);
    });

    it('the same label under another group gets another key', () => {
        const a = groupedUsage({group: 'Session', label: 'm', percent: 1, valueText: '1%'}, palette);
        const b = groupedUsage({group: 'Weekly', label: 'm', percent: 1, valueText: '1%'}, palette);
        assertEqual(a.key === b.key, false);
    });

    it('the key does not collide when a separator character moves between group and label', () => {
        const a = groupedUsage({group: 'a/b', label: 'c', percent: 1, valueText: '1%'}, palette);
        const b = groupedUsage({group: 'a', label: 'b/c', percent: 1, valueText: '1%'}, palette);
        assertEqual(a.key === b.key, false);
    });
});

describe('resetCreditRows', () => {
    const NOW = new Date('2026-06-05T12:00:00Z');
    const later = new Date(NOW.getTime() + 3 * 86400 * 1000);
    const sooner = new Date(NOW.getTime() + 3600 * 1000);
    const past = new Date(NOW.getTime() - 3600 * 1000);

    it('no credits → no rows', () => {
        assertDeepEqual(resetCreditRows([], NOW), []);
        assertDeepEqual(resetCreditRows(null, NOW), []);
    });

    it('a Resets heading, then one line per credit, soonest first, undated first', () => {
        const rows = resetCreditRows([
            {title: 'B', expiresAt: later},
            {title: 'A', expiresAt: sooner},
            {title: 'C', expiresAt: null},
        ], NOW);
        assertDeepEqual(rows[0], {kind: 'group-heading', label: 'Resets'});
        assertDeepEqual(rows[1], {kind: 'text', text: 'C', subtitle: 'No expiry reported'});
        assertDeepEqual(rows[2], {kind: 'text', text: 'A', subtitle: `Expires ${localDateHm(sooner)} (${formatCountdown(sooner, NOW)})`});
        assertDeepEqual(rows[3], {kind: 'text', text: 'B', subtitle: `Expires ${localDateHm(later)} (${formatCountdown(later, NOW)})`});
    });

    it('a lapsed credit reads "Expired <date>"', () => {
        assertEqual(resetCreditRows([{title: 'A', expiresAt: past}], NOW)[1].subtitle, `Expired ${localDateHm(past)}`);
    });

    it('without a title: the fallback title, or the expiry alone', () => {
        assertDeepEqual(resetCreditRows([{title: null, expiresAt: null}], NOW, undefined, 'Reset credit')[1],
            {kind: 'text', text: 'Reset credit', subtitle: 'No expiry reported'});
        assertDeepEqual(resetCreditRows([{title: null, expiresAt: null}], NOW)[1], {kind: 'text', text: 'No expiry reported'});
    });

    it('does not reorder the caller array', () => {
        const credits = [{title: 'B', expiresAt: later}, {title: 'A', expiresAt: sooner}];
        resetCreditRows(credits, NOW);
        assertEqual(credits[0].title, 'B');
    });

    it('translates through the injected translator', () => {
        const rows = resetCreditRows([{title: 'A', expiresAt: null}], NOW, bracket);
        assertEqual(rows[0].label, '[Resets]');
        assertEqual(rows[1].subtitle, '[no expiry reported]');
    });
});

describe('paceFootnote', () => {
    const pace = (state, delta = 0, elapsedPct = 42) => ({state, delta, elapsedPct});

    it('on track', () => assertEqual(paceFootnote(pace('ok', 0)), '42% elapsed · on track'));
    it('ahead', () => assertEqual(paceFootnote(pace('ok', 3)), '42% elapsed · 3pts ahead'));
    it('under', () => assertEqual(paceFootnote(pace('ok', -7)), '42% elapsed · 7pts under'));
    it('estimating', () => assertEqual(paceFootnote(pace('estimating', -7)), 'Estimating…'));
    it('limit', () => assertEqual(paceFootnote(pace('limit', 58)), 'Limit reached'));
    it('neutral → empty', () => assertEqual(paceFootnote(pace('neutral')), ''));

    it('translates through the injected translator', () => {
        assertEqual(paceFootnote(pace('ok', 3), bracket), '[42% elapsed · [3pts ahead]]');
        assertEqual(paceFootnote(pace('limit'), bracket), '[Limit reached]');
    });

    describe('by verdict', () => {
        const NOW = new Date('2026-06-05T12:00:00Z');
        const runsOutAt = new Date(NOW.getTime() + 64 * 60 * 1000);
        const verdict = (v, extra = {}) =>
            ({...pace('ok', 18), verdict: v, projectedPct: 119.6, runsOutAt: null, now: NOW, ...extra});

        it('calm keeps the elapsed footnote', () =>
            assertEqual(paceFootnote(verdict('calm')), '42% elapsed · 18pts ahead'));

        it('no verdict keeps the elapsed footnote', () =>
            assertEqual(paceFootnote(verdict(null)), '42% elapsed · 18pts ahead'));

        it('over says by how much', () =>
            assertEqual(paceFootnote(verdict('over')), '~20% over pace'));

        it('critical says when the limit hits', () =>
            assertEqual(paceFootnote(verdict('critical', {runsOutAt})), `Limit in ${formatCountdown(runsOutAt, NOW)}`));

        it('critical without a run-out instant falls back to over pace', () =>
            assertEqual(paceFootnote(verdict('critical')), '~20% over pace'));

        it('estimating, limit and neutral ignore the verdict', () => {
            assertEqual(paceFootnote({...verdict('critical', {runsOutAt}), state: 'estimating'}), 'Estimating…');
            assertEqual(paceFootnote({...verdict('critical', {runsOutAt}), state: 'limit'}), 'Limit reached');
            assertEqual(paceFootnote({...verdict('critical', {runsOutAt}), state: 'neutral'}), '');
        });

        it('translates through the injected translator', () => {
            assertEqual(paceFootnote(verdict('over'), bracket), '[~20% over pace]');
            assertEqual(paceFootnote(verdict('critical', {runsOutAt}), bracket).startsWith('[Limit in '), true);
        });
    });
});

describe('paceFields', () => {
    const palette = {green: '#g', yellow: '#y', orange: '#o', red: '#r', fg: '#fg'};
    const pace = (state, extra = {}) => ({state, elapsedPct: 40, delta: -10, ratioPace: 'under', ...extra});

    it('no pace → colour only', () => {
        assertDeepEqual(paceFields(30, null, palette), {color: '#g', paceGlyph: ''});
    });

    it('ok → glyph, marker and footnote; a calm row has no tail colour', () => {
        const f = paceFields(30, pace('ok', {verdict: 'calm'}), palette);
        assertEqual(f.paceGlyph, '↓');
        assertEqual(f.elapsedPct, 40);
        assertEqual('paceColor' in f, false);
        assertEqual(f.paceFootnote, '40% elapsed · 10pts under');
    });

    it('ok → the tail colour follows the verdict', () => {
        assertEqual(paceFields(30, pace('ok', {verdict: 'over'}), palette).paceColor, '#o');
        assertEqual(paceFields(30, pace('ok', {verdict: 'critical'}), palette).paceColor, '#r');
    });

    it('estimating keeps the marker but drops the glyph and the tail', () => {
        const f = paceFields(30, pace('estimating', {delta: 20, verdict: null}), palette);
        assertEqual(f.paceGlyph, '');
        assertEqual(f.elapsedPct, 40);
        assertEqual('paceColor' in f, false);
        assertEqual(f.paceFootnote, 'Estimating…');
    });

    it('limit draws no marker and no glyph', () => {
        const f = paceFields(100, pace('limit'), palette);
        assertEqual(f.paceGlyph, '');
        assertEqual('elapsedPct' in f, false);
        assertEqual('paceColor' in f, false);
        assertEqual(f.paceFootnote, 'Limit reached');
    });

    it('neutral draws no marker and an empty footnote', () => {
        const f = paceFields(30, pace('neutral'), palette);
        assertEqual('elapsedPct' in f, false);
        assertEqual(f.paceFootnote, '');
    });

    it('footnote: false leaves the footnote out', () => {
        assertEqual('paceFootnote' in paceFields(30, pace('ok'), palette, undefined, {footnote: false}), false);
    });
});

describe('errorText: invalid mapping', () => {
    it('translates the invalid-mapping code', () => {
        const text = errorText({ok: false, kind: 'error', code: 'invalid-mapping', message: 'x'}, bracket);
        assertEqual(text.startsWith('[The custom provider mapping'), true);
    });
});

describe('paceFootnote: an early burst in a long window', () => {
    it('10% eight hours into a week reads as over pace, never a run-out time', () => {
        const now = new Date('2026-06-01T08:00:00Z');
        const week = 7 * 86400 * 1000;
        const pace = calc({usagePct: 10, reset: new Date(now.getTime() + week - 8 * 3600 * 1000), now, windowMs: week});
        assertEqual(paceFootnote(pace), '~110% over pace');
    });
});

system.exit(summary());

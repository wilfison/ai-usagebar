import system from 'system';

import {buildSection, wrapWords} from '../../../../lib/vendors/anthropic/section.js';
import {SESSION_MS, WEEKLY_MS} from '../../../../lib/vendors/anthropic/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {resetClock, localDateHm, format as formatCountdown} from '../../../../lib/countdown.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {localTimeHm, localTimeHms} from '../../../../lib/format.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const MIN = 60 * 1000;

function win(utilizationPct, mins) {
    return {utilizationPct, resetsAt: new Date(NOW.getTime() + mins * MIN)};
}

function fullSnapshot() {
    return {
        plan: 'Max 5x',
        session: win(62, 90),
        weekly: win(80, 3 * 24 * 60),
        sonnet: win(30, 2 * 24 * 60),
        extra: {limitCents: 5000, spentCents: 2500},
    };
}

function scopedWin(label, utilizationPct, mins) {
    return {label, utilizationPct, resetsAt: new Date(NOW.getTime() + mins * MIN)};
}

const PACE_GLYPHS = ['↑', '→', '↓'];

describe('buildSection: full snapshot', () => {
    const meta = {stale: false, lastError: {code: 503, body: 'upstream down'}, fetchedAt: NOW};
    const model = buildSection(fullSnapshot(), meta, NOW, theme);

    it('carries the plan label', () => assertEqual(model.plan, 'Max 5x'));

    it('builds the full header title', () => assertEqual(model.title, 'Claude Max 5x'));

    it('emits all six row kinds in order', () =>
        assertDeepEqual(model.rows.map(r => r.kind),
            ['window', 'window', 'window', 'gauge', 'http-error', 'footer']));

    it('session row: icon, title, pct, mid→yellow, countdown', () => {
        const r = model.rows[0];
        assertEqual(r.icon, 'alarm-symbolic');
        assertEqual(r.title, 'Session');
        assertEqual(r.pct, 62);
        assertEqual(r.color, theme.yellow);
        assertEqual(r.reset, '1h 30m');
    });

    it('session row carries a ratio pace glyph', () =>
        assertEqual(PACE_GLYPHS.includes(model.rows[0].paceGlyph), true));

    it('weekly row: high→orange', () => {
        const r = model.rows[1];
        assertEqual(r.title, 'Weekly');
        assertEqual(r.color, theme.orange);
    });

    it('sonnet row: low→green, no pace glyph', () => {
        const r = model.rows[2];
        assertEqual(r.icon, 'starred-symbolic');
        assertEqual(r.title, 'Sonnet only');
        assertEqual(r.color, theme.green);
        assertEqual(r.paceGlyph, '');
    });

    it('extra row → gauge: dollars + mid→yellow', () => {
        const r = model.rows[3];
        assertEqual(r.kind, 'gauge');
        assertEqual(r.icon, 'utilities-system-monitor-symbolic');
        assertEqual(r.pct, 50);
        assertEqual(r.value, '$25.00');
        assertEqual(r.subLine, 'Limit: $50.00');
        assertEqual(r.color, theme.yellow);
    });
});

describe('buildSection: omissions', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};

    it('omits sonnet when absent', () => {
        const s = fullSnapshot();
        s.sonnet = null;
        const kinds = buildSection(s, meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds, ['window', 'window', 'gauge', 'footer']);
    });

    it('extra with no cap → gauge with the spend, no bar, "none reported"', () => {
        const s = fullSnapshot();
        s.extra = {limitCents: null, spentCents: 14157, currency: 'BRL', decimalPlaces: 2};
        const g = buildSection(s, meta, NOW, theme).rows.find(r => r.kind === 'gauge');
        assertEqual(g.value, 'R$141.57');
        assertEqual(g.subLine, 'Limit: none reported');
        assertEqual('pct' in g, false);
        assertEqual(buildSection(s, meta, NOW, theme, (t) => `«${t}»`).rows.find(r => r.kind === 'gauge').subLine,
            '«Limit: none reported»');
    });

    it('extra with a cap renders its currency', () => {
        const s = fullSnapshot();
        s.extra = {limitCents: 50000, spentCents: 14157, currency: 'BRL', decimalPlaces: 2};
        const g = buildSection(s, meta, NOW, theme).rows.find(r => r.kind === 'gauge');
        assertEqual(g.value, 'R$141.57');
        assertEqual(g.subLine, 'Limit: R$500.00');
        assertEqual(g.pct, 28);
    });

    it('omits extra when absent', () => {
        const s = fullSnapshot();
        s.extra = null;
        const kinds = buildSection(s, meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds, ['window', 'window', 'window', 'footer']);
    });

    it('omits http-error when lastError is null', () => {
        const kinds = buildSection(fullSnapshot(), meta, NOW, theme).rows.map(r => r.kind);
        assertEqual(kinds.includes('http-error'), false);
    });

    it('omits http-error when code is 0 (transport/schema)', () => {
        const m = {stale: true, lastError: {code: 0, body: 'parse failed'}, fetchedAt: NOW};
        const kinds = buildSection(fullSnapshot(), m, NOW, theme).rows.map(r => r.kind);
        assertEqual(kinds.includes('http-error'), false);
    });
});

describe('buildSection: scoped windows', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};

    it('inserts a window row per scoped entry, after sonnet and before the gauge', () => {
        const s = fullSnapshot();
        s.scoped = [scopedWin('Fable', 84, 2 * 24 * 60)];
        const kinds = buildSection(s, meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds, ['window', 'window', 'window', 'window', 'gauge', 'footer']);
    });

    it('renders every scoped entry in order (no cap), labelled by the API display name', () => {
        const s = fullSnapshot();
        s.scoped = [scopedWin('Fable', 84, 10), scopedWin('Opus', 20, 20)];
        const titles = buildSection(s, meta, NOW, theme).rows
            .filter(r => r.kind === 'window').map(r => r.title);
        assertDeepEqual(titles, ['Session', 'Weekly', 'Sonnet only', 'Fable', 'Opus']);
    });

    it('scoped row: pct, high→orange, and a weekly pace marker (elapsedPct)', () => {
        const s = fullSnapshot();
        s.scoped = [scopedWin('Fable', 84, 2 * 24 * 60)];
        const r = buildSection(s, meta, NOW, theme).rows[3];
        assertEqual(r.icon, 'x-office-calendar-symbolic');
        assertEqual(r.pct, 84);
        assertEqual(r.color, theme.orange);
        const expected = calc({usagePct: 84, reset: s.scoped[0].resetsAt, now: NOW, windowMs: WEEKLY_MS}).elapsedPct;
        assertEqual(r.elapsedPct, expected);
    });

    it('label is kept verbatim while the reset subtitle routes through _()', () => {
        const s = fullSnapshot();
        s.scoped = [scopedWin('Fable', 84, 90)];
        const r = buildSection(s, meta, NOW, theme, t => `«${t}»`).rows[3];
        assertEqual(r.title, 'Fable'); // brand/model label: not translated
        // prose + countdown routed; the clock is locale data, not translated
        assertEqual(r.subtitle, `«Resets in «1h 30m» · ${resetClock(s.scoped[0].resetsAt, NOW)}»`);
    });

    it('absent scoped → unchanged layout (no extra rows)', () => {
        const kinds = buildSection(fullSnapshot(), meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds, ['window', 'window', 'window', 'gauge', 'footer']);
    });
});

describe('buildSection: http-error icon/color split', () => {
    function errorRow(code, body) {
        const m = {stale: true, lastError: {code, body}, fetchedAt: NOW};
        return buildSection(fullSnapshot(), m, NOW, theme).rows.find(r => r.kind === 'http-error');
    }

    it('429 → client icon in orange', () => {
        const r = errorRow(429, 'rate limited');
        assertEqual(r.icon, 'dialog-warning-symbolic');
        assertEqual(r.color, theme.orange);
        assertEqual(r.code, 429);
    });

    it('503 → server icon in red', () => {
        const r = errorRow(503, 'service unavailable');
        assertEqual(r.icon, 'dialog-error-symbolic');
        assertEqual(r.color, theme.red);
    });

    it('500 (lower edge) → server icon', () =>
        assertEqual(errorRow(500, 'boom').icon, 'dialog-error-symbolic'));

    it('499 (upper client edge) → client icon', () =>
        assertEqual(errorRow(499, 'odd').icon, 'dialog-warning-symbolic'));

    it('wraps the error body to the section width', () =>
        assertEqual(Array.isArray(errorRow(500, 'a b c').lines), true));
});

describe('buildSection: footer pinned to fetchedAt', () => {
    it('shows HH:MM of fetchedAt (not now)', () => {
        const fetchedAt = new Date(NOW.getTime() - 47 * MIN);
        const m = {stale: false, lastError: null, fetchedAt};
        const footer = buildSection(fullSnapshot(), m, NOW, theme).rows.at(-1);
        assertEqual(footer.kind, 'footer');
        assertEqual(footer.updated, localTimeHm(fetchedAt));
    });

    it('shows - when fetchedAt is null', () => {
        const m = {stale: false, lastError: null, fetchedAt: null};
        const footer = buildSection(fullSnapshot(), m, NOW, theme).rows.at(-1);
        assertEqual(footer.updated, '-');
    });
});

describe('buildSection: elapsedPct marker data', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};
    const model = buildSection(fullSnapshot(), meta, NOW, theme);

    it('session row elapsedPct equals calc().elapsedPct', () => {
        const r = model.rows[0];
        const expected = calc({usagePct: 62, reset: win(62, 90).resetsAt, now: NOW, windowMs: SESSION_MS}).elapsedPct;
        assertEqual(r.elapsedPct, expected);
    });

    it('weekly row elapsedPct equals calc().elapsedPct', () => {
        const r = model.rows[1];
        const expected = calc({usagePct: 80, reset: win(80, 3 * 24 * 60).resetsAt, now: NOW, windowMs: WEEKLY_MS}).elapsedPct;
        assertEqual(r.elapsedPct, expected);
    });

    it('sonnet row (no window length) omits elapsedPct', () => {
        const r = model.rows[2];
        assertEqual(r.title, 'Sonnet only');
        assertEqual(Object.hasOwn(r, 'elapsedPct'), false);
    });

    it('windowed row carries paceColor: base from pct, tail from the verdict', () => {
        // weekly 80% used with 4 of 7 days gone (high→orange base) projects
        // 140%: critical → red overshoot colour.
        const r = model.rows[1];
        assertEqual(r.color, theme.orange);
        assertEqual(r.paceColor, theme.red);
    });

    it('markerless row (sonnet) has no paceColor → single-colour bar preserved', () => {
        assertEqual(Object.hasOwn(model.rows[2], 'paceColor'), false);
    });
});

describe('buildSection: injected translator', () => {
    // A fake translator wraps each string so we can prove the labels route
    // through `_()` (not hard-coded). The countdown is wrapped too, since the
    // builder threads the same translator into formatCountdown.
    const T = (s) => `«${s}»`;
    const meta = {stale: true, lastError: {code: 503, body: 'down'}, fetchedAt: NOW};
    const model = buildSection(fullSnapshot(), meta, NOW, theme, T);

    it('routes the header title (with the plan kept verbatim)', () =>
        assertEqual(model.title, '«Claude Max 5x»'));

    it('routes the window title', () =>
        assertEqual(model.rows[0].title, '«Session»'));

    it('routes the "Resets in" subtitle and the countdown', () =>
        assertEqual(model.rows[0].subtitle, `«Resets in «1h 30m» · ${resetClock(fullSnapshot().session.resetsAt, NOW)}»`));

    it('routes the gauge sub-line', () =>
        assertEqual(model.rows[3].subLine, '«Limit: $50.00»'));

    it('routes the HTTP status label', () =>
        assertEqual(model.rows.find(r => r.kind === 'http-error').status, '«HTTP 503»'));

    it('routes the footer "Updated" text', () =>
        assertEqual(model.rows.at(-1).text, `«Updated ${localTimeHm(NOW)}»`));
});

describe('wrapWords: greedy word wrap', () => {
    it('packs words and breaks at the width boundary', () =>
        assertDeepEqual(wrapWords('one two three four five', 13),
            ['one two three', 'four five']));

    it('keeps an over-long word on its own line', () =>
        assertDeepEqual(wrapWords('supercalifragilisticexpialidocious', 10),
            ['supercalifragilisticexpialidocious']));

    it('collapses interior whitespace', () =>
        assertDeepEqual(wrapWords('a   b', 35), ['a b']));

    it('empty string → []', () => assertDeepEqual(wrapWords('', 35), []));

    it('whitespace-only → []', () => assertDeepEqual(wrapWords('   \t  ', 35), []));
});

describe('buildSection: resets', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};
    const later = new Date(NOW.getTime() + 3 * 24 * 60 * MIN);
    const sooner = new Date(NOW.getTime() + 90 * MIN);
    const past = new Date(NOW.getTime() - 60 * MIN);

    function withResets(resets) {
        return {...fullSnapshot(), extra: null, resets};
    }

    function resetRows(model) {
        const start = model.rows.findIndex(r => r.kind === 'group-heading');
        if (start < 0)
            return [];
        const rows = [model.rows[start]];
        for (const r of model.rows.slice(start + 1).filter(row => row.kind === 'text'))
            rows.push(r);
        return rows;
    }

    it('no grants → no heading and no reset rows', () => {
        const model = buildSection(withResets([]), meta, NOW, theme);
        assertEqual(model.rows.some(r => r.kind === 'group-heading'), false);
        assertEqual(model.rows.some(r => r.kind === 'text'), false);
    });

    it('a snapshot without the resets field renders no reset rows', () => {
        const model = buildSection(fullSnapshot(), meta, NOW, theme);
        assertEqual(model.rows.some(r => r.kind === 'group-heading'), false);
    });

    it('a Resets heading, then one line per grant sorted by expiry', () => {
        const model = buildSection(withResets([
            {label: 'Later', resetsLeft: 1, endsAt: later},
            {label: 'Sooner', resetsLeft: 2, endsAt: sooner},
        ]), meta, NOW, theme);
        const rows = resetRows(model);
        assertDeepEqual(rows[0], {kind: 'group-heading', label: 'Resets'});
        assertDeepEqual(rows[1], {kind: 'text', text: 'Sooner', subtitle: `Expires ${localDateHm(sooner)} (${formatCountdown(sooner, NOW)})`});
        assertDeepEqual(rows[2], {kind: 'text', text: 'Later', subtitle: `Expires ${localDateHm(later)} (${formatCountdown(later, NOW)})`});
    });

    it('no ends_at reads "No expiry reported" and sorts first', () => {
        const model = buildSection(withResets([
            {label: 'Dated', resetsLeft: 1, endsAt: later},
            {label: 'Open', resetsLeft: 1, endsAt: null},
        ]), meta, NOW, theme);
        const rows = resetRows(model);
        assertDeepEqual(rows[1], {kind: 'text', text: 'Open', subtitle: 'No expiry reported'});
    });

    it('an expiry in the past reads "Expired <date>"', () => {
        const model = buildSection(withResets([{label: 'Old', resetsLeft: 1, endsAt: past}]), meta, NOW, theme);
        assertEqual(resetRows(model)[1].subtitle, `Expired ${localDateHm(past)}`);
    });

    it('a grant without a label shows the capitalized expiry alone', () => {
        const model = buildSection(withResets([{label: null, resetsLeft: 1, endsAt: null}]), meta, NOW, theme);
        assertEqual(resetRows(model)[1].text, 'No expiry reported');
    });

    it('reset rows come before the footer', () => {
        const model = buildSection(withResets([{label: 'X', resetsLeft: 1, endsAt: later}]), meta, NOW, theme);
        assertEqual(model.rows[model.rows.length - 1].kind, 'footer');
        assertEqual(model.rows[model.rows.length - 2].kind, 'text');
    });

    it('translates the heading and expiry through the injected translator', () => {
        const tr = s => `<${s}>`;
        const model = buildSection(withResets([{label: 'X', resetsLeft: 1, endsAt: null}]), meta, NOW, theme, tr);
        const rows = resetRows(model);
        assertEqual(rows[0].label, '<Resets>');
        assertEqual(rows[1].subtitle, '<no expiry reported>');
    });
});

describe('buildSection: pace footnote', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};

    it('paced windows carry a footnote; the unpaced Sonnet row does not', () => {
        const rows = buildSection(fullSnapshot(), meta, NOW, theme).rows;
        assertEqual(typeof rows[0].paceFootnote, 'string');
        assertEqual(rows[0].paceFootnote.includes('elapsed'), true);
        assertEqual('paceFootnote' in rows[2], false);
    });

    it('a weekly window a few minutes old reads Estimating…', () => {
        const snap = {...fullSnapshot(), weekly: {utilizationPct: 7, resetsAt: new Date(NOW.getTime() + WEEKLY_MS - 5 * MIN)}};
        const weekly = buildSection(snap, meta, NOW, theme).rows[1];
        assertEqual(weekly.paceFootnote, 'Estimating…');
        assertEqual(weekly.paceGlyph, '');
    });
});

describe('buildSection: Claude Code sessions', () => {
    const at = new Date('2026-06-05T11:59:30Z');
    const session = (usage, extra = {}) => ({
        sessionId: 'abcdef1234567890', title: null, project: 'ai-usagebar', model: 'claude-opus-5',
        lastActive: at, usage, ...extra,
    });
    const tokens = (inputTokens, windowTokens) => ({
        state: 'tokens', inputTokens, windowTokens, percent: windowTokens ? Math.floor(inputTokens * 100 / windowTokens) : null,
    });
    const build = scan => buildSection(fullSnapshot(), {stale: false, lastError: null, fetchedAt: NOW, sessions: scan}, NOW, theme);
    const sessionRows = model => model.rows.filter(r => r.kind === 'grouped');
    const fmt = n => new Intl.NumberFormat().format(n);

    it('no scan (option off) → no Sessions heading', () => {
        const model = buildSection(fullSnapshot(), {stale: false, lastError: null, fetchedAt: NOW}, NOW, theme);
        assertEqual(model.rows.some(r => r.kind === 'group-heading'), false);
        assertEqual(model.rows.some(r => r.kind === 'spacer'), false);
    });

    it('a spacer, the heading, then one grouped row per session', () => {
        const model = build({sessions: [session(tokens(50000, 200000))], discovered: 1, error: null});
        const i = model.rows.findIndex(r => r.kind === 'spacer');
        assertEqual(i >= 0, true);
        assertDeepEqual(model.rows[i + 1], {kind: 'group-heading', label: 'Sessions'});
        const [row] = sessionRows(model);
        assertEqual(row.label, 'ai-usagebar · session abcdef12');
        assertEqual(row.valueText, '25%');
        assertEqual(row.pct, 25);
        assertEqual(row.detail, `${fmt(50000)} / ${fmt(200000)} tokens · claude-opus-5 · last active ${localTimeHms(at)}`);
        assertEqual(row.color, theme.green);
    });

    it('a title replaces the session id; 90% is critical; over 100% shows 100%', () => {
        const model = build({sessions: [
            session(tokens(180000, 200000), {title: 'release prep'}),
            session(tokens(300000, 200000)),
        ], discovered: 2, error: null});
        const [a, b] = sessionRows(model);
        assertEqual(a.label, 'ai-usagebar · release prep');
        assertEqual(a.severity, 'critical');
        assertEqual(a.color, theme.red);
        assertEqual(b.valueText, '100%');
        assertEqual(b.pct, 100);
    });

    it('no window configured → raw tokens, no %', () => {
        const [row] = sessionRows(build({sessions: [session(tokens(5000, null))], discovered: 1, error: null}));
        assertEqual(row.valueText, `${fmt(5000)} tokens`);
        assertEqual(row.pct, 0);
        assertEqual(row.detail.startsWith('window size is not configured · claude-opus-5'), true);
    });

    it('compacted and unknown states; a missing model and project', () => {
        const rows = sessionRows(build({sessions: [
            session({state: 'compacted'}),
            session({state: 'unknown'}, {model: null, project: null}),
        ], discovered: 2, error: null}));
        assertEqual(rows[0].valueText, 'compacted');
        assertEqual(rows[0].detail.startsWith('compacted · waiting for the next response'), true);
        assertEqual(rows[1].valueText, 'unknown');
        assertEqual(rows[1].detail.startsWith('context usage unavailable · unknown model'), true);
        assertEqual(rows[1].label.startsWith('unknown project · '), true);
    });

    it('at most 8 rows, then "… and N more sessions"', () => {
        const many = Array.from({length: 8}, (_, i) => session(tokens(i, 100), {sessionId: `id-${i}`}));
        const model = build({sessions: many, discovered: 30, error: null});
        assertEqual(sessionRows(model).length, 8);
        assertEqual(model.rows.some(r => r.text === '… and 22 more sessions'), true);
        const one = build({sessions: many, discovered: 9, error: null});
        assertEqual(one.rows.some(r => r.text === '… and 1 more session'), true);
    });

    it('rows are keyed by session id', () => {
        const rows = sessionRows(build({sessions: [
            session(tokens(1, 100), {sessionId: 'one', title: 'same'}),
            session(tokens(1, 100), {sessionId: 'two', title: 'same'}),
        ], discovered: 2, error: null}));
        assertEqual(rows[0].key === rows[1].key, false);
    });

    it('no sessions or a scan error → a dim line under the heading', () => {
        assertEqual(build({sessions: [], discovered: 0, error: null}).rows.some(r => r.text === 'no recent Claude Code sessions'), true);
        assertEqual(build({sessions: [], discovered: 0, error: 'cannot read /x: nope'}).rows.some(r => r.text === 'cannot read /x: nope'), true);
    });
});

describe('buildSection: Ultra without a five-hour limit', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};
    const model = buildSection({...fullSnapshot(), plan: 'Ultra', session: null}, meta, NOW, theme);
    const titles = model.rows.filter(r => r.kind === 'window').map(r => r.title);

    it('has no Session row', () => assertEqual(titles.includes('Session'), false));
    it('leads with the weekly window', () => assertEqual(titles[0], 'Weekly'));
    it('titles the plan Claude Ultra', () => assertEqual(model.title, 'Claude Ultra'));
});

describe('buildSection: extra usage status and credits', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};
    const gauge = (model, title) => model.rows.find(r => r.kind === 'gauge' && r.title === title);
    const texts = model => model.rows.filter(r => r.kind === 'text').map(r => r.text);

    it('an active extra usage has no note', () => {
        const m = buildSection({...fullSnapshot(), extra: {limitCents: 5000, spentCents: 2500, status: 'active'}}, meta, NOW, theme);
        assertEqual(gauge(m, 'Extra usage').subLine, 'Limit: $50.00');
    });

    it('each provider-disabled state appends its reason', () => {
        for (const [status, note] of [['out-of-credits', 'out of credits'], ['monthly-limit-reached', 'monthly limit reached'], ['unavailable', 'currently unavailable']]) {
            const m = buildSection({...fullSnapshot(), extra: {limitCents: 5000, spentCents: 5000, status}}, meta, NOW, theme);
            assertEqual(gauge(m, 'Extra usage').subLine, `Limit: $50.00 · ${note}`, status);
        }
    });

    it('the reason also follows an uncapped spend', () => {
        const m = buildSection({...fullSnapshot(), extra: {limitCents: null, spentCents: 900, status: 'out-of-credits'}}, meta, NOW, theme);
        assertEqual(gauge(m, 'Extra usage').subLine, 'Limit: none reported · out of credits');
    });

    it('cloud session credits: remaining as the value, the spent share as the bar', () => {
        const expiresAt = new Date(NOW.getTime() + 3 * 24 * 60 * MIN);
        const m = buildSection({...fullSnapshot(), cloudCredits: {limitCents: 25000, remainingCents: 15000, expiresAt, locked: false}}, meta, NOW, theme);
        const row = gauge(m, 'Cloud session credits');
        assertEqual(row.value, '$150.00');
        assertEqual(row.pct, 40);
        assertEqual(row.subLine, `$100.00 of $250.00 used (40%) · expires ${localDateHm(expiresAt)} (${formatCountdown(expiresAt, NOW)})`);
    });

    it('locked credits say so; no expiry says so too', () => {
        const m = buildSection({...fullSnapshot(), cloudCredits: {limitCents: 25000, remainingCents: 25000, expiresAt: null, locked: true}}, meta, NOW, theme);
        assertEqual(gauge(m, 'Cloud session credits').subLine, '$0.00 of $250.00 used (0%) · no expiry reported · locked');
    });

    it('a remaining above the limit is the headline as sent, the bar empty', () => {
        const m = buildSection({...fullSnapshot(), cloudCredits: {limitCents: 25000, remainingCents: 30000, expiresAt: null, locked: false}}, meta, NOW, theme);
        assertEqual(gauge(m, 'Cloud session credits').value, '$300.00');
        assertEqual(gauge(m, 'Cloud session credits').pct, 0);
    });

    it('usage credits list the balance and auto-reload only when reported', () => {
        const on = buildSection({...fullSnapshot(), usageCredits: {amountMinor: 750, decimalPlaces: 2, currency: 'USD', autoReload: true}}, meta, NOW, theme);
        assertEqual(texts(on).join('|').includes('Usage credits|balance: $7.50|auto-reload: on'), true);
        const unknown = buildSection({...fullSnapshot(), usageCredits: {amountMinor: 500, decimalPlaces: 0, currency: 'KRW', autoReload: null}}, meta, NOW, theme);
        assertEqual(texts(unknown).some(t => t.startsWith('auto-reload')), false);
        assertEqual(texts(unknown).includes('balance: 500 KRW'), true);
    });

    it('order: windows, extra usage, cloud credits, usage credits', () => {
        const m = buildSection({...fullSnapshot(), extra: {limitCents: 5000, spentCents: 2500, status: 'active'},
            cloudCredits: {limitCents: 25000, remainingCents: 25000, expiresAt: null, locked: false},
            usageCredits: {amountMinor: 750, decimalPlaces: 2, currency: 'USD', autoReload: null}}, meta, NOW, theme);
        const order = m.rows.map(r => r.title ?? r.text).filter(t => ['Extra usage', 'Cloud session credits', 'Usage credits'].includes(t));
        assertEqual(order.join(','), 'Extra usage,Cloud session credits,Usage credits');
    });

    it('no credits blocks, no credit rows', () => {
        const m = buildSection(fullSnapshot(), meta, NOW, theme);
        assertEqual(gauge(m, 'Cloud session credits'), undefined);
        assertEqual(texts(m).includes('Usage credits'), false);
    });
});

system.exit(summary());

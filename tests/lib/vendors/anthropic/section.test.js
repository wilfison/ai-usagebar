import system from 'system';

import {buildSection, wrapWords} from '../../../../lib/vendors/anthropic/section.js';
import {SESSION_MS, WEEKLY_MS} from '../../../../lib/vendors/anthropic/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {localTimeHm} from '../../../../lib/format.js';
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

const PACE_GLYPHS = ['↑', '→', '↓'];

describe('buildSection — full snapshot', () => {
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

describe('buildSection — omissions', () => {
    const meta = {stale: false, lastError: null, fetchedAt: NOW};

    it('omits sonnet when absent', () => {
        const s = fullSnapshot();
        s.sonnet = null;
        const kinds = buildSection(s, meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds, ['window', 'window', 'gauge', 'footer']);
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

describe('buildSection — http-error icon/color split', () => {
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

describe('buildSection — footer pinned to fetchedAt', () => {
    it('shows HH:MM of fetchedAt (not now)', () => {
        const fetchedAt = new Date(NOW.getTime() - 47 * MIN);
        const m = {stale: false, lastError: null, fetchedAt};
        const footer = buildSection(fullSnapshot(), m, NOW, theme).rows.at(-1);
        assertEqual(footer.kind, 'footer');
        assertEqual(footer.updated, localTimeHm(fetchedAt));
    });

    it('shows — when fetchedAt is null', () => {
        const m = {stale: false, lastError: null, fetchedAt: null};
        const footer = buildSection(fullSnapshot(), m, NOW, theme).rows.at(-1);
        assertEqual(footer.updated, '—');
    });
});

describe('buildSection — elapsedPct marker data', () => {
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
});

describe('buildSection — injected translator', () => {
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
        assertEqual(model.rows[0].subtitle, '«Resets in «1h 30m»»'));

    it('routes the gauge sub-line', () =>
        assertEqual(model.rows[3].subLine, '«Limit: $50.00»'));

    it('routes the HTTP status label', () =>
        assertEqual(model.rows.find(r => r.kind === 'http-error').status, '«HTTP 503»'));

    it('routes the footer "Updated" text', () =>
        assertEqual(model.rows.at(-1).text, `«Updated ${localTimeHm(NOW)}»`));
});

describe('wrapWords — greedy word wrap', () => {
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

system.exit(summary());

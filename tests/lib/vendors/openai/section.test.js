import system from 'system';

import {buildSection} from '../../../../lib/vendors/openai/section.js';
import {SESSION_MS, WEEKLY_MS} from '../../../../lib/vendors/openai/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const MIN = 60 * 1000;

function win(pct, mins, windowMs) {
    return {utilizationPct: pct, resetsAt: new Date(NOW.getTime() + mins * MIN), windowMs};
}

function base() {
    return {
        plan: 'ChatGPT Plus',
        session: win(1, 90, SESSION_MS),
        weekly: win(0, 3 * 24 * 60, WEEKLY_MS),
        codeReview: null,
        credits: null,
    };
}

const META = {stale: false, lastError: null, fetchedAt: NOW};

describe('buildSection (openai)', () => {
    it('uses the plan as the title and shows the two Codex windows', () => {
        const m = buildSection(base(), META, NOW, theme);
        assertEqual(m.title, 'ChatGPT Plus');
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'footer']);
        assertEqual(m.rows[0].title, 'Codex 5h');
        assertEqual(m.rows[1].title, 'Codex weekly');
    });

    it('adds a code-review window when present', () => {
        const s = base();
        s.codeReview = win(20, 4 * 24 * 60, WEEKLY_MS);
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'window', 'footer']);
        assertEqual(m.rows[2].title, 'Code review (weekly)');
    });

    it('renders a credits block (text rows, no bar) with message ranges', () => {
        const s = base();
        s.credits = {balance: '$5.00', hasCredits: true, unlimited: false,
            approxLocalMessages: [100, 200], approxCloudMessages: [30, 50]};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind),
            ['window', 'window', 'text', 'text', 'text', 'text', 'footer']);
        assertEqual(m.rows[2].text, 'Credits');
        assertEqual(m.rows[3].text, 'balance: $5.00');
        assertEqual(m.rows[4].text, '~ 100-200 local messages');
        assertEqual(m.rows[5].text, '~ 30-50 cloud messages');
    });

    it('shows unlimited credits without message lines', () => {
        const s = base();
        s.credits = {balance: '$0.00', hasCredits: false, unlimited: true,
            approxLocalMessages: null, approxCloudMessages: null};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'text', 'text', 'footer']);
        assertEqual(m.rows[3].text, 'balance: unlimited');
    });

    it('appends an http-error row before the footer', () => {
        const meta = {stale: true, lastError: {code: 503, body: 'upstream down'}, fetchedAt: NOW};
        const m = buildSection(base(), meta, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'http-error', 'footer']);
        assertEqual(m.rows[2].code, 503);
    });

    it('window rows carry elapsedPct equal to calc().elapsedPct', () => {
        const m = buildSection(base(), META, NOW, theme);
        const expected = calc({usagePct: 1, reset: win(1, 90, SESSION_MS).resetsAt, now: NOW, windowMs: SESSION_MS}).elapsedPct;
        assertEqual(m.rows[0].elapsedPct, expected);
    });
});

describe('buildSection (openai) — injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes the Codex window titles and the credits block', () => {
        const s = base();
        s.credits = {balance: '$5.00', hasCredits: true, unlimited: false,
            approxLocalMessages: [100, 200], approxCloudMessages: [30, 50]};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[0].title, '«Codex 5h»');
        assertEqual(m.rows[2].text, '«Credits»');
        assertEqual(m.rows[3].text, '«balance: $5.00»');
        assertEqual(m.rows[4].text, '«~ 100-200 local messages»');
        assertEqual(m.rows[5].text, '«~ 30-50 cloud messages»');
    });

    it('routes the "unlimited" credits label', () => {
        const s = base();
        s.credits = {balance: '$0.00', hasCredits: false, unlimited: true,
            approxLocalMessages: null, approxCloudMessages: null};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[3].text, '«balance: «unlimited»»');
    });
});

system.exit(summary());

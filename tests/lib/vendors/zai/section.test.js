import system from 'system';

import {buildSection} from '../../../../lib/vendors/zai/section.js';
import {SESSION_MS, WEEKLY_MS, MCP_MS} from '../../../../lib/vendors/zai/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const MIN = 60 * 1000;

function win(pct, mins, windowMs) {
    return {utilizationPct: pct, resetsAt: new Date(NOW.getTime() + mins * MIN), windowMs};
}

const META = {stale: false, lastError: null, fetchedAt: NOW};

describe('buildSection (zai)', () => {
    it('renders all present windows in order', () => {
        const s = {
            plan: 'GLM Coding Pro',
            session: win(42, 120, SESSION_MS),
            weekly: win(15, 3 * 24 * 60, WEEKLY_MS),
            mcp: win(5, 20 * 24 * 60, MCP_MS),
        };
        const m = buildSection(s, META, NOW, theme);
        assertEqual(m.title, 'GLM Coding Pro');
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'window', 'footer']);
        assertEqual(m.rows[0].title, 'Session (5h)');
        assertEqual(m.rows[1].title, 'Weekly');
        assertEqual(m.rows[2].title, 'MCP tools (monthly)');
    });

    it('shows a message row when all windows are absent', () => {
        const s = {plan: 'GLM Coding Unknown', session: null, weekly: null, mcp: null};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['text', 'footer']);
        assertEqual(m.rows[0].text, 'no usage windows reported');
    });

    it('appends an http-error row before the footer', () => {
        const s = {plan: 'GLM Coding Pro', session: win(42, 120, SESSION_MS), weekly: null, mcp: null};
        const meta = {stale: true, lastError: {code: 401, body: 'Unauthorized'}, fetchedAt: NOW};
        const m = buildSection(s, meta, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'http-error', 'footer']);
        assertEqual(m.rows[1].code, 401);
    });

    it('window rows carry elapsedPct equal to calc().elapsedPct', () => {
        const s = {plan: 'GLM Coding Pro', session: win(42, 120, SESSION_MS), weekly: null, mcp: null};
        const m = buildSection(s, META, NOW, theme);
        const expected = calc({usagePct: 42, reset: win(42, 120, SESSION_MS).resetsAt, now: NOW, windowMs: SESSION_MS}).elapsedPct;
        assertEqual(m.rows[0].elapsedPct, expected);
    });
});

describe('buildSection (zai) — injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes the present window titles', () => {
        const s = {plan: 'GLM Coding Pro', session: win(42, 120, SESSION_MS), weekly: null, mcp: null};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[0].title, '«Session (5h)»');
    });

    it('routes the "no usage windows" message', () => {
        const s = {plan: 'GLM Coding Unknown', session: null, weekly: null, mcp: null};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[0].text, '«no usage windows reported»');
    });
});

system.exit(summary());

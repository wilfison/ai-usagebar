import system from 'system';

import {buildSection} from '../../../../lib/vendors/kimi/section.js';
import {WEEKLY_MS, WINDOW_MS} from '../../../../lib/vendors/kimi/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const MIN = 60 * 1000;
const META = {stale: false, lastError: null, fetchedAt: NOW};

function block(used, limit, mins) {
    return {limit, used, remaining: Math.max(0, limit - used), resetAt: mins === null ? null : new Date(NOW.getTime() + mins * MIN)};
}

function fullSnapshot() {
    return {
        plan: 'LEVEL_PRO',
        weekly: block(42, 100, 3 * 24 * 60),
        window: block(80, 100, 90),
    };
}

describe('buildSection (kimi)', () => {
    it('renders weekly + 5h window, titled by the brand + plan', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        assertEqual(m.title, 'Kimi LEVEL_PRO');
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'footer']);
        assertEqual(m.rows[0].title, 'Weekly');
        assertEqual(m.rows[0].pct, 42);
        assertEqual(m.rows[1].title, 'Window (5h)');
        assertEqual(m.rows[1].pct, 80);
    });

    it('omits the 5h window row when the window is absent (zeroed)', () => {
        const s = fullSnapshot();
        s.window = {limit: 0, used: 0, remaining: 0, resetAt: null};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'footer']);
        assertEqual(m.rows[0].title, 'Weekly');
    });

    it('titles with just the brand when the plan is null', () => {
        const s = fullSnapshot();
        s.plan = null;
        assertEqual(buildSection(s, META, NOW, theme).title, 'Kimi');
    });

    it('appends an http-error row before the footer', () => {
        const meta = {stale: true, lastError: {code: 401, body: 'Kimi authentication failed'}, fetchedAt: NOW};
        const m = buildSection(fullSnapshot(), meta, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'http-error', 'footer']);
        assertEqual(m.rows[2].code, 401);
    });

    it('window rows carry elapsedPct + paceColor (bicolor bar data)', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        const expected = calc({usagePct: 80, reset: fullSnapshot().window.resetAt, now: NOW, windowMs: WINDOW_MS}).elapsedPct;
        assertEqual(m.rows[1].elapsedPct, expected);
        assertEqual(typeof m.rows[1].paceColor, 'string');
    });

    it('weekly row uses the weekly window length for the marker', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        const expected = calc({usagePct: 42, reset: fullSnapshot().weekly.resetAt, now: NOW, windowMs: WEEKLY_MS}).elapsedPct;
        assertEqual(m.rows[0].elapsedPct, expected);
    });
});

describe('buildSection (kimi) — injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes window titles + reset prose; the brand stays verbatim', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme, T);
        assertEqual(m.rows[0].title, '«Weekly»');
        assertEqual(m.rows[1].title, '«Window (5h)»');
        assertEqual(m.title, '«Kimi LEVEL_PRO»'); // "Kimi %s" literal routed; plan kept verbatim
        assertEqual(m.rows[0].subtitle.startsWith('«Resets in '), true);
    });
});

system.exit(summary());

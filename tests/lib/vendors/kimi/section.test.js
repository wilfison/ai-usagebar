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

function block(utilizationPct, windowMs, mins) {
    return {utilizationPct, resetsAt: mins === null ? null : new Date(NOW.getTime() + mins * MIN), windowMs};
}

function fullSnapshot() {
    return {
        plan: 'LEVEL_PRO',
        weekly: block(42, WEEKLY_MS, 3 * 24 * 60),
        monthly: null,
        window: block(80, WINDOW_MS, 90),
    };
}

describe('buildSection (kimi)', () => {
    it('renders the 5h window then weekly, titled by the brand + plan', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        assertEqual(m.title, 'Kimi LEVEL_PRO');
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'footer']);
        assertEqual(m.rows[0].title, 'Window (5h)');
        assertEqual(m.rows[0].pct, 80);
        assertEqual(m.rows[1].title, 'Weekly');
        assertEqual(m.rows[1].pct, 42);
    });

    it('newer shape: 5h window then Monthly, no weekly, no pace on Monthly', () => {
        const s = fullSnapshot();
        s.weekly = null;
        s.monthly = {utilizationPct: 43, resetsAt: new Date(NOW.getTime() + 10 * 24 * 60 * MIN), windowMs: null};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.title ?? r.kind), ['Window (5h)', 'Monthly', 'footer']);
        assertEqual(m.rows[1].pct, 43);
        assertEqual(m.rows[1].paceGlyph, '');
        assertEqual(m.rows[1].elapsedPct, undefined);
        assertEqual(buildSection(s, META, NOW, theme, (t) => `«${t}»`).rows[1].title, '«Monthly»');
    });

    it('omits the 5h window row when the window is absent', () => {
        const s = fullSnapshot();
        s.window = null;
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
        // 60% used 40% into the window: critical, a red tail past the marker.
        const s = {...fullSnapshot(), window: block(60, WINDOW_MS, 180)};
        const m = buildSection(s, META, NOW, theme);
        const expected = calc({usagePct: 60, reset: s.window.resetsAt, now: NOW, windowMs: WINDOW_MS}).elapsedPct;
        assertEqual(m.rows[0].elapsedPct, expected);
        assertEqual(m.rows[0].paceColor, theme.red);
    });

    it('an over-pace tail the same colour as its base is left out', () => {
        // 80% used 70% into the window: over (orange) on an orange base.
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        assertEqual('paceColor' in m.rows[0], false);
    });

    it('weekly row uses the weekly window length for the marker', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme);
        const expected = calc({usagePct: 42, reset: fullSnapshot().weekly.resetsAt, now: NOW, windowMs: WEEKLY_MS}).elapsedPct;
        assertEqual(m.rows[1].elapsedPct, expected);
    });
});

describe('buildSection (kimi): injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes window titles + reset prose; the brand stays verbatim', () => {
        const m = buildSection(fullSnapshot(), META, NOW, theme, T);
        assertEqual(m.rows[0].title, '«Window (5h)»');
        assertEqual(m.rows[1].title, '«Weekly»');
        assertEqual(m.title, '«Kimi LEVEL_PRO»'); // "Kimi %s" literal routed; plan kept verbatim
        assertEqual(m.rows[0].subtitle.startsWith('«Resets in '), true);
    });
});

describe('buildSection (kimi): no pace footnote', () => {
    it('windows keep their glyph but carry no footnote', () => {
        const now = new Date('2026-06-05T12:00:00Z');
        const block = windowMs => ({utilizationPct: 30, resetsAt: new Date(now.getTime() + windowMs / 2), windowMs});
        const model = buildSection({plan: 'Moderato', window: block(WINDOW_MS), weekly: block(WEEKLY_MS), monthly: null},
            {stale: false, lastError: null, fetchedAt: now}, now, defaultTheme());
        for (const row of model.rows.filter(r => r.kind === 'window'))
            assertEqual('paceFootnote' in row, false);
    });
});

system.exit(summary());

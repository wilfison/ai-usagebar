import system from 'system';

import {buildSection} from '../../../../lib/vendors/custom/section.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {resetClock} from '../../../../lib/countdown.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const META = {stale: false, lastError: null, fetchedAt: NOW};
const HOUR = 3600 * 1000;

function snapshot() {
    return {
        plan: 'Team',
        metrics: [
            {label: 'Requests', pct: 12, amount: {used: 12, limit: 100, currency: null}, resetsAt: new Date(NOW.getTime() + HOUR), windowMs: 5 * HOUR},
            {label: 'Tokens', pct: 40, amount: null, resetsAt: new Date(NOW.getTime() + HOUR), windowMs: null},
            {label: 'Storage', pct: 5, amount: null, resetsAt: null, windowMs: 5 * HOUR},
        ],
        texts: [{label: 'Region', value: 'eu'}],
    };
}

describe('buildSection (custom)', () => {
    const m = buildSection(snapshot(), META, NOW, theme);

    it('one window row per metric, one text row per text, then the footer', () => {
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'window', 'text', 'footer']);
        assertEqual(m.title, 'Team');
        assertEqual(m.rows[0].title, 'Requests');
        assertEqual(m.rows[3].text, 'Region: eu');
    });

    it('the subtitle carries the footnote and the reset clock', () =>
        assertEqual(m.rows[0].subtitle, `12 of 100 · Resets in 1h 00m · ${resetClock(new Date(NOW.getTime() + HOUR), NOW)}`));

    it('pace only when both the reset and the window length are known', () => {
        assertEqual(typeof m.rows[0].elapsedPct, 'number');
        assertEqual(m.rows[1].elapsedPct, undefined);
        assertEqual(m.rows[1].paceGlyph, '');
        assertEqual(m.rows[2].elapsedPct, undefined);
        assertEqual(m.rows[2].subtitle, '');
    });

    it('falls back to a translated title without a plan', () => {
        const s = snapshot();
        s.plan = null;
        assertEqual(buildSection(s, META, NOW, theme, t => `«${t}»`).title, '«Custom provider»');
    });

    it('appends an http-error row before the footer', () => {
        const meta = {stale: true, lastError: {code: 500, body: 'down'}, fetchedAt: NOW};
        const kinds = buildSection(snapshot(), meta, NOW, theme).rows.map(r => r.kind);
        assertDeepEqual(kinds.slice(-2), ['http-error', 'footer']);
    });
});

system.exit(summary());

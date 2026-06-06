import system from 'system';

import {buildSection} from '../lib/vendors/openrouter-section.js';
import {combine} from '../lib/vendors/openrouter-parse.js';
import {defaultTheme} from '../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const META = {stale: false, lastError: null, fetchedAt: NOW};

function snap({label = 'prod', limit = 50, limitRemaining = 24.5, free = false} = {}) {
    return combine(
        {totalCredits: 100, totalUsage: 25.5},
        {label, limit, limitRemaining, usageDaily: 1, usageWeekly: 7, usageMonthly: 25.5, isFreeTier: free},
    );
}

describe('buildSection (openrouter)', () => {
    it('renders balance gauge + usage + per-key limit + tier', () => {
        const m = buildSection(snap(), META, NOW, theme);
        assertEqual(m.title, 'OpenRouter — prod');
        assertDeepEqual(m.rows.map(r => r.kind),
            ['gauge', 'text', 'text', 'text', 'text', 'text', 'footer']);
        assertEqual(m.rows[0].title, 'Balance');
        assertEqual(m.rows[0].value, '$74.50');
        assertEqual(m.rows[0].subLine, '$25.50 of $100.00 used (26%)');
        assertEqual(m.rows[1].text, 'Usage');
        assertEqual(m.rows[2].text, 'today $1.00 · week $7.00 · month $25.50');
        assertEqual(m.rows[3].text, 'Per-key limit');
        assertEqual(m.rows[4].text, '$24.50 of $50.00 remaining');
        assertEqual(m.rows[5].text, 'paid tier');
    });

    it('omits the per-key limit block when no limit', () => {
        const m = buildSection(snap({limit: null, limitRemaining: null}), META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['gauge', 'text', 'text', 'text', 'footer']);
        assertEqual(m.rows[3].text, 'paid tier');
    });

    it('shows free tier', () => {
        const m = buildSection(snap({free: true, limit: null, limitRemaining: null}), META, NOW, theme);
        assertEqual(m.rows.at(-2).text, 'free tier');
    });

    it('appends an http-error row before the footer', () => {
        const meta = {stale: true, lastError: {code: 503, body: 'down'}, fetchedAt: NOW};
        const m = buildSection(snap({limit: null, limitRemaining: null}), meta, NOW, theme);
        assertEqual(m.rows.at(-2).kind, 'http-error');
        assertEqual(m.rows.at(-2).code, 503);
    });
});

system.exit(summary());

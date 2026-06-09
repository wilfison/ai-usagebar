import system from 'system';

import {buildSection} from '../../../../lib/vendors/deepseek/section.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const META = {stale: false, lastError: null, fetchedAt: NOW};

describe('buildSection (deepseek)', () => {
    it('renders a no-bar balance gauge + availability', () => {
        const s = {isAvailable: true, balance: 5.5, granted: 5, toppedUp: 0.5, currency: 'USD'};
        const m = buildSection(s, META, NOW, theme);
        assertEqual(m.title, 'DeepSeek');
        assertDeepEqual(m.rows.map(r => r.kind), ['gauge', 'text', 'footer']);
        assertEqual(m.rows[0].pct, null);
        assertEqual(m.rows[0].value, '$5.50');
        assertEqual(m.rows[0].subLine, 'granted $5.00 · topped-up $0.50');
        assertEqual(m.rows[1].text, 'API available');
    });

    it('shows API unavailable', () => {
        const s = {isAvailable: false, balance: 0, granted: 0, toppedUp: 0, currency: ''};
        const m = buildSection(s, META, NOW, theme);
        assertEqual(m.rows[1].text, 'API unavailable');
    });

    it('appends an http-error row before the footer', () => {
        const s = {isAvailable: true, balance: 5, granted: 5, toppedUp: 0, currency: 'USD'};
        const meta = {stale: true, lastError: {code: 401, body: 'invalid api key'}, fetchedAt: NOW};
        const m = buildSection(s, meta, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['gauge', 'text', 'http-error', 'footer']);
        assertEqual(m.rows[2].code, 401);
    });
});

describe('buildSection (deepseek) — injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes the balance gauge + availability (brand title kept verbatim)', () => {
        const s = {isAvailable: true, balance: 5.5, granted: 5, toppedUp: 0.5, currency: 'USD'};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.title, 'DeepSeek');
        assertEqual(m.rows[0].title, '«Balance»');
        assertEqual(m.rows[0].subLine, '«granted $5.00 · topped-up $0.50»');
        assertEqual(m.rows[1].text, '«API available»');
    });
});

system.exit(summary());

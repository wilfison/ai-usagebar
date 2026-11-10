import system from 'system';

import {buildSection} from '../../../../lib/vendors/openrouter/section.js';
import {combine} from '../../../../lib/vendors/openrouter/parser.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {Severity, severityColor} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-06-05T12:00:00Z');
const META = {stale: false, lastError: null, fetchedAt: NOW};

function snap({label = 'prod', limit = 50, limitRemaining = 24.5, free = false} = {}) {
    return combine(
        {totalCredits: 100, totalUsage: 25.5},
        {label, limit, limitRemaining, usageDaily: 1, usageWeekly: 7, usageMonthly: 25.5, isFreeTier: free}
    );
}

describe('buildSection (openrouter)', () => {
    it('renders balance gauge + usage + per-key limit + tier', () => {
        const m = buildSection(snap(), META, NOW, theme);
        assertEqual(m.title, 'OpenRouter - prod');
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

    it('a negative balance renders as debt in the critical color', () => {
        const s = combine({totalCredits: 10, totalUsage: 15.71},
            {label: 'x', limit: null, limitRemaining: null, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, isFreeTier: false});
        const g = buildSection(s, META, NOW, theme).rows[0];
        assertEqual(g.value, '-$5.71');
        assertEqual(g.color, severityColor(Severity.CRITICAL, theme));
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

describe('buildSection (openrouter): injected translator', () => {
    const T = (s) => `«${s}»`;
    const m = buildSection(snap(), META, NOW, theme, T);

    it('routes the balance gauge title + sub-line', () => {
        assertEqual(m.rows[0].title, '«Balance»');
        assertEqual(m.rows[0].subLine, '«$25.50 of $100.00 used (26%)»');
    });

    it('routes the usage block', () => {
        assertEqual(m.rows[1].text, '«Usage»');
        assertEqual(m.rows[2].text, '«today $1.00 · week $7.00 · month $25.50»');
    });

    it('routes the per-key limit and tier labels', () => {
        assertEqual(m.rows[3].text, '«Per-key limit»');
        assertEqual(m.rows[4].text, '«$24.50 of $50.00 remaining»');
        assertEqual(m.rows[5].text, '«paid tier»');
    });
});


describe('buildSection (openrouter): recent models', () => {
    const withModels = models => ({...snap(), recentModels: models});

    it('a group with one line per model, spend and requests', () => {
        const m = buildSection(withModels([{name: 'gpt-5-codex', costUsd: 1.25, requests: 42}, {name: 'free-model', costUsd: 0, requests: 1}]), META, NOW, theme);
        const at = m.rows.findIndex(r => r.kind === 'group-heading');
        assertEqual(m.rows[at].label, 'Recent models');
        assertEqual(m.rows[at + 1].text, 'gpt-5-codex');
        assertEqual(m.rows[at + 1].subtitle, '$1.25 · 42 requests');
        assertEqual(m.rows[at + 2].subtitle, '1 request');
    });

    it('no models, no group', () => {
        assertEqual(buildSection(withModels([]), META, NOW, theme).rows.some(r => r.kind === 'group-heading'), false);
        assertEqual(buildSection(snap(), META, NOW, theme).rows.some(r => r.kind === 'group-heading'), false);
    });

    it('the translator and ngettext reach the group', () => {
        const ngettext = (one, many, n) => `<${n === 1 ? one : many}>`;
        const m = buildSection(withModels([{name: 'x', costUsd: 0, requests: 2}]), META, NOW, theme, s => `«${s}»`, ngettext);
        assertEqual(m.rows.find(r => r.kind === 'group-heading').label, '«Recent models»');
        assertEqual(m.rows.at(-2).subtitle, '<2 requests>');
    });
});

system.exit(summary());

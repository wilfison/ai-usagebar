import system from 'system';

import {buildSection} from '../../../../lib/vendors/ollama/section.js';
import {parseUsage} from '../../../../lib/vendors/ollama/parser.js';
import {defaultTheme} from '../../../../lib/theme.js';
import {describe, it, assertEqual, summary} from '../../../_assert.js';

const theme = defaultTheme();
const NOW = new Date('2026-10-08T17:00:00Z');
const META = {stale: false, lastError: null, fetchedAt: NOW};

const QUOTA = JSON.stringify({included: {
    session: {remaining_percent: 50, resets_at: '2026-10-08T19:00:00Z'},
    weekly: {remaining_percent: 80, resets_at: '2026-10-12T00:00:00Z'},
}});
const CREDITS = JSON.stringify({
    included: {balance_usd: 45, allowance_usd: 60, period: {from: '2026-10-08T08:00:00Z', until: '2026-11-08T08:00:00Z'}},
    purchased: {balance_usd: 12.5},
});

const texts = model => model.rows.filter(r => r.kind === 'text').map(r => r.text);
const windows = model => model.rows.filter(r => r.kind === 'window');

describe('buildSection (ollama): quota account', () => {
    const model = buildSection(parseUsage(QUOTA, 'Pro'), META, NOW, theme);

    it('titles with the plan', () => assertEqual(model.title, 'Ollama Pro'));
    it('one row per window, in order', () =>
        assertEqual(windows(model).map(r => r.title).join(','), 'Session,Weekly'));
    it('rows carry the countdown and the reset clock', () => {
        const [session] = windows(model);
        assertEqual(session.pct, 50);
        assertEqual(session.reset, '2h 00m');
        assertEqual(session.subtitle !== '', true);
    });
    it('windows are paced', () => {
        const [session] = windows(model);
        assertEqual(session.elapsedPct, 60);
        assertEqual(typeof session.paceFootnote, 'string');
    });
    it('no Breakdown, no Cost, no credits', () => {
        assertEqual(model.rows.some(r => r.kind === 'group-heading' || r.kind === 'grouped'), false);
        assertEqual(texts(model).some(t => t === 'Cost' || t === 'Credits'), false);
    });
    it('ends with the footer', () => assertEqual(model.rows.at(-1).kind, 'footer'));
});

describe('buildSection (ollama): credits account', () => {
    const model = buildSection(parseUsage(CREDITS), META, NOW, theme);

    it('falls back to the vendor name without a plan', () => assertEqual(model.title, 'Ollama'));
    it('shows the month only', () => assertEqual(windows(model).map(r => r.title).join(','), 'Monthly'));
    it('lists the remaining credits and the purchased ones', () => {
        const t = texts(model);
        assertEqual(t.includes('Credits'), true);
        assertEqual(t.includes('$45.00 remaining of $60.00'), true);
        assertEqual(t.includes('Purchased credits: $12.50'), true);
    });
    it('no purchased line without purchased credits', () => {
        const body = JSON.parse(CREDITS);
        delete body.purchased;
        const t = texts(buildSection(parseUsage(JSON.stringify(body)), META, NOW, theme));
        assertEqual(t.some(x => x.startsWith('Purchased')), false);
    });
    it('the translator reaches every string', () => {
        const wrapped = buildSection(parseUsage(CREDITS), META, NOW, theme, s => `«${s}»`);
        assertEqual(texts(wrapped).includes('«Credits»'), true);
    });
});

describe('buildSection (ollama): zero allowance', () => {
    const z = parseUsage(JSON.stringify({included: {balance_usd: 0, allowance_usd: 0,
        period: {from: '2026-10-01T00:00:00Z', until: '2026-11-01T00:00:00Z'}}}));
    const model = buildSection(z, META, NOW, theme);
    it('says no window is reported, still shows the balance', () => {
        assertEqual(texts(model).includes('no usage windows reported'), true);
        assertEqual(texts(model).includes('$0.00 remaining of $0.00'), true);
    });
});

system.exit(summary());

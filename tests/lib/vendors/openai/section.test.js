import system from 'system';

import {buildSection, groupThousands} from '../../../../lib/vendors/openai/section.js';
import {SESSION_MS, WEEKLY_MS} from '../../../../lib/vendors/openai/parser.js';
import {calc} from '../../../../lib/pacing.js';
import {localDateHm, format as formatCountdown} from '../../../../lib/countdown.js';
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

    it('renders a credits block as a grouped count, without message estimates', () => {
        const s = base();
        s.credits = {balance: '62500', hasCredits: true, unlimited: false,
            approxLocalMessages: [100, 200], approxCloudMessages: [30, 50]};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'text', 'text', 'footer']);
        assertEqual(m.rows[2].text, 'Credits');
        assertEqual(m.rows[3].text, 'balance: 62,500');
    });

    it('groups thousands only on plain numbers', () => {
        assertEqual(groupThousands('62500'), '62,500');
        assertEqual(groupThousands('1234567.25'), '1,234,567.25');
        assertEqual(groupThousands('-1234'), '-1,234');
        assertEqual(groupThousands('999'), '999');
        assertEqual(groupThousands(''), '');
        assertEqual(groupThousands('lots'), 'lots');
    });

    it('shows unlimited credits without message lines', () => {
        const s = base();
        s.credits = {balance: '$0.00', hasCredits: false, unlimited: true,
            approxLocalMessages: null, approxCloudMessages: null};
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'window', 'text', 'text', 'footer']);
        assertEqual(m.rows[3].text, 'balance: unlimited');
    });

    it('names an absent session window as not reported (weekly-only response)', () => {
        const s = base();
        s.session = null;
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['text', 'window', 'footer']);
        assertEqual(m.rows[0].text, 'Codex 5h: not reported');
        assertEqual(m.rows[0].tone, 'dim');
        assertEqual(m.rows[1].title, 'Codex weekly');
    });

    it('names an absent weekly window as not reported', () => {
        const s = base();
        s.weekly = null;
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['window', 'text', 'footer']);
        assertEqual(m.rows[0].title, 'Codex 5h');
        assertEqual(m.rows[1].text, 'Codex weekly: not reported');
        assertEqual(buildSection(s, META, NOW, theme, t => `«${t}»`).rows[1].text, '«Codex weekly: not reported»');
    });

    it('says no usage windows were reported when both are absent', () => {
        const s = base();
        s.session = null;
        s.weekly = null;
        const m = buildSection(s, META, NOW, theme);
        assertDeepEqual(m.rows.map(r => r.kind), ['text', 'footer']);
        assertEqual(m.rows[0].text, 'no usage windows reported');
        assertEqual(buildSection(s, META, NOW, theme, (t) => `«${t}»`).rows[0].text, '«no usage windows reported»');
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

describe('buildSection (openai): injected translator', () => {
    const T = (s) => `«${s}»`;

    it('routes the Codex window titles and the credits block', () => {
        const s = base();
        s.credits = {balance: '5', hasCredits: true, unlimited: false,
            approxLocalMessages: [100, 200], approxCloudMessages: [30, 50]};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[0].title, '«Codex 5h»');
        assertEqual(m.rows[2].text, '«Credits»');
        assertEqual(m.rows[3].text, '«balance: 5»');
    });

    it('routes the "unlimited" credits label', () => {
        const s = base();
        s.credits = {balance: '$0.00', hasCredits: false, unlimited: true,
            approxLocalMessages: null, approxCloudMessages: null};
        const m = buildSection(s, META, NOW, theme, T);
        assertEqual(m.rows[3].text, '«balance: «unlimited»»');
    });
});

describe('buildSection (openai): reset credits', () => {
    const later = new Date(NOW.getTime() + 3 * 24 * 60 * MIN);
    const sooner = new Date(NOW.getTime() + 90 * MIN);
    const expires = d => `Expires ${localDateHm(d)} (${formatCountdown(d, NOW)})`;

    function withResets(resetCredits) {
        return {...base(), resetCredits};
    }

    function resetRows(model) {
        const start = model.rows.findIndex(r => r.kind === 'group-heading');
        return start < 0 ? [] : [model.rows[start], ...model.rows.slice(start + 1).filter(r => r.kind === 'text')];
    }

    it('no credits → no Resets heading', () => {
        const model = buildSection(withResets({available: 0, credits: []}), META, NOW, theme);
        assertEqual(model.rows.some(r => r.kind === 'group-heading'), false);
    });

    it('an older snapshot without resetCredits renders no heading', () => {
        assertEqual(buildSection(base(), META, NOW, theme).rows.some(r => r.kind === 'group-heading'), false);
    });

    it('one line per credit, sorted by expiry, same titles not collapsed', () => {
        const model = buildSection(withResets({
            available: 2,
            credits: [{title: 'Full reset', expiresAt: later}, {title: 'Full reset', expiresAt: sooner}],
        }), META, NOW, theme);
        const rows = resetRows(model);
        assertDeepEqual(rows[0], {kind: 'group-heading', label: 'Resets'});
        assertEqual(rows.length, 3);
        assertDeepEqual(rows[1], {kind: 'text', text: 'Full reset', subtitle: expires(sooner)});
        assertDeepEqual(rows[2], {kind: 'text', text: 'Full reset', subtitle: expires(later)});
    });

    it('an untitled credit reads "Reset credit"', () => {
        const model = buildSection(withResets({available: 1, credits: [{title: null, expiresAt: null}]}), META, NOW, theme);
        assertDeepEqual(resetRows(model)[1], {kind: 'text', text: 'Reset credit', subtitle: 'No expiry reported'});
    });

    it('a count without detail (second call failed) is a single summary line', () => {
        const model = buildSection(withResets({available: 2, credits: []}), META, NOW, theme);
        const rows = resetRows(model);
        assertEqual(rows.length, 2);
        assertEqual(rows[1].text, '2 resets available');
    });

    it('the summary line goes through the injected ngettext', () => {
        const ngettext = (one, many, n) => (n === 1 ? `<${one}>` : `<${many}>`);
        const model = buildSection(withResets({available: 1, credits: []}), META, NOW, theme, s => s, ngettext);
        assertEqual(resetRows(model)[1].text, '<1 reset available>');
    });
});

describe('buildSection (openai): pace footnote', () => {
    it('both Codex windows carry a footnote', () => {
        const rows = buildSection(base(), META, NOW, theme).rows.filter(r => r.kind === 'window');
        assertEqual(rows.length, 2);
        for (const r of rows)
            assertEqual(r.paceFootnote.includes('elapsed'), true);
    });
});

system.exit(summary());

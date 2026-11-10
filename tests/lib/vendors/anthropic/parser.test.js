import system from 'system';

import {
    parseUsage,
    anthropicSeverity,
    anthropicPeakUsage,
    formatMinor,
    snapshotToCacheJson,
    parseCacheJson,
    formatExtraAmount,
    placeholders,
    fakeSnapshot,
    resetsAvailable,
    SchemaError, notifyRows, resetCredits, ULTRA, ExtraStatus,
} from '../../../../lib/vendors/anthropic/parser.js';
import {Severity} from '../../../../lib/severity.js';
import {substitute} from '../../../../lib/format.js';
import {describe, it, assertEqual, assertThrows, summary} from '../../../_assert.js';

const FULL = JSON.stringify({
    five_hour: {utilization: 42.7, resets_at: '2026-05-23T17:30:00Z'},
    seven_day: {utilization: 27.0, resets_at: '2026-05-30T12:00:00Z'},
    seven_day_sonnet: {utilization: 4.2, resets_at: '2026-05-30T12:00:00Z'},
    extra_usage: {is_enabled: true, monthly_limit: 5000, used_credits: 250},
});

function win(pct) {
    return {utilizationPct: pct, resetsAt: null};
}

function snap(session, weekly, sonnetPct, extra, scopedPcts = []) {
    return {
        plan: 'Max 5x',
        session: win(session),
        weekly: win(weekly),
        sonnet: sonnetPct === null ? null : win(sonnetPct),
        scoped: scopedPcts.map((pct) => ({label: 'Fable', utilizationPct: pct, resetsAt: null})),
        extra: extra === null ? null : {limitCents: extra[0], spentCents: extra[1]},
    };
}

describe('parseUsage', () => {
    it('parses a full response (float util rounds, sonnet + extra present)', () => {
        const s = parseUsage(FULL, 'Max 5x');
        assertEqual(s.plan, 'Max 5x');
        assertEqual(s.session.utilizationPct, 43); // 42.7 rounded to nearest
        assertEqual(s.weekly.utilizationPct, 27);
        assertEqual(s.sonnet.utilizationPct, 4);
        assertEqual(s.extra.limitCents, 5000);
        assertEqual(s.extra.spentCents, 250);
        assertEqual(s.session.resetsAt instanceof Date, true);
    });

    it('accepts a Uint8Array body', () => {
        const s = parseUsage(new TextEncoder().encode(FULL), 'Pro');
        assertEqual(s.plan, 'Pro');
        assertEqual(s.session.utilizationPct, 43);
    });

    it('missing sonnet + extra → both null', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0, resets_at: '2026-05-23T17:30:00Z'},
            seven_day: {utilization: 0, resets_at: '2026-05-30T12:00:00Z'},
        }), 'Pro');
        assertEqual(s.sonnet, null);
        assertEqual(s.extra, null);
    });

    it('disabled extra_usage → extra null', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0},
            seven_day: {utilization: 0},
            extra_usage: {is_enabled: false, monthly_limit: 5000, used_credits: 0},
        }), 'Pro');
        assertEqual(s.extra, null);
    });

    it('empty {} → neutral snapshot (no throw)', () => {
        const s = parseUsage('{}', 'Unknown');
        assertEqual(s.session.utilizationPct, 0);
        assertEqual(s.weekly.utilizationPct, 0);
        assertEqual(s.session.resetsAt, null);
        assertEqual(s.sonnet, null);
        assertEqual(s.extra, null);
    });

    it('unparseable resets_at → null, utilization still parsed', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 50, resets_at: 'not a date'},
            seven_day: {utilization: 0},
        }), 'Pro');
        assertEqual(s.session.resetsAt, null);
        assertEqual(s.session.utilizationPct, 50);
    });

    it('sanitizes the scoped model label', () => {
        const s = parseUsage(JSON.stringify({limits: [{kind: 'weekly_scoped', percent: 1,
            scope: {model: {display_name: 'Fa‮ble\u0007'}}}]}), 'Pro');
        assertEqual(s.scoped[0].label, 'Fable');
    });

    const extraOf = (eu) => parseUsage(JSON.stringify({extra_usage: Object.assign({is_enabled: true}, eu)}), 'Pro').extra;

    it('monthly_limit null keeps the block with no cap', () => {
        const e = extraOf({monthly_limit: null, used_credits: 14157.0});
        assertEqual(e.limitCents, null);
        assertEqual(e.spentCents, 14157);
    });

    it('drops an enabled block without used_credits', () => {
        assertEqual(extraOf({monthly_limit: 5000}), null);
        assertEqual(extraOf({monthly_limit: 5000, used_credits: null}), null);
    });

    it('is_enabled:false drops the block even with a spend', () =>
        assertEqual(extraOf({is_enabled: false, used_credits: 250}), null));

    it('negative money values are schema drift', () => {
        assertThrows(() => extraOf({monthly_limit: -1, used_credits: 0}));
        assertThrows(() => extraOf({used_credits: -250}));
    });

    it('reads currency and decimal_places, accepting an integral float scale', () => {
        const e = extraOf({used_credits: 14157, currency: 'BRL', decimal_places: 2.0});
        assertEqual(e.currency, 'BRL');
        assertEqual(e.decimalPlaces, 2);
    });

    it('rejects an invalid currency or decimal_places', () => {
        for (const currency of ['brl', 'BR', 'R$', 'BRLX', 7])
            assertThrows(() => extraOf({used_credits: 1, currency}));
        for (const dp of [-1, 7, 2.5, '2'])
            assertThrows(() => extraOf({used_credits: 1, decimal_places: dp}));
    });

    it('extra money values accept floats and truncate', () => {
        const s = parseUsage(JSON.stringify({
            extra_usage: {is_enabled: true, monthly_limit: 5000.9, used_credits: 250.9},
        }), 'Max 5x');
        assertEqual(s.extra.limitCents, 5000);
        assertEqual(s.extra.spentCents, 250);
    });

    it('invalid JSON throws SchemaError', () => {
        assertThrows(() => parseUsage('{not json', 'Pro'));
        let threw = false;
        try {
            parseUsage('{not json', 'Pro');
        } catch (e) {
            threw = e instanceof SchemaError;
        }
        assertEqual(threw, true, 'should be a SchemaError');
    });

    it('non-object top-level (array / scalar) throws', () => {
        assertThrows(() => parseUsage('[]', 'Pro'));
        assertThrows(() => parseUsage('42', 'Pro'));
        assertThrows(() => parseUsage('null', 'Pro'));
    });

    it('lifts weekly_scoped limits into scoped; unscoped entries never duplicate', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 10, resets_at: '2026-07-08T22:59:59Z'},
            seven_day: {utilization: 55, resets_at: '2026-07-10T10:59:59Z'},
            limits: [
                {kind: 'session', percent: 10, resets_at: '2026-07-08T22:59:59Z', scope: null},
                {kind: 'weekly_all', percent: 55, resets_at: '2026-07-10T10:59:59Z', scope: null},
                {
                    kind: 'weekly_scoped', percent: 84, resets_at: '2026-07-10T10:59:59Z',
                    scope: {model: {id: null, display_name: 'Fable'}, surface: null},
                },
            ],
        }), 'Pro');
        assertEqual(s.scoped.length, 1);
        assertEqual(s.scoped[0].label, 'Fable');
        assertEqual(s.scoped[0].utilizationPct, 84);
        assertEqual(s.scoped[0].resetsAt instanceof Date, true);
        assertEqual(s.weekly.utilizationPct, 55); // unscoped weekly stays put
    });

    it('missing limits[] → scoped empty (no throw)', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0, resets_at: '2026-05-23T17:30:00Z'},
            seven_day: {utilization: 0, resets_at: '2026-05-30T12:00:00Z'},
        }), 'Pro');
        assertEqual(Array.isArray(s.scoped), true);
        assertEqual(s.scoped.length, 0);
    });

    it('weekly_scoped without a model display_name is ignored', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 0},
            seven_day: {utilization: 0},
            limits: [
                {kind: 'weekly_scoped', percent: 90, resets_at: '2026-07-10T10:59:59Z', scope: {model: {id: 'x', display_name: null}}},
                {kind: 'weekly_scoped', percent: 70, resets_at: '2026-07-10T10:59:59Z', scope: {model: {}}},
                {kind: 'weekly_scoped', percent: 60, resets_at: '2026-07-10T10:59:59Z', scope: null},
            ],
        }), 'Pro');
        assertEqual(s.scoped.length, 0);
    });
});

describe('anthropicSeverity', () => {
    it('picks worst of three windows', () => {
        assertEqual(anthropicSeverity(snap(40, 60, 80, null)), Severity.HIGH); // 80
    });

    it('ignores extra when no window at cap', () => {
        assertEqual(anthropicSeverity(snap(50, 60, null, [10000, 9500])), Severity.MID); // 60
    });

    it('promotes extra to critical when a window is at 100', () => {
        assertEqual(anthropicSeverity(snap(100, 50, null, [10000, 9500])), Severity.CRITICAL);
    });

    it('falls through to extra when extra higher than capped window', () => {
        assertEqual(anthropicSeverity(snap(100, 50, null, [10000, 10000])), Severity.CRITICAL);
    });

    it('counts scoped windows in the max (weekly 55 mid + Fable 84 → high)', () => {
        assertEqual(anthropicSeverity(snap(10, 55, null, null, [84])), Severity.HIGH);
    });

    it('a scoped window at 100 is a cap hit that promotes extra into the peak', () => {
        // No unscoped window at cap; only the scoped 100 triggers the cap-hit
        // path, promoting extra (spent 150% of limit) into the peak.
        const s = snap(10, 50, null, [10000, 15000], [100]);
        assertEqual(anthropicPeakUsage(s).percent, 150);
        assertEqual(anthropicSeverity(s), Severity.CRITICAL);
    });
});

describe('anthropicPeakUsage', () => {
    it('returns the peak percent and the winning window resets_at', () => {
        const s = parseUsage(FULL, 'Max 5x'); // session 42.7→43 is the max
        const p = anthropicPeakUsage(s);
        assertEqual(p.percent, 43);
        assertEqual(p.resetsAt, s.session.resetsAt);
    });
    it('selects the weekly window when it is the peak', () => {
        const s = parseUsage(JSON.stringify({
            five_hour: {utilization: 10, resets_at: '2026-05-23T17:30:00Z'},
            seven_day: {utilization: 80, resets_at: '2026-05-30T12:00:00Z'},
        }), 'Pro');
        const p = anthropicPeakUsage(s);
        assertEqual(p.percent, 80);
        assertEqual(p.resetsAt, s.weekly.resetsAt);
    });
});

describe('formatMinor', () => {
    it('formats legacy cents as $D.CC', () => {
        assertEqual(formatMinor(0, 2), '$0.00');
        assertEqual(formatMinor(50, 2), '$0.50');
        assertEqual(formatMinor(5000, 2), '$50.00');
    });

    it('formats negative amounts with the sign ahead of the symbol', () => {
        assertEqual(formatMinor(-150, 2), '-$1.50');
        assertEqual(formatMinor(-1, 2, 'EUR'), '-€0.01');
    });

    it('uses the symbol table, else trails the code', () => {
        assertEqual(formatMinor(14157, 2, 'BRL'), 'R$141.57');
        assertEqual(formatMinor(350, 2, 'GBP'), '£3.50');
        assertEqual(formatMinor(1200, 0, 'JPY'), '¥1200');
        assertEqual(formatMinor(99, 2, 'CNY'), '¥0.99');
        assertEqual(formatMinor(12345, 3, 'KWD'), '12.345 KWD');
    });
});

describe('formatExtraAmount', () => {
    const fmt = (currency, decimalPlaces, minor) => formatExtraAmount({currency, decimalPlaces}, minor);

    it('both fields → that scale and currency', () => assertEqual(fmt('BRL', 2, 14157), 'R$141.57'));
    it('currency without decimal_places → raw minor units', () => assertEqual(fmt('BRL', null, 14157), '14157 minor units BRL'));
    it('decimal_places without currency → that scale with $', () => assertEqual(fmt(null, 3, 14157), '$14.157'));
    it('neither → legacy $ cents', () => assertEqual(fmt(null, null, 14157), '$141.57'));
    it('a snapshot built without the fields reads as legacy', () =>
        assertEqual(formatExtraAmount({limitCents: 1, spentCents: 250}, 250), '$2.50'));
});

describe('placeholders', () => {
    // now fixed; session resets in exactly 1h 30m (5400s) of a 5h (18000s)
    // window → elapsed 70%, delta 42-70 = -28 → "28pts under".
    const now = new Date('2026-06-05T00:00:00Z');
    const resetsAt = new Date(now.getTime() + 5400 * 1000);
    const s = {
        plan: 'Max 5x',
        session: {utilizationPct: 42, resetsAt},
        weekly: {utilizationPct: 10, resetsAt: null},
        sonnet: null,
        extra: null,
    };

    it('renders the default bar format', () => {
        const out = substitute('{vendor_short} {session_pct}% · {session_reset}', placeholders(s, now));
        assertEqual(out, 'cld 42% · 1h 30m');
    });

    it('renders a custom format using a pace key', () => {
        const out = substitute('{session_pct}% ({session_pace_pts})', placeholders(s, now));
        assertEqual(out, '42% (28pts under)');
    });

    it('sonnet-absent defaults present; *_bar keys omitted', () => {
        const m = placeholders(s, now);
        assertEqual(m.get('sonnet_pct'), '0');
        assertEqual(m.get('sonnet_reset'), '-');
        assertEqual(m.get('sonnet_elapsed'), '0');
        assertEqual(m.get('extra_spent'), '');
        assertEqual(m.get('extra_pct'), '0');
        assertEqual(m.has('session_bar'), false);
        assertEqual(m.has('sonnet_bar'), false);
        assertEqual(m.has('extra_bar'), false);
        assertEqual(m.get('icon'), '󰚩');
    });

    it('includes extra spent/limit/pct when extra present', () => {
        const withExtra = {...s, extra: {limitCents: 5000, spentCents: 250}};
        const m = placeholders(withExtra, now);
        assertEqual(m.get('extra_spent'), '$2.50');
        assertEqual(m.get('extra_limit'), '$50.00');
        assertEqual(m.get('extra_pct'), '5'); // 250*100/5000
    });

    it('no cap: extra_limit is - and extra_pct is 0', () => {
        const m = placeholders({...s, extra: {limitCents: null, spentCents: 14157, currency: 'BRL', decimalPlaces: 2}}, now);
        assertEqual(m.get('extra_spent'), 'R$141.57');
        assertEqual(m.get('extra_limit'), '-');
        assertEqual(m.get('extra_pct'), '0');
    });
});

describe('cache round-trip', () => {
    it('restores windows, scoped limits and the currency-aware extra block', () => {
        const snap = parseUsage(JSON.stringify(Object.assign(JSON.parse(FULL), {
            extra_usage: {is_enabled: true, monthly_limit: null, used_credits: 14157, currency: 'BRL', decimal_places: 2},
            limits: [{kind: 'weekly_scoped', percent: 30, resets_at: '2026-05-30T12:00:00Z', scope: {model: {display_name: 'Fable'}}}],
        })), 'Max 5x');
        const back = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(back.session.resetsAt.getTime(), snap.session.resetsAt.getTime());
        assertEqual(back.scoped[0].label, 'Fable');
        assertEqual(back.scoped[0].resetsAt instanceof Date, true);
        assertEqual(back.extra.limitCents, null);
        assertEqual(back.extra.currency, 'BRL');
        assertThrows(() => parseCacheJson(FULL));
    });
});

describe('fakeSnapshot', () => {
    it('sets every window to the clamped percentage', () => {
        const s = fakeSnapshot(23);
        assertEqual(s.session.utilizationPct, 23);
        assertEqual(s.weekly.utilizationPct, 23);
        assertEqual(s.sonnet.utilizationPct, 23);
        assertEqual(s.scoped[0].label, 'Fable');
        assertEqual(s.scoped[0].utilizationPct, 23);
        assertEqual(anthropicPeakUsage(s).percent, 23);
        assertEqual(s.extra, null);
    });
});

function withGrants(cedarEmber) {
    return JSON.stringify({
        five_hour: {utilization: 2, resets_at: '2026-09-24T17:49:59Z'},
        seven_day: {utilization: 63, resets_at: '2026-09-25T08:59:59Z'},
        ...(cedarEmber === undefined ? {} : {cedar_ember: cedarEmber}),
    });
}

function grant(overrides = {}) {
    return {
        id: 'a-redemption-handle',
        label: 'Claude Opus 5.5 launch reset',
        resets_total: 2,
        resets_left: 2,
        starts_at: '2026-09-22T16:00:00+00:00',
        ends_at: '2026-10-22T16:00:00+00:00',
        paused: false,
        usable_now: true,
        ...overrides,
    };
}

describe('parseUsage: cedar_ember resets', () => {
    it('counts only usable, unpaused grants with resets left', () => {
        const s = parseUsage(withGrants({
            eligible: true,
            grants: [grant(), grant({label: 'Paused', paused: true}), grant({label: 'Spent', resets_left: 0})],
        }), 'Team');
        assertEqual(s.resets.length, 1);
        assertEqual(s.resets[0].label, 'Claude Opus 5.5 launch reset');
        assertEqual(s.resets[0].resetsLeft, 2);
        assertEqual(s.resets[0].endsAt.getTime(), Date.parse('2026-10-22T16:00:00Z'));
    });

    it('never keeps the redemption id', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant()]}), 'Team');
        assertEqual('id' in s.resets[0], false);
        assertEqual(snapshotToCacheJson(s).includes('a-redemption-handle'), false);
    });

    it('a grant missing usable_now is not counted', () => {
        const g = grant();
        delete g.usable_now;
        assertEqual(parseUsage(withGrants({eligible: true, grants: [g]}), 'Team').resets.length, 0);
    });

    it('no cedar_ember block → []', () => {
        assertEqual(parseUsage(withGrants(undefined), 'Team').resets.length, 0);
    });

    it('eligible absent → []', () => {
        assertEqual(parseUsage(withGrants({grants: [grant()]}), 'Team').resets.length, 0);
    });

    it('eligible false → []', () => {
        const s = parseUsage(withGrants({eligible: false, ineligible_reason: 'surface', grants: [grant()]}), 'Team');
        assertEqual(s.resets.length, 0);
    });

    it('a 90-character label is dropped but the grant still counts', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant({label: 'x'.repeat(90)})]}), 'Team');
        assertEqual(s.resets.length, 1);
        assertEqual(s.resets[0].label, null);
    });

    it('a label with a control character is dropped', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant({label: 'bad\u001b[31m'})]}), 'Team');
        assertEqual(s.resets[0].label, null);
    });

    it('an 80-character label is kept', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant({label: 'y'.repeat(80)})]}), 'Team');
        assertEqual(s.resets[0].label, 'y'.repeat(80));
    });

    it('ends_at absent → endsAt null', () => {
        const g = grant();
        delete g.ends_at;
        assertEqual(parseUsage(withGrants({eligible: true, grants: [g]}), 'Team').resets[0].endsAt, null);
    });

    it('grants survive the cache round-trip', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant(), grant({label: 'Second', resets_left: 1})]}), 'Team');
        const back = parseCacheJson(snapshotToCacheJson(s));
        assertEqual(back.resets.length, 2);
        assertEqual(back.resets[1].label, 'Second');
        assertEqual(back.resets[1].resetsLeft, 1);
        assertEqual(back.resets[0].endsAt instanceof Date, true);
        assertEqual(back.resets[0].endsAt.getTime(), s.resets[0].endsAt.getTime());
    });

    it('a cache from the previous version is refused', () => {
        let thrown = false;
        try {
            parseCacheJson(JSON.stringify({cacheVersion: 1, snapshot: {}}));
        } catch (e) {
            thrown = e instanceof SchemaError;
        }
        assertEqual(thrown, true);
    });
});

describe('placeholders: resets', () => {
    const NOW = new Date('2026-09-24T12:00:00Z');

    it('sums resets_left across grants', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant(), grant({resets_left: 1})]}), 'Team');
        assertEqual(resetsAvailable(s), 3);
        const m = placeholders(s, NOW);
        assertEqual(m.get('resets_available'), '3');
        assertEqual(m.get('resets'), '3 resets available');
    });

    it('one reset is singular', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant({resets_left: 1})]}), 'Team');
        assertEqual(placeholders(s, NOW).get('resets'), '1 reset available');
    });

    it('no grants → 0', () => {
        const m = placeholders(parseUsage(withGrants(undefined), 'Team'), NOW);
        assertEqual(m.get('resets_available'), '0');
        assertEqual(m.get('resets'), '0 resets available');
    });

    it('uses the injected ngettext', () => {
        const s = parseUsage(withGrants({eligible: true, grants: [grant({resets_left: 1})]}), 'Team');
        const ngettext = (one, many, n) => (n === 1 ? `[${one}]` : `[${many}]`);
        assertEqual(placeholders(s, NOW, ngettext).get('resets'), '[1 reset available]');
    });

    it('a snapshot without resets (fake, old shape) → 0', () => {
        const s = parseUsage(withGrants(undefined), 'Team');
        delete s.resets;
        assertEqual(placeholders(s, NOW).get('resets_available'), '0');
    });
});

describe('notifyRows / resetCredits', () => {
    const R = new Date('2026-06-08T17:00:00Z');
    const s = {
        plan: 'Max 5x',
        session: {utilizationPct: 97, resetsAt: R},
        weekly: {utilizationPct: 40, resetsAt: null},
        sonnet: {utilizationPct: 10, resetsAt: null},
        scoped: [{label: 'Fable', utilizationPct: 50, resetsAt: R}],
        extra: null,
        resets: [{label: 'Launch', resetsLeft: 1, endsAt: R}],
    };

    it('one row per window with a stable key and a translated label', () => {
        const rows = notifyRows(s, t => `<${t}>`);
        assertEqual(rows.map(r => r.key).join(','), 'session,weekly,sonnet,scoped:Fable');
        assertEqual(rows[0].label, '<Session>');
        assertEqual(rows[0].percent, 97);
        assertEqual(rows[0].resetsAt, R);
        assertEqual(rows[3].label, 'Fable');
    });

    it('no Sonnet row when the window is absent', () => {
        assertEqual(notifyRows({...s, sonnet: null, scoped: []}).length, 2);
    });

    it('grants become {title, expiresAt}', () => {
        const [c] = resetCredits(s);
        assertEqual(c.title, 'Launch');
        assertEqual(c.expiresAt, R);
        assertEqual(resetCredits({...s, resets: undefined}).length, 0);
    });
});

// The shape a verified Ultra account returns, from the upstream fixture
// tests/fixtures/anthropic_usage_ultra_verified.json.
const ULTRA_VERIFIED = JSON.stringify({
    five_hour: null,
    seven_day: {
        utilization: 41.0, resets_at: '2026-05-27T13:00:00.297956+00:00',
        limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null,
    },
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
        {kind: 'weekly_all', group: 'weekly', percent: 41, severity: 'normal',
            resets_at: '2026-05-27T13:00:00.297956+00:00', scope: null, is_active: true},
        {kind: 'weekly_scoped', group: 'weekly', percent: 33, severity: 'normal',
            resets_at: '2026-05-27T13:00:00.298122+00:00',
            scope: {model: {id: null, display_name: 'Fable'}, surface: null}, is_active: false},
    ],
});

describe('parseUsage: Ultra without a five-hour limit', () => {
    const now = new Date('2026-05-25T12:00:00Z');

    it('a verified Ultra account has no session window', () => {
        const s = parseUsage(ULTRA_VERIFIED, ULTRA);
        assertEqual(s.session, null);
        assertEqual(s.weekly.utilizationPct, 41);
        assertEqual(s.scoped.length, 1);
        assertEqual(s.scoped[0].label, 'Fable');
        assertEqual(s.scoped[0].utilizationPct, 33);
    });

    it('an absent five_hour on Ultra is also no session window', () => {
        assertEqual(parseUsage(JSON.stringify({seven_day: {utilization: 5}}), ULTRA).session, null);
    });

    it('an unverified Ultra account keeps its temporary five-hour window', () => {
        const s = parseUsage(JSON.stringify({five_hour: {utilization: 12, resets_at: '2026-05-25T15:00:00Z'}, seven_day: {utilization: 5}}), ULTRA);
        assertEqual(s.session.utilizationPct, 12);
    });

    it('every other plan still reads a missing five_hour as idle at 0%', () => {
        for (const plan of ['Max', 'Pro', 'Unknown']) {
            const s = parseUsage(ULTRA_VERIFIED, plan);
            assertEqual(s.session.utilizationPct, 0, plan);
            assertEqual(s.session.resetsAt, null, plan);
        }
    });

    it('peak usage and severity ignore the absent session', () => {
        const s = parseUsage(ULTRA_VERIFIED, ULTRA);
        const peak = anthropicPeakUsage(s);
        assertEqual(peak.percent, 41);
        assertEqual(peak.resetsAt instanceof Date, true);
        assertEqual(anthropicSeverity(s), Severity.LOW);
    });

    it('the extra-usage fallback still works without a session', () => {
        const s = {...parseUsage(ULTRA_VERIFIED, ULTRA), weekly: win(100), extra: {limitCents: 1000, spentCents: 900}};
        assertEqual(anthropicPeakUsage(s).percent, 100);
    });

    it('every session_* placeholder is empty', () => {
        const m = placeholders(parseUsage(ULTRA_VERIFIED, ULTRA), now);
        for (const suffix of ['pct', 'reset', 'elapsed', 'pace', 'pace_indicator', 'pace_pct', 'pace_pts', 'pace_delta', 'pace_abs_delta'])
            assertEqual(m.get(`session_${suffix}`), '', suffix);
        assertEqual(m.get('weekly_pct'), '41');
        assertEqual(substitute('{session_pct}% · {session_reset}', m), '% · ');
    });

    it('a missing sonnet window keeps its 0 / - placeholders', () => {
        const m = placeholders(parseUsage(ULTRA_VERIFIED, ULTRA), now);
        assertEqual(m.get('sonnet_pct'), '0');
        assertEqual(m.get('sonnet_reset'), '-');
    });

    it('notifyRows leaves the session out', () => {
        const keys = notifyRows(parseUsage(ULTRA_VERIFIED, ULTRA)).map(r => r.key);
        assertEqual(keys.includes('session'), false);
        assertEqual(keys[0], 'weekly');
    });

    it('the cache keeps session: null', () => {
        const back = parseCacheJson(snapshotToCacheJson(parseUsage(ULTRA_VERIFIED, ULTRA)));
        assertEqual(back.session, null);
        assertEqual(back.weekly.utilizationPct, 41);
    });
});

const extraOf = (eu) => parseUsage(JSON.stringify({extra_usage: eu}), 'Max').extra;

describe('parseUsage: extra usage status', () => {
    it('enabled → active', () =>
        assertEqual(extraOf({is_enabled: true, monthly_limit: 5000, used_credits: 250}).status, ExtraStatus.ACTIVE));

    it('provider-disabled for credits keeps the spend and the reason visible', () => {
        const e = extraOf({is_enabled: false, monthly_limit: 5000, used_credits: 5000, disabled_reason: 'out_of_credits'});
        assertEqual(e.status, ExtraStatus.OUT_OF_CREDITS);
        assertEqual(e.spentCents, 5000);
        assertEqual(e.limitCents, 5000);
    });

    it('a reached monthly limit, by reason or by flag', () => {
        for (const eu of [
            {disabled_reason: 'monthly_limit_reached'},
            {disabled_reason: 'spend_limit_reached'},
            {spend_limit_reached: true},
        ])
            assertEqual(extraOf({is_enabled: false, used_credits: 900, ...eu}).status, ExtraStatus.MONTHLY_LIMIT_REACHED);
    });

    it('credits once enabled with spend, no reason → unavailable', () =>
        assertEqual(extraOf({is_enabled: false, used_credits: 10, credits_ever_enabled: true}).status, ExtraStatus.UNAVAILABLE));

    it('user-disabled stays hidden, even with a reason', () =>
        assertEqual(extraOf({is_enabled: false, user_disabled: true, used_credits: 10, disabled_reason: 'out_of_credits'}), null));

    it('disabled with no reason and nothing spent stays hidden', () => {
        assertEqual(extraOf({is_enabled: false, used_credits: 0, credits_ever_enabled: true}), null);
        assertEqual(extraOf({is_enabled: false, used_credits: 10}), null);
    });

    it('no usable spend hides the block in any state', () => {
        assertEqual(extraOf({is_enabled: true, monthly_limit: 5000}), null);
        assertEqual(extraOf({is_enabled: false, disabled_reason: 'out_of_credits', used_credits: null}), null);
    });
});

system.exit(summary());

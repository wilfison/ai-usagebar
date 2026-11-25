import system from 'system';

import {
    parseEnvelope, validateEnvelope, snapshotToCacheJson, parseCacheJson, SchemaError, zaiPeakUsage, placeholders, fakeSnapshot, SESSION_MS, WEEKLY_MS, MCP_MS, notifyRows, resetCredits,
} from '../../../../lib/vendors/zai/parser.js';
import {zaiAdapter} from '../../../../lib/vendors/zai/adapter.js';
import {substitute} from '../../../../lib/format.js';
import {Severity} from '../../../../lib/severity.js';
import {describe, it, assertEqual, assertThrows, summary} from '../../../_assert.js';

const REAL = JSON.stringify({
    code: 200, msg: 'Operation successful',
    data: {
        limits: [
            {type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0},
            {type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 0, nextResetTime: 1779792169974},
            {type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 0, nextResetTime: 1779964969979},
        ],
        level: 'pro',
    },
    success: true,
});

function env(limits, data = {}) {
    return JSON.stringify({code: 200, success: true, data: Object.assign({limits, level: 'pro'}, data)});
}

describe('parseEnvelope', () => {
    it('parses the real shape into GLM Coding Pro + 3 windows', () => {
        const s = parseEnvelope(REAL, null);
        assertEqual(s.plan, 'GLM Coding Pro');
        assertEqual(s.session === null, false);
        assertEqual(s.weekly === null, false);
        assertEqual(s.mcp === null, false);
        assertEqual(s.session.utilizationPct, 0);
        assertEqual(s.session.windowMs, SESSION_MS);
        assertEqual(s.weekly.windowMs, WEEKLY_MS);
        assertEqual(s.mcp.windowMs, MCP_MS);
        assertEqual(s.weekly.resetsAt === null, false);
    });

    it('only a TIME_LIMIT → mcp only', () => {
        const s = parseEnvelope(env([{type: 'TIME_LIMIT', percentage: 12}]), null);
        assertEqual(s.session, null);
        assertEqual(s.weekly, null);
        assertEqual(s.mcp.utilizationPct, 12);
        assertEqual(s.mcp.windowMs, MCP_MS);
    });

    it('rounds a float percentage', () => {
        const s = parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 42.7}], {level: 'max'}), null);
        assertEqual(s.session.utilizationPct, 43);
    });

    it('saturates 101 at 100 and rejects anything outside 0..=101', () => {
        assertEqual(parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 100.6}]), null).session.utilizationPct, 100);
        for (const bad of [150, -1, '42'])
            assertThrows(() => parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: bad}]), null));
    });

    it('uses the config tier when level is empty', () => {
        const s = parseEnvelope(env([], {level: ''}), 'max');
        assertEqual(s.plan, 'GLM Coding Max');
    });

    it('nextResetTime null or 0 → no reset; negative or fractional → drift', () => {
        for (const ms of [null, 0])
            assertEqual(parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 0, nextResetTime: ms}]), null).session.resetsAt, null);
        for (const ms of [-1, 1.5, '1779792169974'])
            assertThrows(() => parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 0, nextResetTime: ms}]), null));
    });

    it('classifies a pure CREDIT_LIMIT account by unit', () => {
        const s = parseEnvelope(env([
            {type: 'CREDIT_LIMIT', unit: 6, percentage: 30, nextResetTime: 1779792169974},
            {type: 'CREDIT_LIMIT', unit: 3, percentage: 70},
        ]), null);
        assertEqual(s.session.utilizationPct, 70);
        assertEqual(s.session.windowMs, SESSION_MS);
        assertEqual(s.weekly.utilizationPct, 30);
        assertEqual(s.weekly.windowMs, WEEKLY_MS);
    });

    it('classifies a mixed TOKENS_LIMIT + CREDIT_LIMIT account by unit', () => {
        const s = parseEnvelope(env([
            {type: 'CREDIT_LIMIT', unit: 6, percentage: 20},
            {type: 'TOKENS_LIMIT', unit: 3, percentage: 55},
        ]), null);
        assertEqual(s.session.utilizationPct, 55);
        assertEqual(s.weekly.utilizationPct, 20);
    });

    it('drops a bucket with an unknown unit', () => {
        const s = parseEnvelope(env([
            {type: 'TOKENS_LIMIT', unit: 3, percentage: 5},
            {type: 'TOKENS_LIMIT', unit: 9, percentage: 99},
        ]), null);
        assertEqual(s.session.utilizationPct, 5);
        assertEqual(s.weekly, null);
    });

    it('rejects unclassifiable layouts', () => {
        const layouts = [
            [{type: 'TOKENS_LIMIT', percentage: 1}, {type: 'TOKENS_LIMIT', percentage: 2}],
            [{type: 'TOKENS_LIMIT', unit: 3, percentage: 1}, {type: 'CREDIT_LIMIT', unit: 3, percentage: 2}],
            [{type: 'TOKENS_LIMIT', unit: 9, percentage: 1}],
            [{type: 'TIME_LIMIT', percentage: 1}, {type: 'TIME_LIMIT', percentage: 2}],
        ];
        for (const limits of layouts) {
            let threw = false;
            try {
                parseEnvelope(env(limits), null);
            } catch (e) {
                threw = e instanceof SchemaError && e.message.includes('limits layout');
            }
            assertEqual(threw, true);
        }
    });

    it('throws SchemaError on a non-object top level', () => {
        assertThrows(() => parseEnvelope('[]', null));
        assertThrows(() => parseEnvelope('not json', null));
    });
});

describe('cache round-trip', () => {
    it('restores every window with its reset; rejects a raw envelope', () => {
        const snap = parseEnvelope(REAL, null);
        const back = parseCacheJson(snapshotToCacheJson(snap));
        assertEqual(back.plan, 'GLM Coding Pro');
        assertEqual(back.weekly.resetsAt.getTime(), snap.weekly.resetsAt.getTime());
        assertEqual(back.mcp.windowMs, MCP_MS);
        assertEqual(back.session.resetsAt, null);
        assertThrows(() => parseCacheJson(REAL));
    });
});

describe('validateEnvelope', () => {
    const ok = () => JSON.parse(REAL);

    it('accepts the real envelope and returns the classified buckets', () => {
        const b = validateEnvelope(ok());
        assertEqual(b.session.unit, 3);
        assertEqual(b.weekly.unit, 6);
        assertEqual(b.mcp.type, 'TIME_LIMIT');
    });

    it('accepts an envelope without a code', () => {
        const o = ok();
        delete o.code;
        validateEnvelope(o);
    });

    it('rejects success missing or false', () => {
        const missing = ok();
        delete missing.success;
        assertThrows(() => validateEnvelope(missing));
        assertThrows(() => validateEnvelope(Object.assign(ok(), {success: false})));
    });

    it('rejects a code other than 200', () => {
        assertThrows(() => validateEnvelope(Object.assign(ok(), {code: 500})));
        assertThrows(() => validateEnvelope(Object.assign(ok(), {code: 0})));
    });

    it('rejects data:null', () =>
        assertThrows(() => validateEnvelope(Object.assign(ok(), {data: null}))));

    it('rejects a classified bucket without a percentage', () =>
        assertThrows(() => validateEnvelope(JSON.parse(env([{type: 'TOKENS_LIMIT', unit: 6}])))));
});

describe('zaiSeverity', () => {
    it('picks the worst present window', () => {
        const s = parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 10}, {type: 'TOKENS_LIMIT', unit: 6, percentage: 95}]), null);
        assertEqual(zaiAdapter.severity(s), Severity.CRITICAL);
    });

    it('all windows absent → low', () =>
        assertEqual(zaiAdapter.severity(parseEnvelope(env([]), null)), Severity.LOW));
});

describe('zaiPeakUsage', () => {
    it('returns the peak percent and the winning window resets_at', () => {
        const s = parseEnvelope(env([
            {type: 'TOKENS_LIMIT', unit: 3, percentage: 10},
            {type: 'TOKENS_LIMIT', unit: 6, percentage: 95, nextResetTime: 1779792169974},
        ]), null);
        const p = zaiPeakUsage(s);
        assertEqual(p.percent, 95);
        assertEqual(p.resetsAt, s.weekly.resetsAt);
    });
    it('all windows absent → 0 percent, null reset', () => {
        const p = zaiPeakUsage(parseEnvelope(env([]), null));
        assertEqual(p.percent, 0);
        assertEqual(p.resetsAt, null);
    });
});

describe('placeholders', () => {
    const now = new Date('2026-06-05T00:00:00Z');

    it('renders the shared cross-vendor format', () => {
        const s = parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 42}]), null);
        assertEqual(substitute('{vendor_short} {session_pct}%', placeholders(s, now)), 'zai 42%');
    });

    it('absent session → session_reset is -', () => {
        const m = placeholders(parseEnvelope(env([]), null), now);
        assertEqual(m.get('session_pct'), '0');
        assertEqual(m.get('session_reset'), '-');
        assertEqual(m.get('zai_mcp_pct'), '0');
    });

    it('the schema default bar-format renders the expected label', () => {
        // Regression guard for the default 'bar-format' template; '-' when the
        // session window reports no reset time.
        const DEFAULT = '{session_pct}% · {session_reset}';
        const s = parseEnvelope(env([{type: 'TOKENS_LIMIT', unit: 3, percentage: 42}]), null);
        assertEqual(substitute(DEFAULT, placeholders(s, now)), '42% · -');
    });
});

describe('fakeSnapshot', () => {
    it('sets session/weekly/mcp to the clamped percentage', () => {
        const s = fakeSnapshot(23);
        assertEqual(s.session.utilizationPct, 23);
        assertEqual(s.weekly.utilizationPct, 23);
        assertEqual(s.mcp.utilizationPct, 23);
        assertEqual(zaiPeakUsage(s).percent, 23);
    });
});

describe('fakeSnapshot: per-kind percentages', () => {
    it('each window takes its own kind', () => {
        const s = fakeSnapshot({base: 5, session: 5, weekly: 40, mcp: 100});
        assertEqual(s.session.utilizationPct, 5);
        assertEqual(s.weekly.utilizationPct, 40);
        assertEqual(s.mcp.utilizationPct, 100);
        assertEqual(zaiPeakUsage(s).percent, 100);
    });
});

const PACE_NOW = new Date('2026-06-05T12:00:00Z');
const halfway = windowMs => new Date(PACE_NOW.getTime() + windowMs / 2);

describe('placeholders: pace', () => {
    const snap = {
        plan: 'Pro',
        session: {utilizationPct: 60, resetsAt: halfway(SESSION_MS), windowMs: SESSION_MS},
        weekly: {utilizationPct: 20, resetsAt: halfway(WEEKLY_MS), windowMs: WEEKLY_MS},
        mcp: {utilizationPct: 100, resetsAt: halfway(MCP_MS), windowMs: MCP_MS},
    };
    const m = placeholders(snap, PACE_NOW);

    it('zai_* elapsed, pace and pace_indicator for each window', () => {
        assertEqual(m.get('zai_session_elapsed'), '50');
        assertEqual(m.get('zai_session_pace'), '↑');
        assertEqual(m.get('zai_session_pace_indicator'), '↑');
        assertEqual(m.get('zai_weekly_pace'), '↓');
        assertEqual(m.get('zai_mcp_elapsed'), '50');
    });

    it('a window at its cap shows no pace glyph', () => {
        assertEqual(m.get('zai_mcp_pace'), '');
        assertEqual(m.get('zai_mcp_pace_indicator'), '');
    });

    it('session_/weekly_ aliases', () => {
        assertEqual(m.get('session_elapsed'), '50');
        assertEqual(m.get('session_pace'), '↑');
        assertEqual(m.get('weekly_elapsed'), '50');
        assertEqual(m.get('weekly_pace'), '↓');
    });

    it('an absent window → 0 elapsed, no glyph', () => {
        const empty = placeholders({plan: 'Pro', session: null, weekly: null, mcp: null}, PACE_NOW);
        assertEqual(empty.get('zai_session_elapsed'), '0');
        assertEqual(empty.get('zai_session_pace'), '');
    });
});

describe('notifyRows / resetCredits', () => {
    it('rows for session, weekly and mcp when present', () => {
        const w = pct => ({utilizationPct: pct, resetsAt: null, windowMs: SESSION_MS});
        const rows = notifyRows({plan: 'Pro', session: w(1), weekly: null, mcp: w(99)});
        assertEqual(rows.map(r => r.key).join(','), 'session,mcp');
        assertEqual(rows[1].label, 'MCP tools (monthly)');
        assertEqual(resetCredits({}).length, 0);
    });
});

system.exit(summary());

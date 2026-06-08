import system from 'system';

import {
    parseEnvelope, zaiSeverity, zaiPeakUsage, placeholders, SESSION_MS, WEEKLY_MS, MCP_MS,
} from '../lib/vendors/zai-parse.js';
import {substitute} from '../lib/format.js';
import {Severity} from '../lib/severity.js';
import {describe, it, assertEqual, assertThrows, summary} from './_assert.js';

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

    it('missing data yields a neutral snapshot with the config tier', () => {
        const s = parseEnvelope('{"code":500,"success":false}', 'lite');
        assertEqual(s.plan, 'GLM Coding Lite');
        assertEqual(s.session, null);
        assertEqual(s.weekly, null);
        assertEqual(s.mcp, null);
    });

    it('rounds a float percentage', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":42.7}],"level":"max"}}', null);
        assertEqual(s.session.utilizationPct, 43);
    });

    it('clamps percentage to 100', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":150}]}}', null);
        assertEqual(s.session.utilizationPct, 100);
    });

    it('only a TIME_LIMIT → mcp only', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TIME_LIMIT","percentage":12}]}}', null);
        assertEqual(s.session, null);
        assertEqual(s.weekly, null);
        assertEqual(s.mcp === null, false);
    });

    it('uses the config tier when level is empty', () => {
        const s = parseEnvelope('{"data":{"limits":[],"level":""}}', 'max');
        assertEqual(s.plan, 'GLM Coding Max');
    });

    it('null nextResetTime → no reset', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":0,"nextResetTime":null}]}}', null);
        assertEqual(s.session.resetsAt, null);
    });

    it('throws SchemaError on a non-object top level', () => {
        assertThrows(() => parseEnvelope('[]', null));
        assertThrows(() => parseEnvelope('not json', null));
    });
});

describe('zaiSeverity', () => {
    it('picks the worst present window', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":10},{"type":"TOKENS_LIMIT","percentage":95}]}}', null);
        assertEqual(zaiSeverity(s), Severity.CRITICAL);
    });

    it('all windows absent → low', () =>
        assertEqual(zaiSeverity(parseEnvelope('{}', null)), Severity.LOW));
});

describe('zaiPeakUsage', () => {
    it('returns the peak percent and the winning window resets_at', () => {
        const s = parseEnvelope(JSON.stringify({data: {limits: [
            {type: 'TOKENS_LIMIT', percentage: 10},
            {type: 'TOKENS_LIMIT', percentage: 95, nextResetTime: 1779792169974},
        ]}}), null);
        const p = zaiPeakUsage(s);
        assertEqual(p.percent, 95);
        assertEqual(p.resetsAt, s.weekly.resetsAt);
    });
    it('all windows absent → 0 percent, null reset', () => {
        const p = zaiPeakUsage(parseEnvelope('{}', null));
        assertEqual(p.percent, 0);
        assertEqual(p.resetsAt, null);
    });
});

describe('placeholders', () => {
    const now = new Date('2026-06-05T00:00:00Z');

    it('renders the shared cross-vendor format', () => {
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":42}],"level":"pro"}}', null);
        assertEqual(substitute('{vendor_short} {session_pct}%', placeholders(s, now)), 'zai 42%');
    });

    it('absent session → session_reset is —', () => {
        const m = placeholders(parseEnvelope('{}', null), now);
        assertEqual(m.get('session_pct'), '0');
        assertEqual(m.get('session_reset'), '—');
        assertEqual(m.get('zai_mcp_pct'), '0');
    });

    it('the schema default bar-format renders the expected label', () => {
        // Regression guard for the default 'bar-format' template; '—' when the
        // session window reports no reset time.
        const DEFAULT = '{session_pct}% · {session_reset}';
        const s = parseEnvelope('{"data":{"limits":[{"type":"TOKENS_LIMIT","percentage":42}],"level":"pro"}}', null);
        assertEqual(substitute(DEFAULT, placeholders(s, now)), '42% · —');
    });
});

system.exit(summary());

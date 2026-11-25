import system from 'system';

import {
    parseFakePct, parseFakePcts, fakePctEnv, formatFakePcts, FAKE_PCT_KINDS, parseFakeErrorVendors, parseFakeDelayMs, FakeFailure, fakeResult, fakeHttpFailure, FAKE_ERROR_MESSAGE,
} from '../../lib/debug.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

describe('parseFakePct', () => {
    it('returns null when unset or blank', () => {
        assertEqual(parseFakePct(null), null);
        assertEqual(parseFakePct(undefined), null);
        assertEqual(parseFakePct(''), null);
        assertEqual(parseFakePct('   '), null);
    });

    it('returns null for non-numeric input', () => {
        assertEqual(parseFakePct('abc'), null);
        assertEqual(parseFakePct('12%'), null);
        assertEqual(parseFakePct('NaN'), null);
    });

    it('parses integers and floats', () => {
        assertEqual(parseFakePct('23'), 23);
        assertEqual(parseFakePct(' 5 '), 5);
        assertEqual(parseFakePct('42.7'), 42.7);
        assertEqual(parseFakePct(0), 0);
    });

    it('clamps to 0..100', () => {
        assertEqual(parseFakePct('-10'), 0);
        assertEqual(parseFakePct('150'), 100);
        assertEqual(parseFakePct('100'), 100);
    });
});

describe('parseFakePcts', () => {
    const from = env => name => env[name] ?? null;
    it('null when no FAKE_PCT env is set or every one is invalid', () => {
        assertEqual(parseFakePcts(from({})), null);
        assertEqual(parseFakePcts(from({AI_USAGEBAR_FAKE_PCT_WEEKLY: 'abc'})), null);
    });
    it('the base fills every kind', () => {
        const p = parseFakePcts(from({AI_USAGEBAR_FAKE_PCT: '40'}));
        assertEqual(p.base, 40);
        for (const kind of FAKE_PCT_KINDS)
            assertEqual(p[kind], 40, kind);
    });
    it('a kind overrides the base, clamped', () => {
        const p = parseFakePcts(from({AI_USAGEBAR_FAKE_PCT: '40', AI_USAGEBAR_FAKE_PCT_WEEKLY: '95', AI_USAGEBAR_FAKE_PCT_CODE_REVIEW: '150'}));
        assertEqual(p.weekly, 95);
        assertEqual(p.code_review, 100);
        assertEqual(p.session, 40);
    });
    it('a kind alone turns faking on, the rest at 0', () => {
        const p = parseFakePcts(from({AI_USAGEBAR_FAKE_PCT_SESSION: '85'}));
        assertEqual(p.base, 0);
        assertEqual(p.session, 85);
        assertEqual(p.weekly, 0);
    });
});

describe('fakePctEnv / formatFakePcts', () => {
    it('names the env in upper case', () => assertEqual(fakePctEnv('code_review'), 'AI_USAGEBAR_FAKE_PCT_CODE_REVIEW'));
    it('lists the base and the kinds that differ from it', () => {
        const env = {AI_USAGEBAR_FAKE_PCT: '40', AI_USAGEBAR_FAKE_PCT_WEEKLY: '95'};
        assertEqual(formatFakePcts(parseFakePcts(name => env[name] ?? null)), 'base=40 weekly=95');
    });
});

describe('parseFakeErrorVendors', () => {
    const known = ['anthropic', 'openai', 'zai'];
    const failures = raw => {
        const map = parseFakeErrorVendors(raw, known);
        return map === null ? null : Object.fromEntries(map);
    };
    const {ERROR, STALE} = FakeFailure;
    it('null when unset or blank', () => {
        assertEqual(failures(null), null);
        assertEqual(failures(undefined), null);
        assertEqual(failures(' , '), null);
    });
    it('a bare id is an error', () => assertDeepEqual(failures(' openai, zai '), {openai: ERROR, zai: ERROR}));
    it('id:stale is stale data', () => assertDeepEqual(failures('openai:stale,zai'), {openai: STALE, zai: ERROR}));
    it('drops unknown ids and modes, null when none is left', () => {
        assertDeepEqual(failures('openai,nope,zai:later'), {openai: ERROR});
        assertEqual(failures('nope'), null);
    });
    it('* means every vendor, and a later entry wins', () => {
        assertDeepEqual(failures('*'), {anthropic: ERROR, openai: ERROR, zai: ERROR});
        assertDeepEqual(failures('*:stale,zai'), {anthropic: STALE, openai: STALE, zai: ERROR});
    });
});

describe('parseFakeDelayMs', () => {
    it('null when unset, blank, non-numeric or not positive once rounded', () => {
        for (const raw of [null, undefined, '', ' ', 'abc', '0', '-5', '0.4'])
            assertEqual(parseFakeDelayMs(raw), null, String(raw));
    });
    it('whole milliseconds', () => {
        assertEqual(parseFakeDelayMs('5000'), 5000);
        assertEqual(parseFakeDelayMs(' 12.6 '), 13);
    });
    it('capped at two minutes', () => assertEqual(parseFakeDelayMs('999999'), 120000));
});

describe('fakeResult', () => {
    const snap = {plan: 'fake'};
    it('no failure: the synthetic snapshot, fresh', () => {
        assertDeepEqual(fakeResult(null, () => snap), {ok: true, snapshot: snap, stale: false, lastError: null, cacheAgeMs: 0});
    });
    it('stale: the snapshot marked stale with an HTTP 503', () => {
        assertDeepEqual(fakeResult(FakeFailure.STALE, () => snap),
            {ok: true, snapshot: snap, stale: true, lastError: {code: 503, body: FAKE_ERROR_MESSAGE}, cacheAgeMs: 0});
    });
    it('error: an error result, and no snapshot is built', () => {
        let built = false;
        const r = fakeResult(FakeFailure.ERROR, () => {
            built = true;
            return snap;
        });
        assertDeepEqual(r, {ok: false, kind: 'error', message: FAKE_ERROR_MESSAGE});
        assertEqual(built, false);
    });
});

describe('fakeHttpFailure', () => {
    it('is an HTTP 503 whose body names the override', () => {
        const r = fakeHttpFailure();
        assertEqual(r.status, 503);
        assertEqual(r.error, null);
        assertEqual(new TextDecoder().decode(r.bodyBytes), FAKE_ERROR_MESSAGE);
    });
});

system.exit(summary());

import system from 'system';

import {vendorAdapter, guardedFetch, apiKeyFetch} from '../../../lib/vendors/adapter-common.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';
import {runSync} from '../../_harness.js';

const parser = {
    ICON: 'i',
    VENDOR_SHORT: 'abc',
    placeholders: () => new Map(),
    notifyRows: () => [],
    resetCredits: () => [],
    fakeSnapshot: () => ({fake: true}),
};
const severity = () => 'low';
const peakUsage = () => ({percent: 0, resetsAt: null});
const buildSection = () => ({rows: []});

function recorder() {
    const calls = [];
    const fn = deps => {
        calls.push(deps);
        return Promise.resolve({ok: true, deps});
    };
    fn.calls = calls;
    return fn;
}

const CTX = {cache: 'C', http: 'H', signal: 'S', now: 'N'};

describe('vendorAdapter', () => {
    it('wires the parser, section and fetch into the adapter contract', () => {
        const fetch = () => null;
        const a = vendorAdapter({id: 'zz', parser, severity, peakUsage, buildSection, fetchSnapshot: fetch});
        assertDeepEqual(Object.keys(a).sort(), [
            'buildSection', 'cacheId', 'fakeSnapshot', 'fetchSnapshot', 'icon', 'id', 'notifyRows', 'peakUsage',
            'placeholders', 'resetCredits', 'severity', 'vendorShort',
        ]);
        assertEqual(a.id, 'zz');
        assertEqual(a.cacheId, 'zz');
        assertEqual(a.icon, 'i');
        assertEqual(a.vendorShort, 'abc');
        assertEqual(a.fetchSnapshot, fetch);
        assertEqual(a.placeholders, parser.placeholders);
        assertEqual(a.fakeSnapshot, parser.fakeSnapshot);
        assertEqual(a.buildSection, buildSection);
    });
    it('leaves fakeSnapshot out when the parser has none', () => {
        const {fakeSnapshot: _f, ...plain} = parser;
        const a = vendorAdapter({id: 'zz', parser: plain, severity, peakUsage, buildSection, fetchSnapshot: () => null});
        assertEqual('fakeSnapshot' in a, false);
    });
    it('passes extra fields through', () => {
        const a = vendorAdapter({id: 'zz', parser, severity, peakUsage, buildSection, fetchSnapshot: () => null, extra: {shortCode: () => 'X'}});
        assertEqual(a.shortCode(), 'X');
    });
});

describe('guardedFetch', () => {
    it('merges the prepared deps over cache, http, signal and now', () => {
        const fetch = recorder();
        runSync(guardedFetch(() => ({credsPath: '/p'}), fetch)(CTX));
        assertDeepEqual(fetch.calls[0], {cache: 'C', http: 'H', signal: 'S', now: 'N', credsPath: '/p'});
    });
    it('a throwing prepare is an error result, with no fetch', () => {
        const fetch = recorder();
        const r = runSync(guardedFetch(() => {
            throw new Error('no path');
        }, fetch)(CTX));
        assertDeepEqual(r, {ok: false, kind: 'error', message: 'no path'});
        assertEqual(fetch.calls.length, 0);
    });
});

describe('apiKeyFetch', () => {
    const config = cfg => ({...CTX, config: {vendors: {zz: cfg}}});

    it('the env var wins over the inline key', () => {
        const fetch = recorder();
        const getenv = name => (name === 'ZZ_KEY' ? 'from-env' : null);
        runSync(apiKeyFetch({label: 'ZZ', vendor: 'zz', fetchSnapshot: fetch, getenv})(config({apiKeyEnv: 'ZZ_KEY', apiKey: 'inline'})));
        assertEqual(fetch.calls[0].apiKey, 'from-env');
    });
    it('falls back to the inline key', () => {
        const fetch = recorder();
        runSync(apiKeyFetch({label: 'ZZ', vendor: 'zz', fetchSnapshot: fetch, getenv: () => null})(config({apiKeyEnv: 'ZZ_KEY', apiKey: 'inline'})));
        assertEqual(fetch.calls[0].apiKey, 'inline');
    });
    it('no key at all is an error naming the vendor', () => {
        const r = runSync(apiKeyFetch({label: 'ZZ', vendor: 'zz', fetchSnapshot: recorder(), getenv: () => null})(config({apiKeyEnv: 'ZZ_KEY', apiKey: null})));
        assertEqual(r.ok, false);
        assertEqual(r.message.startsWith('ZZ: no API key; export ZZ_KEY'), true, r.message);
    });
    it('adds what extra derives from the vendor config', () => {
        const fetch = recorder();
        const getenv = () => 'k';
        runSync(apiKeyFetch({
            label: 'ZZ', vendor: 'zz', fetchSnapshot: fetch, getenv,
            extra: (cfg, env) => ({plan: cfg.plan, sawGetenv: env === getenv}),
        })(config({apiKeyEnv: 'E', apiKey: null, plan: 'Pro'})));
        assertEqual(fetch.calls[0].plan, 'Pro');
        assertEqual(fetch.calls[0].sawGetenv, true);
        assertEqual(fetch.calls[0].cache, 'C');
    });
});

describe('vendorAdapter: default severity', () => {
    const make = peak => vendorAdapter({id: 'zz', parser, peakUsage: () => peak, buildSection, fetchSnapshot: () => null});

    it('derives the severity from the peak usage', () => {
        assertEqual(make({percent: 95, resetsAt: null}).severity({}), 'critical');
        assertEqual(make({percent: 10, resetsAt: null}).severity({}), 'low');
    });
    it('no peak reads as low', () => assertEqual(make({percent: null, resetsAt: null}).severity({}), 'low'));
    it('an explicit severity wins', () => {
        const a = vendorAdapter({id: 'zz', parser, severity, peakUsage: () => ({percent: 99}), buildSection, fetchSnapshot: () => null});
        assertEqual(a.severity({}), 'low');
    });
});

system.exit(summary());

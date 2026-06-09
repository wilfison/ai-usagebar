import system from 'system';

import {ADAPTERS, getAdapter} from '../../../lib/vendors/registry.js';
import {VENDOR_IDS} from '../../../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';

const SHAPE = {
    id: 'string',
    cacheId: 'string',
    icon: 'string',
    vendorShort: 'string',
    fetchSnapshot: 'function',
    severity: 'function',
    peakUsage: 'function',
    placeholders: 'function',
    buildSection: 'function',
};

describe('ADAPTERS structure', () => {
    it('registers exactly the known vendor ids', () => {
        assertDeepEqual(Object.keys(ADAPTERS).sort(), [...VENDOR_IDS].sort());
    });

    for (const [key, adapter] of Object.entries(ADAPTERS)) {
        describe(key, () => {
            for (const [prop, type] of Object.entries(SHAPE)) {
                it(`has ${prop}: ${type}`, () => {
                    assertEqual(typeof adapter[prop], type, `${key}.${prop}`);
                });
            }

            it('carries no properties beyond the contract', () => {
                const extra = Object.keys(adapter).filter(k => !(k in SHAPE));
                assertEqual(extra.length, 0, `${key} extra keys: ${extra.join(',')}`);
            });

            it('id matches its registry key', () => {
                assertEqual(adapter.id, key);
            });

            it('uses a non-empty cacheId', () => {
                assertEqual(adapter.cacheId.length > 0, true);
            });
        });
    }
});

describe('getAdapter', () => {
    it('returns the adapter for a known id', () => {
        assertEqual(getAdapter('zai'), ADAPTERS.zai);
    });

    it('falls back to anthropic for an unknown id', () => {
        assertEqual(getAdapter('nope'), ADAPTERS.anthropic);
    });
});

system.exit(summary());

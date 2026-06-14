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

// Optional, dev-only hooks an adapter may expose (e.g. AI_USAGEBAR_FAKE_PCT).
const OPTIONAL_SHAPE = {
    fakeSnapshot: 'function',
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
                const extra = Object.keys(adapter)
                    .filter(k => !(k in SHAPE) && !(k in OPTIONAL_SHAPE));
                assertEqual(extra.length, 0, `${key} extra keys: ${extra.join(',')}`);
            });

            for (const [prop, type] of Object.entries(OPTIONAL_SHAPE)) {
                it(`if present, ${prop} is ${type}`, () => {
                    if (prop in adapter)
                        assertEqual(typeof adapter[prop], type, `${key}.${prop}`);
                });
            }

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

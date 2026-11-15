import system from 'system';

import {vendorPageSpec, RowType, schemaRange, schemaChoices} from '../../lib/prefs-pages.js';
import {VENDOR_IDS} from '../../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';
import {extensionSchema} from '../_harness.js';

const SCHEMA = extensionSchema();
const TYPE_OF_ROW = {[RowType.SWITCH]: 'b', [RowType.ENTRY]: 's', [RowType.PASSWORD]: 's', [RowType.SPIN]: 'i'};
const fake = s => `<${s}>`;
const rowsOf = spec => spec.groups.flatMap(g => g.rows);

// The rows each built-in page shows, top to bottom: [type, key].
const LAYOUT = {
    anthropic: [
        ['switch', 'anthropic-enabled'], ['entry', 'anthropic-credentials-path'],
        ['switch', 'context-enabled'], ['entry', 'context-projects-path'], ['spin', 'context-window-tokens'], ['entry', 'context-model-windows'],
    ],
    openai: [['switch', 'openai-enabled'], ['entry', 'openai-codex-auth-path']],
    zai: [['switch', 'zai-enabled'], ['entry', 'zai-api-key-env'], ['password', 'zai-api-key'], ['entry', 'zai-plan-tier']],
    openrouter: [
        ['switch', 'openrouter-enabled'], ['entry', 'openrouter-api-key-env'], ['password', 'openrouter-api-key'],
        ['entry', 'openrouter-management-key-env'], ['password', 'openrouter-management-key'],
    ],
    deepseek: [['switch', 'deepseek-enabled'], ['entry', 'deepseek-api-key-env'], ['password', 'deepseek-api-key']],
    kimi: [['switch', 'kimi-enabled'], ['entry', 'kimi-api-key-env'], ['password', 'kimi-api-key']],
    ollama: [['switch', 'ollama-enabled'], ['entry', 'ollama-api-key-env'], ['password', 'ollama-api-key'], ['entry', 'ollama-plan']],
};

describe('vendorPageSpec: coverage', () => {
    it('describes every vendor but the custom provider', () => {
        assertDeepEqual(VENDOR_IDS.filter(id => vendorPageSpec(id) !== null), Object.keys(LAYOUT));
        assertEqual(vendorPageSpec('custom'), null);
    });
});

for (const [id, layout] of Object.entries(LAYOUT)) {
    describe(`vendorPageSpec: ${id}`, () => {
        const spec = vendorPageSpec(id);
        it('lists its rows in order', () => assertDeepEqual(rowsOf(spec).map(r => [r.type, r.key]), layout));
        it('opens with the Enabled switch', () => assertDeepEqual(rowsOf(spec)[0], {type: 'switch', key: `${id}-enabled`, title: 'Enabled'}));
        it('every key exists in the schema with the row type', () => {
            for (const row of rowsOf(spec)) {
                assertEqual(SCHEMA.has_key(row.key), true, row.key);
                assertEqual(SCHEMA.get_key(row.key).get_value_type().dup_string(), TYPE_OF_ROW[row.type], row.key);
            }
        });
        it('every group has a title and every row one', () => {
            for (const g of spec.groups) {
                assertEqual(typeof g.title, 'string');
                for (const r of g.rows)
                    assertEqual(r.title.length > 0, true, r.key);
            }
        });
        it('titles and descriptions go through the translator', () => {
            const t = vendorPageSpec(id, fake);
            for (const g of t.groups) {
                assertEqual(g.title.startsWith('<'), true, g.title);
                if (g.description)
                    assertEqual(g.description.startsWith('<'), true, g.description);
                for (const r of g.rows)
                    assertEqual(r.title.startsWith('<'), true, r.title);
            }
        });
    });
}

describe('vendorPageSpec: details', () => {
    it('the Z.AI page', () => {
        assertDeepEqual(vendorPageSpec('zai'), {groups: [{
            title: 'Z.AI',
            description: 'Set the API key inline or via the environment variable (env wins).',
            rows: [
                {type: 'switch', key: 'zai-enabled', title: 'Enabled'},
                {type: 'entry', key: 'zai-api-key-env', title: 'API key env var'},
                {type: 'password', key: 'zai-api-key', title: 'API key (inline)'},
                {type: 'entry', key: 'zai-plan-tier', title: 'Plan tier (lite/pro/max)'},
            ],
        }]});
    });
    it('the context window spin keeps its subtitle; its range is the schema\'s', () => {
        const spin = rowsOf(vendorPageSpec('anthropic')).find(r => r.type === 'spin');
        assertDeepEqual(spin, {
            type: 'spin', key: 'context-window-tokens', title: 'Default context window (tokens)',
            subtitle: '0 shows raw token counts instead of a percentage',
            step: 1000, page: 100000,
        });
    });
    it('OpenRouter has a second group for the management key', () => {
        assertDeepEqual(vendorPageSpec('openrouter').groups.map(g => g.title), ['OpenRouter', 'Recent models']);
    });
});

describe('validated entries', () => {
    it('the model windows entry is checked before it is saved', () => {
        const row = rowsOf(vendorPageSpec('anthropic', fake)).find(r => r.key === 'context-model-windows');
        assertEqual(typeof row.validate, 'function');
        assertDeepEqual(row.validate('{"m": 1}', fake), []);
        assertEqual(row.validate('{"m": 0}', fake).length, 1);
    });
});

describe('schemaRange / schemaChoices', () => {
    it('reads an integer key\'s bounds from the schema', () => {
        assertDeepEqual(schemaRange(SCHEMA, 'refresh-interval'), {lower: 300, upper: 86400});
        assertDeepEqual(schemaRange(SCHEMA, 'panel-index'), {lower: 0, upper: 20});
    });
    it('a key without a range has no bounds', () => assertDeepEqual(schemaRange(SCHEMA, 'bar-format'), {}));
    it('reads the choices of a string or enum key', () => {
        assertDeepEqual(schemaChoices(SCHEMA, 'panel-box'), ['left', 'center', 'right']);
        assertDeepEqual(schemaChoices(SCHEMA, 'bar-format'), []);
    });
    it('the primary-vendor combo index is its enum value: the nicks follow VENDOR_IDS', () =>
        assertDeepEqual(schemaChoices(SCHEMA, 'primary-vendor'), VENDOR_IDS));
    it('no spin row hard-codes the bounds the schema already has', () => {
        for (const id of VENDOR_IDS) {
            for (const row of rowsOf(vendorPageSpec(id, fake) ?? {groups: []}).filter(r => r.type === RowType.SPIN))
                assertEqual('lower' in row || 'upper' in row, false, row.key);
        }
    });
});

system.exit(summary());

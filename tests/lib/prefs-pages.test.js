import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {vendorPageSpec, RowType} from '../../lib/prefs-pages.js';
import {VENDOR_IDS} from '../../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.ai-usagebar';

function schema() {
    const path = import.meta.url.replace(/^file:\/\//u, '');
    const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(path)));
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([root, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
    return source.lookup(SCHEMA_ID, false);
}

const SCHEMA = schema();
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
    it('the context window spin keeps its range and subtitle', () => {
        const spin = rowsOf(vendorPageSpec('anthropic')).find(r => r.type === 'spin');
        assertDeepEqual(spin, {
            type: 'spin', key: 'context-window-tokens', title: 'Default context window (tokens)',
            subtitle: '0 shows raw token counts instead of a percentage',
            lower: 0, upper: 100000000, step: 1000, page: 100000,
        });
    });
    it('OpenRouter has a second group for the management key', () => {
        assertDeepEqual(vendorPageSpec('openrouter').groups.map(g => g.title), ['OpenRouter', 'Recent models']);
    });
});

system.exit(summary());

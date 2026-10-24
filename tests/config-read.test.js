import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

// Isolate from the user's real dconf store: select the memory backend before
// any Gio.Settings is constructed.
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import {readConfig, initializePanelVendors, anthropicCredsPath, codexAuthPath} from '../lib/config.js';
import {VENDOR_IDS} from '../lib/vendors.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.ai-usagebar';

function schemasDir() {
    const url = import.meta.url;
    const path = url.startsWith('file://') ? url.slice('file://'.length) : url;
    const tests = GLib.path_get_dirname(path);
    return GLib.build_filenamev([GLib.path_get_dirname(tests), 'schemas']);
}

function makeSettings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        schemasDir(),
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = source.lookup(SCHEMA_ID, false);
    return Gio.Settings.new_full(schema, null, null);
}

describe('readConfig: schema defaults', () => {
    const cfg = readConfig(makeSettings());
    it('refresh interval defaults to 300', () => assertEqual(cfg.refreshIntervalSecs, 300));
    it('vendor logos shown by default', () => assertEqual(cfg.showVendorIcons, true));
    it('panel position defaults to right of the clock', () => {
        assertEqual(cfg.panel.box, 'center');
        assertEqual(cfg.panel.index, 1);
    });
    it('default bar format', () =>
        assertEqual(cfg.barFormat, '{session_pct}% · {session_reset}'));
    it('panel defaults to the default active vendor', () =>
        assertDeepEqual(cfg.panelVendorIds, ['anthropic']));
    it('vendor labels use the default when empty', () =>
        assertEqual(cfg.vendorBarFormats.openai, ''));
    it('primary vendor defaults to anthropic', () => assertEqual(cfg.primaryVendor, 'anthropic'));
    it('anthropic enabled by default', () => assertEqual(cfg.vendors.anthropic.enabled, true));
    it('anthropic creds path unset → null', () => assertEqual(cfg.vendors.anthropic.credentialsPath, null));
    it('deepseek disabled by default', () => assertEqual(cfg.vendors.deepseek.enabled, false));
    it('zai env var name default', () => assertEqual(cfg.vendors.zai.apiKeyEnv, 'ZAI_API_KEY'));
    it('openai admin env default', () => assertEqual(cfg.vendors.openai.adminKeyEnv, 'OPENAI_ADMIN_KEY'));
    it('tooltip format unset → null', () => assertEqual(cfg.tooltipFormat, null));
    it('color override unset → null', () => assertEqual(cfg.colors.low, null));
    it('mid color unset → null', () => assertEqual(cfg.colors.mid, null));
    it('high color unset → null', () => assertEqual(cfg.colors.high, null));
    it('critical color unset → null', () => assertEqual(cfg.colors.critical, null));
    it('openai codex auth path unset → null', () =>
        assertEqual(cfg.vendors.openai.codexAuthPath, null));
    it('zai api key unset → null', () => assertEqual(cfg.vendors.zai.apiKey, null));
    it('zai plan tier unset → null', () => assertEqual(cfg.vendors.zai.planTier, null));
    it('openrouter api key unset → null', () => assertEqual(cfg.vendors.openrouter.apiKey, null));
    it('deepseek api key unset → null', () => assertEqual(cfg.vendors.deepseek.apiKey, null));
    it('kimi disabled by default', () => assertEqual(cfg.vendors.kimi.enabled, false));
    it('kimi env var name default', () => assertEqual(cfg.vendors.kimi.apiKeyEnv, 'KIMI_API_KEY'));
    it('kimi api key unset → null', () => assertEqual(cfg.vendors.kimi.apiKey, null));
    it('ollama disabled by default', () => assertEqual(cfg.vendors.ollama.enabled, false));
    it('ollama env var name default', () => assertEqual(cfg.vendors.ollama.apiKeyEnv, 'OLLAMA_API_KEY'));
    it('ollama api key unset → null', () => assertEqual(cfg.vendors.ollama.apiKey, null));
    it('ollama plan unset → null', () => assertEqual(cfg.vendors.ollama.plan, null));
    it('active vendor defaults to anthropic', () => assertEqual(cfg.activeVendor, 'anthropic'));
    it('pace marker off by default', () => assertEqual(cfg.showPaceMarker, false));
    it('notifications on by default', () => assertEqual(cfg.notifications.enabled, true));
    it('notify threshold defaults to 97', () => assertEqual(cfg.notifications.threshold, 97));
    it('update check on by default', () => assertEqual(cfg.updateCheck.enabled, true));
    it('openrouter env var name default', () =>
        assertEqual(cfg.vendors.openrouter.apiKeyEnv, 'OPENROUTER_API_KEY'));
    it('deepseek env var name default', () =>
        assertEqual(cfg.vendors.deepseek.apiKeyEnv, 'DEEPSEEK_API_KEY'));
    it('anthropicCredsPath falls back to the default path', () =>
        assertEqual(anthropicCredsPath(cfg).endsWith('/.claude/.credentials.json'), true));
    it('codexAuthPath falls back to the default path', () =>
        assertEqual(codexAuthPath(cfg).endsWith('/.codex/auth.json'), true));
});

describe('readConfig: overrides', () => {
    const settings = makeSettings();
    settings.set_string('anthropic-credentials-path', '/tmp/x.json');
    settings.set_string('openai-codex-auth-path', '/tmp/auth.json');
    settings.set_string('color-mid', '#abcdef');
    settings.set_string('zai-api-key', 'zk');
    settings.set_string('openrouter-api-key', 'ork');
    settings.set_string('deepseek-api-key', 'dsk');
    settings.set_string('active-vendor', 'zai');
    settings.set_boolean('show-pace-marker', true);
    settings.set_strv('panel-vendors', ['anthropic', 'openai']);
    settings.set_string('bar-format-openai', '{weekly_pct}%');
    settings.set_int('refresh-interval', 600);
    settings.set_boolean('deepseek-enabled', true);
    settings.set_boolean('notify-enabled', true);
    settings.set_int('notify-threshold', 75);
    settings.set_boolean('update-check-enabled', false);
    const cfg = readConfig(settings);
    it('honors the creds-path override', () =>
        assertEqual(cfg.vendors.anthropic.credentialsPath, '/tmp/x.json'));
    it('anthropicCredsPath uses the override', () =>
        assertEqual(anthropicCredsPath(cfg), '/tmp/x.json'));
    it('honors the codex-auth-path override', () =>
        assertEqual(cfg.vendors.openai.codexAuthPath, '/tmp/auth.json'));
    it('codexAuthPath uses the override', () =>
        assertEqual(codexAuthPath(cfg), '/tmp/auth.json'));
    it('passes a non-empty color through', () => assertEqual(cfg.colors.mid, '#abcdef'));
    it('passes a non-empty zai key through', () => assertEqual(cfg.vendors.zai.apiKey, 'zk'));
    it('passes a non-empty openrouter key through', () =>
        assertEqual(cfg.vendors.openrouter.apiKey, 'ork'));
    it('passes a non-empty deepseek key through', () =>
        assertEqual(cfg.vendors.deepseek.apiKey, 'dsk'));
    it('honors the active-vendor override', () => assertEqual(cfg.activeVendor, 'zai'));
    it('honors the pace-marker toggle', () => assertEqual(cfg.showPaceMarker, true));
    it('honors the selected panel vendors', () =>
        assertEqual(JSON.stringify(cfg.panelVendorIds), '["anthropic","openai"]'));
    it('honors a vendor-specific label', () => assertEqual(cfg.vendorBarFormats.openai, '{weekly_pct}%'));
    it('honors the refresh-interval override', () => assertEqual(cfg.refreshIntervalSecs, 600));
    it('honors a vendor enable toggle', () => assertEqual(cfg.vendors.deepseek.enabled, true));
    it('honors the notify-enabled toggle', () => assertEqual(cfg.notifications.enabled, true));
    it('honors the notify-threshold override', () => assertEqual(cfg.notifications.threshold, 75));
    it('honors the update-check toggle', () => assertEqual(cfg.updateCheck.enabled, false));
});

describe('readConfig: custom provider', () => {
    it('defaults', () => {
        const c = readConfig(makeSettings()).vendors.custom;
        assertEqual(c.enabled, false);
        assertEqual(c.name, 'Custom');
        assertEqual(c.url, '');
        assertEqual(c.allowHttp, false);
        assertEqual(c.apiKeyEnv, null);
        assertEqual(c.apiKey, null);
        assertEqual(c.authHeader, 'Authorization');
        assertEqual(c.authScheme, 'Bearer');
        assertEqual(JSON.stringify(c.extraHeaders), '{}');
        // No mapping yet: the adapter refuses to fetch.
        assertEqual(c.mapping, null);
    });

    it('parses the JSON prefs; invalid JSON becomes null', () => {
        const settings = makeSettings();
        settings.set_string('custom-mapping', '{"metrics":[{"label":"Requests","percent":"/pct"}]}');
        settings.set_string('custom-extra-headers', '{"X-Team":"core"}');
        let c = readConfig(settings).vendors.custom;
        assertEqual(c.mapping.metrics[0].label, 'Requests');
        assertEqual(c.extraHeaders['X-Team'], 'core');

        settings.set_string('custom-mapping', '{not json');
        settings.set_string('custom-extra-headers', '{"Authorization":"x"}');
        c = readConfig(settings).vendors.custom;
        assertEqual(c.mapping, null);
        assertEqual(c.extraHeaders, null);
    });

    it('a blank name reads Custom; a long one is capped at 48', () => {
        const settings = makeSettings();
        settings.set_string('custom-name', '   ');
        assertEqual(readConfig(settings).vendors.custom.name, 'Custom');
        settings.set_string('custom-name', 'x'.repeat(60));
        assertEqual(readConfig(settings).vendors.custom.name.length, 48);
    });
});

describe('readConfig: context monitor', () => {
    it('off by default, nothing configured', () => {
        const c = readConfig(makeSettings()).context;
        assertEqual(c.enabled, false);
        assertEqual(c.projectsPath, null);
        assertEqual(c.windowTokens, null);
        assertEqual(JSON.stringify(c.modelWindows), '{}');
    });

    it('reads the window settings', () => {
        const settings = makeSettings();
        settings.set_int('context-window-tokens', 200000);
        settings.set_string('context-model-windows', '{"claude-opus-5": 1000000, "bad": 0}');
        const c = readConfig(settings).context;
        assertEqual(c.windowTokens, 200000);
        assertEqual(JSON.stringify(c.modelWindows), '{"claude-opus-5":1000000}');
    });
});

describe('initializePanelVendors', () => {
    const settings = makeSettings();
    const reset = () => {
        for (const key of ['panel-vendors', 'primary-vendor', 'active-vendor',
            ...VENDOR_IDS.map(id => `${id}-enabled`)])
            settings.reset(key);
    };

    it('preserves the active panel vendor on upgrade', () => {
        reset();
        settings.set_string('active-vendor', 'openai');
        initializePanelVendors(settings);
        assertDeepEqual(settings.get_strv('panel-vendors'), ['openai']);
    });
    it('uses the enabled primary when the active vendor is disabled', () => {
        reset();
        settings.set_string('active-vendor', 'deepseek');
        settings.set_string('primary-vendor', 'zai');
        initializePanelVendors(settings);
        assertDeepEqual(settings.get_strv('panel-vendors'), ['zai']);
    });
    it('selects no panel vendor when every vendor is disabled', () => {
        reset();
        for (const id of VENDOR_IDS)
            settings.set_boolean(`${id}-enabled`, false);
        initializePanelVendors(settings);
        assertDeepEqual(settings.get_strv('panel-vendors'), []);
    });
    it('retains an explicitly saved empty selection', () => {
        reset();
        settings.set_strv('panel-vendors', []);
        initializePanelVendors(settings);
        assertDeepEqual(settings.get_strv('panel-vendors'), []);
    });
    it('retains a saved multi-vendor selection across repeated initialization', () => {
        reset();
        settings.set_strv('panel-vendors', ['anthropic', 'openai']);
        initializePanelVendors(settings);
        settings.set_string('active-vendor', 'zai');
        initializePanelVendors(settings);
        assertDeepEqual(settings.get_strv('panel-vendors'), ['anthropic', 'openai']);
    });
    reset();
});

system.exit(summary());

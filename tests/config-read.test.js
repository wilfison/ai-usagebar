import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

// Isolate from the user's real dconf store — select the memory backend before
// any Gio.Settings is constructed.
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import {readConfig, anthropicCredsPath, codexAuthPath} from '../lib/config.js';
import {describe, it, assertEqual, summary} from './_assert.js';

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

describe('readConfig — schema defaults', () => {
    const cfg = readConfig(makeSettings());
    it('refresh interval defaults to 300', () => assertEqual(cfg.refreshIntervalSecs, 300));
    it('default bar format', () =>
        assertEqual(cfg.barFormat, '{session_pct}% · {session_reset}'));
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
    it('active vendor defaults to anthropic', () => assertEqual(cfg.activeVendor, 'anthropic'));
    it('pace marker off by default', () => assertEqual(cfg.showPaceMarker, false));
    it('notifications on by default', () => assertEqual(cfg.notifications.enabled, true));
    it('notify threshold defaults to 90', () => assertEqual(cfg.notifications.threshold, 90));
    it('openrouter env var name default', () =>
        assertEqual(cfg.vendors.openrouter.apiKeyEnv, 'OPENROUTER_API_KEY'));
    it('deepseek env var name default', () =>
        assertEqual(cfg.vendors.deepseek.apiKeyEnv, 'DEEPSEEK_API_KEY'));
    it('anthropicCredsPath falls back to the default path', () =>
        assertEqual(anthropicCredsPath(cfg).endsWith('/.claude/.credentials.json'), true));
    it('codexAuthPath falls back to the default path', () =>
        assertEqual(codexAuthPath(cfg).endsWith('/.codex/auth.json'), true));
});

describe('readConfig — overrides', () => {
    const settings = makeSettings();
    settings.set_string('anthropic-credentials-path', '/tmp/x.json');
    settings.set_string('openai-codex-auth-path', '/tmp/auth.json');
    settings.set_string('color-mid', '#abcdef');
    settings.set_string('zai-api-key', 'zk');
    settings.set_string('openrouter-api-key', 'ork');
    settings.set_string('deepseek-api-key', 'dsk');
    settings.set_string('active-vendor', 'zai');
    settings.set_boolean('show-pace-marker', true);
    settings.set_int('refresh-interval', 600);
    settings.set_boolean('deepseek-enabled', true);
    settings.set_boolean('notify-enabled', true);
    settings.set_int('notify-threshold', 75);
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
    it('honors the refresh-interval override', () => assertEqual(cfg.refreshIntervalSecs, 600));
    it('honors a vendor enable toggle', () => assertEqual(cfg.vendors.deepseek.enabled, true));
    it('honors the notify-enabled toggle', () => assertEqual(cfg.notifications.enabled, true));
    it('honors the notify-threshold override', () => assertEqual(cfg.notifications.threshold, 75));
});

system.exit(summary());

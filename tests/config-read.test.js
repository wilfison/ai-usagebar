import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

// Isolate from the user's real dconf store — select the memory backend before
// any Gio.Settings is constructed.
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import {readConfig, anthropicCredsPath} from '../lib/config.js';
import {describe, it, assertEqual, summary} from './_assert.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.ai-usagebar';

/** Absolute path to the repo's schemas/ dir (sibling of tests/). */
function schemasDir() {
    const url = import.meta.url;
    const path = url.startsWith('file://') ? url.slice('file://'.length) : url;
    const tests = GLib.path_get_dirname(path);
    return GLib.build_filenamev([GLib.path_get_dirname(tests), 'schemas']);
}

/** A fresh Gio.Settings bound to the compiled schema on the memory backend. */
function makeSettings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        schemasDir(),
        Gio.SettingsSchemaSource.get_default(),
        false,
    );
    const schema = source.lookup(SCHEMA_ID, false);
    return Gio.Settings.new_full(schema, null, null);
}

describe('readConfig — schema defaults', () => {
    const cfg = readConfig(makeSettings());
    it('refresh interval defaults to 300', () => assertEqual(cfg.refreshIntervalSecs, 300));
    it('default bar format', () =>
        assertEqual(cfg.barFormat, '{vendor_short} {session_pct}% · {session_reset}'));
    it('primary vendor defaults to anthropic', () => assertEqual(cfg.primaryVendor, 'anthropic'));
    it('anthropic enabled by default', () => assertEqual(cfg.vendors.anthropic.enabled, true));
    it('anthropic creds path unset → null', () => assertEqual(cfg.vendors.anthropic.credentialsPath, null));
    it('deepseek disabled by default', () => assertEqual(cfg.vendors.deepseek.enabled, false));
    it('zai env var name default', () => assertEqual(cfg.vendors.zai.apiKeyEnv, 'ZAI_API_KEY'));
    it('openai admin env default', () => assertEqual(cfg.vendors.openai.adminKeyEnv, 'OPENAI_ADMIN_KEY'));
    it('tooltip format unset → null', () => assertEqual(cfg.tooltipFormat, null));
    it('color override unset → null', () => assertEqual(cfg.colors.low, null));
    it('anthropicCredsPath falls back to the default path', () =>
        assertEqual(anthropicCredsPath(cfg).endsWith('/.claude/.credentials.json'), true));
});

describe('readConfig — overrides', () => {
    const settings = makeSettings();
    settings.set_string('anthropic-credentials-path', '/tmp/x.json');
    settings.set_int('refresh-interval', 600);
    settings.set_boolean('deepseek-enabled', true);
    const cfg = readConfig(settings);
    it('honors the creds-path override', () =>
        assertEqual(cfg.vendors.anthropic.credentialsPath, '/tmp/x.json'));
    it('anthropicCredsPath uses the override', () =>
        assertEqual(anthropicCredsPath(cfg), '/tmp/x.json'));
    it('honors the refresh-interval override', () => assertEqual(cfg.refreshIntervalSecs, 600));
    it('honors a vendor enable toggle', () => assertEqual(cfg.vendors.deepseek.enabled, true));
});

system.exit(summary());

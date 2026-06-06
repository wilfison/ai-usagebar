/**
 * @file GTK preferences window for ai-usagebar. Runs in a separate process from
 * gnome-shell, so it imports only `gi://{Adw,Gtk,Gio}`, the prefs.js resource,
 * and the PURE `lib/vendors.js` — never shell modules or the gi-bound adapter
 * registry. Adds six pages (General + one per vendor) bound to GSettings.
 *
 * Surfaces only the keys the extension consumes: `color-*` and `tooltip-format`
 * are deferred to Step 11, and `openai-admin-key-env` is intentionally not shown
 * (OpenAI is Codex-OAuth-only). Inline API keys use a masked entry with a reveal
 * toggle and live only in dconf.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {VENDOR_LABELS} from './lib/vendors.js';

/** @type {number} Schema floor for the refresh interval (seconds). */
const INTERVAL_MIN = 300;
/** @type {number} Schema ceiling for the refresh interval (seconds). */
const INTERVAL_MAX = 86400;
/** @type {string} Cross-vendor placeholder hint shown under the bar-format row. */
const BAR_PLACEHOLDERS =
    'Placeholders: {vendor_short} {session_pct}% {session_reset} {plan} ' +
    '{weekly_pct} {weekly_reset}';

/**
 * Preferences entry point. Populates the provided `Adw.PreferencesWindow` with a
 * General page plus one page per vendor, all bound to the extension's GSettings.
 * @extends ExtensionPreferences
 */
export default class AiUsagebarPreferences extends ExtensionPreferences {
    /**
     * Add the General + per-vendor pages to `window`. Wires the manual signals
     * (the enum combo + the int spin-row), then disconnects them on window close
     * so the prefs process is leak-clean. Rows bound via `Gio.Settings.bind`
     * auto-unbind on widget destroy and need no manual teardown.
     * @param {Adw.PreferencesWindow} window
     * @returns {void}
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        /** @type {Array<() => void>} disconnect callbacks run on window close. */
        const cleanups = [];

        window.add(this._buildGeneralPage(settings, cleanups));
        window.add(this._buildAnthropicPage(settings));
        window.add(this._buildOpenAiPage(settings));
        window.add(this._buildZaiPage(settings));
        window.add(this._buildOpenRouterPage(settings));
        window.add(this._buildDeepSeekPage(settings));

        window.connect('close-request', () => {
            for (const disconnect of cleanups)
                disconnect();
            return false;
        });
    }

    /**
     * General page: primary-vendor combo, refresh interval, bar format.
     * @param {Gio.Settings} settings
     * @param {Array<() => void>} cleanups - sink for manual-signal disconnects.
     * @returns {Adw.PreferencesPage}
     */
    _buildGeneralPage(settings, cleanups) {
        const page = new Adw.PreferencesPage({title: 'General'});

        // --- Primary vendor (enum combo) ---
        const displayGroup = new Adw.PreferencesGroup({title: 'Display'});
        const model = new Gtk.StringList();
        for (const label of VENDOR_LABELS)
            model.append(label);
        const combo = new Adw.ComboRow({
            title: 'Primary vendor',
            subtitle: 'Shown by default and used as the scroll-cycle reset target',
            model,
        });
        // The schema enum nicks are ordered identically to VENDOR_IDS / VENDOR_LABELS,
        // so the combo index IS the enum value. GJS lacks bind_with_mapping, so wire
        // it manually with get_enum/set_enum and a resync handler.
        combo.selected = settings.get_enum('primary-vendor');
        const comboNotifyId = combo.connect('notify::selected', () => {
            if (settings.get_enum('primary-vendor') !== combo.selected)
                settings.set_enum('primary-vendor', combo.selected);
        });
        const comboResyncId = settings.connect('changed::primary-vendor', () => {
            const v = settings.get_enum('primary-vendor');
            if (combo.selected !== v)
                combo.selected = v;
        });
        cleanups.push(() => {
            combo.disconnect(comboNotifyId);
            settings.disconnect(comboResyncId);
        });
        displayGroup.add(combo);
        page.add(displayGroup);

        // --- Refresh interval (int key <-> double SpinRow.value, wired manually) ---
        const cadenceGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
            description: `Minimum ${INTERVAL_MIN} s — the upstream endpoints rate-limit below that.`,
        });
        const adjustment = new Gtk.Adjustment({
            lower: INTERVAL_MIN,
            upper: INTERVAL_MAX,
            step_increment: 60,
            page_increment: 300,
        });
        const interval = new Adw.SpinRow({
            title: 'Refresh interval (seconds)',
            adjustment,
            digits: 0,
        });
        interval.set_value(settings.get_int('refresh-interval'));
        const intervalNotifyId = interval.connect('notify::value', () => {
            const v = Math.round(interval.get_value());
            if (settings.get_int('refresh-interval') !== v)
                settings.set_int('refresh-interval', v);
        });
        const intervalResyncId = settings.connect('changed::refresh-interval', () => {
            const v = settings.get_int('refresh-interval');
            if (Math.round(interval.get_value()) !== v)
                interval.set_value(v);
        });
        cleanups.push(() => {
            interval.disconnect(intervalNotifyId);
            settings.disconnect(intervalResyncId);
        });
        cadenceGroup.add(interval);
        page.add(cadenceGroup);

        // --- Bar format (string) ---
        const labelGroup = new Adw.PreferencesGroup({
            title: 'Panel label',
            description: BAR_PLACEHOLDERS,
        });
        const barFormat = new Adw.EntryRow({title: 'Bar format'});
        settings.bind('bar-format', barFormat, 'text', Gio.SettingsBindFlags.DEFAULT);
        labelGroup.add(barFormat);
        page.add(labelGroup);

        return page;
    }

    /**
     * Anthropic page: enable switch + credentials-path override.
     * @param {Gio.Settings} settings
     * @returns {Adw.PreferencesPage}
     */
    _buildAnthropicPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Anthropic'});
        const group = new Adw.PreferencesGroup({
            title: 'Anthropic',
            description: 'Credentials path — empty uses ~/.claude/.credentials.json.',
        });
        group.add(this._switchRow(settings, 'anthropic-enabled', 'Enabled'));
        group.add(this._entryRow(settings, 'anthropic-credentials-path', 'Credentials path'));
        page.add(group);
        return page;
    }

    /**
     * OpenAI page: enable switch + Codex auth-path override. The declared-but-
     * unused `openai-admin-key-env` is intentionally not surfaced.
     * @param {Gio.Settings} settings
     * @returns {Adw.PreferencesPage}
     */
    _buildOpenAiPage(settings) {
        const page = new Adw.PreferencesPage({title: 'OpenAI'});
        const group = new Adw.PreferencesGroup({
            title: 'OpenAI',
            description: 'Codex auth path — empty uses ~/.codex/auth.json.',
        });
        group.add(this._switchRow(settings, 'openai-enabled', 'Enabled'));
        group.add(this._entryRow(settings, 'openai-codex-auth-path', 'Codex auth path'));
        page.add(group);
        return page;
    }

    /**
     * Z.AI page: enable switch, env-var name, masked inline key, plan tier.
     * @param {Gio.Settings} settings
     * @returns {Adw.PreferencesPage}
     */
    _buildZaiPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Z.AI'});
        const group = new Adw.PreferencesGroup({
            title: 'Z.AI',
            description: 'Set the API key inline or via the environment variable (env wins).',
        });
        group.add(this._switchRow(settings, 'zai-enabled', 'Enabled'));
        group.add(this._entryRow(settings, 'zai-api-key-env', 'API key env var'));
        group.add(this._passwordRow(settings, 'zai-api-key', 'API key (inline)'));
        group.add(this._entryRow(settings, 'zai-plan-tier', 'Plan tier (lite/pro/max)'));
        page.add(group);
        return page;
    }

    /**
     * OpenRouter page: enable switch, env-var name, masked inline key.
     * @param {Gio.Settings} settings
     * @returns {Adw.PreferencesPage}
     */
    _buildOpenRouterPage(settings) {
        const page = new Adw.PreferencesPage({title: 'OpenRouter'});
        const group = new Adw.PreferencesGroup({
            title: 'OpenRouter',
            description: 'Set the API key inline or via the environment variable (env wins).',
        });
        group.add(this._switchRow(settings, 'openrouter-enabled', 'Enabled'));
        group.add(this._entryRow(settings, 'openrouter-api-key-env', 'API key env var'));
        group.add(this._passwordRow(settings, 'openrouter-api-key', 'API key (inline)'));
        page.add(group);
        return page;
    }

    /**
     * DeepSeek page: enable switch (off by default), env-var name, masked key.
     * @param {Gio.Settings} settings
     * @returns {Adw.PreferencesPage}
     */
    _buildDeepSeekPage(settings) {
        const page = new Adw.PreferencesPage({title: 'DeepSeek'});
        const group = new Adw.PreferencesGroup({
            title: 'DeepSeek',
            description: 'Disabled by default; requires an API key (env var or inline).',
        });
        group.add(this._switchRow(settings, 'deepseek-enabled', 'Enabled'));
        group.add(this._entryRow(settings, 'deepseek-api-key-env', 'API key env var'));
        group.add(this._passwordRow(settings, 'deepseek-api-key', 'API key (inline)'));
        page.add(group);
        return page;
    }

    /**
     * A boolean `Adw.SwitchRow` two-way bound to `key`.
     * @param {Gio.Settings} settings
     * @param {string} key - boolean schema key.
     * @param {string} title
     * @returns {Adw.SwitchRow}
     */
    _switchRow(settings, key, title) {
        const row = new Adw.SwitchRow({title});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    /**
     * A string `Adw.EntryRow` two-way bound to `key` (empty string = unset).
     * @param {Gio.Settings} settings
     * @param {string} key - string schema key.
     * @param {string} title
     * @returns {Adw.EntryRow}
     */
    _entryRow(settings, key, title) {
        const row = new Adw.EntryRow({title});
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    /**
     * A masked `Adw.PasswordEntryRow` (built-in reveal toggle) two-way bound to
     * `key`. The value lives only in dconf and is never logged.
     * @param {Gio.Settings} settings
     * @param {string} key - string schema key holding the secret.
     * @param {string} title
     * @returns {Adw.PasswordEntryRow}
     */
    _passwordRow(settings, key, title) {
        const row = new Adw.PasswordEntryRow({title});
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}

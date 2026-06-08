import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {rgbToHex} from './lib/color.js';
import {vformat} from './lib/format.js';
import {defaultTheme} from './lib/theme.js';
import {VENDOR_LABELS} from './lib/vendors.js';

const INTERVAL_MIN = 300;
const INTERVAL_MAX = 86400;

const COLOR_KEY_PALETTE = {
    'color-low': 'green',
    'color-mid': 'yellow',
    'color-high': 'orange',
    'color-critical': 'red',
};

// NOTE: user-facing strings are wrapped in `_()` at their use sites (inside
// `fillPreferencesWindow`/the page builders), never at module top level — the
// gettext domain is not yet bound when this module is first evaluated.

export default class AiUsagebarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cleanups = [];

        this._registerVendorIcons();
        this._loadStyles();

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

    _buildGeneralPage(settings, cleanups) {
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        const displayGroup = new Adw.PreferencesGroup({title: _('Display')});
        const model = new Gtk.StringList();
        // Vendor labels are brand names (Anthropic, OpenAI, …) — kept verbatim.
        for (const label of VENDOR_LABELS)
            model.append(label);
        const combo = new Adw.ComboRow({
            title: _('Primary vendor'),
            subtitle: _('Shown by default and used as the scroll-cycle reset target'),
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

        const cadenceGroup = new Adw.PreferencesGroup({
            title: _('Refresh'),
            // Translators: %d is the minimum refresh interval in seconds.
            description: vformat(_('Minimum %d s — the upstream endpoints rate-limit below that.'), INTERVAL_MIN),
        });
        const adjustment = new Gtk.Adjustment({
            lower: INTERVAL_MIN,
            upper: INTERVAL_MAX,
            step_increment: 60,
            page_increment: 300,
        });
        const interval = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
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

        const labelGroup = new Adw.PreferencesGroup({
            title: _('Panel label'),
            // Translators: the {token} names are literal placeholders the user
            // types — keep them verbatim, only translate the surrounding prose.
            description: _('Placeholders: {vendor_short} {session_pct}% {session_reset} {plan} {weekly_pct} {weekly_reset}'),
        });
        const barFormat = new Adw.EntryRow({title: _('Bar format')});
        settings.bind('bar-format', barFormat, 'text', Gio.SettingsBindFlags.DEFAULT);
        labelGroup.add(barFormat);
        page.add(labelGroup);

        const popupGroup = new Adw.PreferencesGroup({
            title: _('Popup'),
            // Translators: the {token} names are literal placeholders the user
            // types — keep them verbatim, only translate the surrounding prose.
            description: _('Optional extra lines shown above the popup. Empty uses the built-in layout. Placeholders: {plan} {session_pct} {session_reset} {weekly_pct} {weekly_reset}'),
        });
        popupGroup.add(this._entryRow(settings, 'tooltip-format', _('Popup format')));
        popupGroup.add(this._switchRow(settings, 'show-pace-marker', _('Show pace marker')));
        page.add(popupGroup);

        const colorGroup = new Adw.PreferencesGroup({
            title: _('Severity colors'),
            description: _('Pick a color per severity tier. Reset returns a tier to its built-in default.'),
        });
        const theme = defaultTheme();
        // Translators: Low/Mid/High/Critical are usage-severity tier names.
        colorGroup.add(this._colorRow(settings, 'color-low', _('Low'), theme[COLOR_KEY_PALETTE['color-low']], cleanups));
        colorGroup.add(this._colorRow(settings, 'color-mid', _('Mid'), theme[COLOR_KEY_PALETTE['color-mid']], cleanups));
        colorGroup.add(this._colorRow(settings, 'color-high', _('High'), theme[COLOR_KEY_PALETTE['color-high']], cleanups));
        colorGroup.add(this._colorRow(settings, 'color-critical', _('Critical'), theme[COLOR_KEY_PALETTE['color-critical']], cleanups));
        page.add(colorGroup);

        const notifyGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Show a desktop notification the first time a vendor reaches the threshold. It re-arms when usage drops back or the window resets.'),
        });
        notifyGroup.add(this._switchRow(settings, 'notify-enabled', _('Notify on high usage')));
        const notifyAdj = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 5,
            page_increment: 10,
        });
        const threshold = new Adw.SpinRow({
            title: _('Notification threshold (%)'),
            adjustment: notifyAdj,
            digits: 0,
        });
        threshold.set_value(settings.get_int('notify-threshold'));
        const thresholdNotifyId = threshold.connect('notify::value', () => {
            const v = Math.round(threshold.get_value());
            if (settings.get_int('notify-threshold') !== v)
                settings.set_int('notify-threshold', v);
        });
        const thresholdResyncId = settings.connect('changed::notify-threshold', () => {
            const v = settings.get_int('notify-threshold');
            if (Math.round(threshold.get_value()) !== v)
                threshold.set_value(v);
        });
        cleanups.push(() => {
            threshold.disconnect(thresholdNotifyId);
            settings.disconnect(thresholdResyncId);
        });
        notifyGroup.add(threshold);
        page.add(notifyGroup);

        const resetGroup = new Adw.PreferencesGroup({
            title: _('Reset'),
            description: _('Restore every setting — vendor toggles, paths, keys, formats, and colors — to its built-in default.'),
        });
        const resetRow = new Adw.ButtonRow({title: _('Reset all settings')});
        resetRow.add_css_class('destructive-action');
        const resetActivatedId = resetRow.connect('activated', () =>
            this._confirmResetAll(settings, resetRow.get_root()));
        cleanups.push(() => resetRow.disconnect(resetActivatedId));
        resetGroup.add(resetRow);
        page.add(resetGroup);

        return page;
    }

    _registerVendorIcons() {
        // The bundled vendor SVGs (icons/<id>.svg) live outside any icon theme,
        // so add the dir to the display's search path; pages then reference them
        // by bare basename via icon_name.
        const iconDir = `${this.path}/icons`;
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(iconDir))
            iconTheme.add_search_path(iconDir);
    }

    _loadStyles() {
        // Bottom tabs are AdwViewSwitcher buttons stacking icon over label with
        // no spacing; push the icon up so the label has a vertical gap.
        const provider = new Gtk.CssProvider();
        provider.load_from_string('viewswitcher button image { margin-bottom: 6px; }');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }

    _confirmResetAll(settings, parent) {
        const dialog = new Adw.AlertDialog({
            heading: _('Reset all settings?'),
            body: _('This restores every setting to its built-in default and cannot be undone.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_d, response) => {
            if (response === 'reset')
                this._resetAll(settings);
        });
        dialog.present(parent);
    }

    _resetAll(settings) {
        for (const key of settings.settings_schema.list_keys())
            settings.reset(key);
    }

    _buildAnthropicPage(settings) {
        // Translators: "Anthropic" is a brand name — usually keep untranslated.
        const page = new Adw.PreferencesPage({
            title: _('Anthropic'),
            icon_name: 'anthropic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Anthropic'),
            description: _('Credentials path — empty uses ~/.claude/.credentials.json.'),
        });
        group.add(this._switchRow(settings, 'anthropic-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'anthropic-credentials-path', _('Credentials path')));
        page.add(group);
        return page;
    }

    _buildOpenAiPage(settings) {
        // Translators: "OpenAI" is a brand name — usually keep untranslated.
        const page = new Adw.PreferencesPage({
            title: _('OpenAI'),
            icon_name: 'openai',
        });
        const group = new Adw.PreferencesGroup({
            title: _('OpenAI'),
            description: _('Codex auth path — empty uses ~/.codex/auth.json.'),
        });
        group.add(this._switchRow(settings, 'openai-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'openai-codex-auth-path', _('Codex auth path')));
        page.add(group);
        return page;
    }

    _buildZaiPage(settings) {
        // Translators: "Z.AI" is a brand name — usually keep untranslated.
        const page = new Adw.PreferencesPage({
            title: _('Z.AI'),
            icon_name: 'zai',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Z.AI'),
            description: _('Set the API key inline or via the environment variable (env wins).'),
        });
        group.add(this._switchRow(settings, 'zai-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'zai-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'zai-api-key', _('API key (inline)')));
        group.add(this._entryRow(settings, 'zai-plan-tier', _('Plan tier (lite/pro/max)')));
        page.add(group);
        return page;
    }

    _buildOpenRouterPage(settings) {
        // Translators: "OpenRouter" is a brand name — usually keep untranslated.
        const page = new Adw.PreferencesPage({
            title: _('OpenRouter'),
            icon_name: 'openrouter',
        });
        const group = new Adw.PreferencesGroup({
            title: _('OpenRouter'),
            description: _('Set the API key inline or via the environment variable (env wins).'),
        });
        group.add(this._switchRow(settings, 'openrouter-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'openrouter-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'openrouter-api-key', _('API key (inline)')));
        page.add(group);
        return page;
    }

    _buildDeepSeekPage(settings) {
        // Translators: "DeepSeek" is a brand name — usually keep untranslated.
        const page = new Adw.PreferencesPage({
            title: _('DeepSeek'),
            icon_name: 'deepseek',
        });
        const group = new Adw.PreferencesGroup({
            title: _('DeepSeek'),
            description: _('Disabled by default; requires an API key (env var or inline).'),
        });
        group.add(this._switchRow(settings, 'deepseek-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'deepseek-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'deepseek-api-key', _('API key (inline)')));
        page.add(group);
        return page;
    }

    _switchRow(settings, key, title) {
        const row = new Adw.SwitchRow({title});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _entryRow(settings, key, title) {
        const row = new Adw.EntryRow({title});
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _colorRow(settings, key, title, defaultHex, cleanups) {
        const row = new Adw.ActionRow({title});

        const dialog = new Gtk.ColorDialog({with_alpha: false});
        const button = new Gtk.ColorDialogButton({dialog, valign: Gtk.Align.CENTER});
        const reset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Reset to default'),
        });

        let syncing = false;

        const resync = () => {
            const value = settings.get_string(key);
            const rgba = new Gdk.RGBA();
            if (!value || !rgba.parse(value))
                rgba.parse(defaultHex);
            syncing = true;
            button.set_rgba(rgba);
            syncing = false;
            reset.sensitive = value !== '';
        };

        const pickId = button.connect('notify::rgba', () => {
            if (syncing)
                return;
            const {red, green, blue} = button.get_rgba();
            const hex = rgbToHex(red, green, blue);
            if (settings.get_string(key) !== hex)
                settings.set_string(key, hex);
        });
        const resetId = reset.connect('clicked', () => settings.set_string(key, ''));
        const changedId = settings.connect(`changed::${key}`, resync);
        cleanups.push(() => {
            button.disconnect(pickId);
            reset.disconnect(resetId);
            settings.disconnect(changedId);
        });

        resync();
        row.add_suffix(button);
        row.add_suffix(reset);
        return row;
    }

    _passwordRow(settings, key, title) {
        const row = new Adw.PasswordEntryRow({title});
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}

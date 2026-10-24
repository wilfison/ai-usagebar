import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {rgbToHex} from './lib/color.js';
import {initializePanelVendors} from './lib/config.js';
import {vformat} from './lib/format.js';
import {defaultTheme} from './lib/theme.js';
import {prefsNav, prefsNavItems} from './lib/prefs-nav.js';
import {bindPanelVendor, bindPanelLabelVisibility} from './lib/panel-prefs.js';
import {VENDOR_IDS, VENDOR_LABELS} from './lib/vendors.js';
import {parseExtraHeaders, validateMapping} from './lib/vendors/custom/parser.js';

const INTERVAL_MIN = 300;
const INTERVAL_MAX = 86400;

const COLOR_KEY_PALETTE = {
    'color-low': 'green',
    'color-mid': 'yellow',
    'color-high': 'orange',
    'color-critical': 'red',
};

// NOTE: user-facing strings are wrapped in `_()` at their use sites (inside
// `fillPreferencesWindow`/the page builders), never at module top level: the
// gettext domain is not yet bound when this module is first evaluated.

export default class AiUsagebarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        initializePanelVendors(settings);
        const cleanups = [];

        this._registerIconPath();

        const builders = {
            panel: () => this._buildPanelPage(settings, cleanups),
            popup: () => this._buildPopupPage(settings, cleanups),
            display: () => this._buildDisplayPage(settings, cleanups),
            behavior: () => this._buildBehaviorPage(settings, cleanups),
            anthropic: () => this._buildAnthropicPage(settings),
            openai: () => this._buildOpenAiPage(settings),
            zai: () => this._buildZaiPage(settings),
            openrouter: () => this._buildOpenRouterPage(settings),
            deepseek: () => this._buildDeepSeekPage(settings),
            kimi: () => this._buildKimiPage(settings),
            ollama: () => this._buildOllamaPage(settings),
            custom: () => this._buildCustomPage(settings, cleanups),
        };
        const nav = prefsNav(_);
        const pages = new Map();
        for (const {id} of prefsNavItems(nav)) {
            if (!builders[id])
                throw new Error(`No preferences page for "${id}"`);
            pages.set(id, builders[id]());
        }

        // The shell rejects a window with no visible_page, so one stays behind our content.
        window.add(new Adw.PreferencesPage());
        window.set_default_size(860, 640);
        // Last: past this point the shell's own error page is no longer on screen.
        window.set_content(this._buildSplitView(window, nav, pages, cleanups));

        window.connect('close-request', () => {
            for (const disconnect of cleanups)
                disconnect();
            return false;
        });
    }

    _buildSplitView(window, nav, pages, cleanups) {
        const stack = new Gtk.Stack();
        for (const [id, page] of pages)
            stack.add_named(page, id);
        const content = new Adw.NavigationPage({
            title: window.title,
            child: this._toolbarView(stack),
        });

        const items = prefsNavItems(nav);
        const sectionTitles = new Map();
        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            css_classes: ['navigation-sidebar'],
        });
        for (const section of nav)
            sectionTitles.set(items.indexOf(section.items[0]), section.title);
        for (const item of items)
            list.append(this._navRow(item));
        list.set_header_func(row => {
            const title = sectionTitles.get(row.get_index());
            row.set_header(title ? new Gtk.Label({
                label: title,
                xalign: 0,
                margin_start: 12,
                margin_top: 12,
                margin_bottom: 6,
                css_classes: ['caption-heading', 'dim-label'],
            }) : null);
        });
        const sidebar = new Adw.NavigationPage({
            title: window.title,
            child: this._toolbarView(new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                child: list,
            })),
        });

        const splitView = new Adw.NavigationSplitView({sidebar, content});
        const selectedId = list.connect('row-selected', (_list, row) => {
            if (!row)
                return;
            const item = items[row.get_index()];
            stack.set_visible_child_name(item.id);
            content.set_title(item.title);
        });
        const activatedId = list.connect('row-activated', () => splitView.set_show_content(true));
        cleanups.push(() => {
            list.disconnect(selectedId);
            list.disconnect(activatedId);
            list.set_header_func(null);
        });
        list.select_row(list.get_row_at_index(0));

        const narrow = new Adw.Breakpoint({
            condition: Adw.BreakpointCondition.parse('max-width: 560sp'),
        });
        narrow.add_setter(splitView, 'collapsed', true);
        window.add_breakpoint(narrow);

        return splitView;
    }

    _toolbarView(child) {
        const view = new Adw.ToolbarView({content: child});
        view.add_top_bar(new Adw.HeaderBar());
        return view;
    }

    _navRow(item) {
        const box = new Gtk.Box({spacing: 12});
        box.append(new Gtk.Image({icon_name: item.icon}));
        box.append(new Gtk.Label({label: item.title, xalign: 0}));
        return new Gtk.ListBoxRow({child: box});
    }

    _buildPanelPage(settings, cleanups) {
        const page = new Adw.PreferencesPage();

        const positionGroup = new Adw.PreferencesGroup({
            title: _('Panel position'),
            description: _('Changes apply immediately.'),
        });
        const boxes = ['left', 'center', 'right'];
        const boxModel = new Gtk.StringList();
        for (const label of [_('Left'), _('Center (beside the clock)'), _('Right (beside the system menu)')])
            boxModel.append(label);
        const boxRow = new Adw.ComboRow({title: _('Area'), model: boxModel});
        boxRow.selected = Math.max(0, boxes.indexOf(settings.get_string('panel-box')));
        const boxNotifyId = boxRow.connect('notify::selected', () => {
            const v = boxes[boxRow.selected];
            if (v && settings.get_string('panel-box') !== v)
                settings.set_string('panel-box', v);
        });
        const boxResyncId = settings.connect('changed::panel-box', () => {
            const i = boxes.indexOf(settings.get_string('panel-box'));
            if (i >= 0 && boxRow.selected !== i)
                boxRow.selected = i;
        });
        cleanups.push(() => {
            boxRow.disconnect(boxNotifyId);
            settings.disconnect(boxResyncId);
        });
        positionGroup.add(boxRow);
        const indexRow = new Adw.SpinRow({
            title: _('Position within the area'),
            subtitle: _('0 is leftmost; in the center, 0 is left of the clock and 1 right of it'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 20, step_increment: 1, page_increment: 1}),
            digits: 0,
        });
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        positionGroup.add(indexRow);
        page.add(positionGroup);

        const vendorsGroup = new Adw.PreferencesGroup({
            title: _('Panel vendors'),
            description: _('Select the vendors to show and refresh on the panel.'),
        });
        VENDOR_IDS.forEach((id, index) => {
            const row = new Adw.SwitchRow({title: VENDOR_LABELS[index]});
            bindPanelVendor(settings, id, row, cleanups);
            vendorsGroup.add(row);
        });
        page.add(vendorsGroup);

        const labelGroup = new Adw.PreferencesGroup({
            title: _('Panel label'),
            // Translators: the {token} names are literal placeholders the user
            // types: keep them verbatim, only translate the surrounding prose.
            description: _('Leave a vendor label empty to use the default label. Placeholders: {vendor_short} {session_pct}% {session_reset} {plan} {weekly_pct} {weekly_reset}'),
        });
        labelGroup.add(this._entryRow(settings, 'bar-format', _('Default label')));
        for (const [index, id] of VENDOR_IDS.entries()) {
            const row = this._entryRow(settings, `bar-format-${id}`, VENDOR_LABELS[index]);
            bindPanelLabelVisibility(settings, id, row, cleanups);
            labelGroup.add(row);
        }
        page.add(labelGroup);

        return page;
    }

    _buildPopupPage(settings, cleanups) {
        const page = new Adw.PreferencesPage();

        const popupGroup = new Adw.PreferencesGroup({
            title: _('Popup'),
            // Translators: the {token} names are literal placeholders the user
            // types: keep them verbatim, only translate the surrounding prose.
            description: _('Optional extra lines shown above the popup. Empty uses the built-in layout. Placeholders: {plan} {session_pct} {session_reset} {weekly_pct} {weekly_reset}'),
        });
        popupGroup.add(this._entryRow(settings, 'tooltip-format', _('Popup format')));
        popupGroup.add(this._switchRow(settings, 'show-pace-marker', _('Show pace marker'),
            _('A tick at how much of the window has passed. Usage past it turns orange or red when it would run out before the reset.')));
        popupGroup.add(this._shortcutRow(settings, 'toggle-menu', _('Shortcut to open'), cleanups));
        page.add(popupGroup);

        return page;
    }

    _buildDisplayPage(settings, cleanups) {
        const page = new Adw.PreferencesPage();

        const displayGroup = new Adw.PreferencesGroup({title: _('Display')});
        const model = new Gtk.StringList();
        // Vendor labels are brand names (Anthropic, OpenAI, …), kept verbatim.
        for (const label of VENDOR_LABELS)
            model.append(label);
        const combo = new Adw.ComboRow({
            title: _('Primary vendor'),
            subtitle: _('Selected by default in the popup'),
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
        displayGroup.add(this._switchRow(settings, 'show-vendor-icons', _('Show vendor logos')));
        page.add(displayGroup);

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

        return page;
    }

    _buildBehaviorPage(settings, cleanups) {
        const page = new Adw.PreferencesPage();

        const cadenceGroup = new Adw.PreferencesGroup({
            title: _('Refresh'),
            // Translators: %d is the minimum refresh interval in seconds.
            description: vformat(_('Minimum %d s: the upstream endpoints rate-limit below that.'), INTERVAL_MIN),
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

        const notifyGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Show a desktop notification the first time a usage window reaches the threshold. It re-arms when usage drops 7 points below it or the window resets, and warns 48 hours before a reset credit expires.'),
        });
        notifyGroup.add(this._switchRow(settings, 'notify-enabled', _('Notify on high usage')));
        const notifyAdj = new Gtk.Adjustment({
            lower: 1,
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

        const updateGroup = new Adw.PreferencesGroup({title: _('Updates')});
        updateGroup.add(this._switchRow(settings, 'update-check-enabled', _('Check for updates'),
            _('Once a day, ask GitHub whether a newer release exists')));
        page.add(updateGroup);

        const resetGroup = new Adw.PreferencesGroup({
            title: _('Reset'),
            description: _('Restore every setting (vendor toggles, paths, keys, formats, and colors) to its built-in default.'),
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

    _registerIconPath() {
        // The bundled symbolic icons (icons/*.svg) live outside any icon theme, so
        // add the dir to the search path; the sidebar references them by basename.
        const iconDir = `${this.path}/icons`;
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(iconDir))
            iconTheme.add_search_path(iconDir);
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
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "Anthropic" is a brand name, usually keep untranslated.
            title: _('Anthropic'),
            description: _('Credentials path: empty uses ~/.claude/.credentials.json.'),
        });
        group.add(this._switchRow(settings, 'anthropic-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'anthropic-credentials-path', _('Credentials path')));
        page.add(group);

        const context = new Adw.PreferencesGroup({
            title: _('Context monitor'),
            description: _('Lists recent Claude Code sessions in the Claude section, with how much of the context window each one used. Transcripts are read only while this is on.'),
        });
        context.add(this._switchRow(settings, 'context-enabled', _('Show session context')));
        context.add(this._entryRow(settings, 'context-projects-path', _('Projects directory (empty: ~/.claude/projects)')));
        const windowAdj = new Gtk.Adjustment({lower: 0, upper: 100000000, step_increment: 1000, page_increment: 100000});
        const windowRow = new Adw.SpinRow({
            title: _('Default context window (tokens)'),
            subtitle: _('0 shows raw token counts instead of a percentage'),
            adjustment: windowAdj,
            digits: 0,
        });
        settings.bind('context-window-tokens', windowRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        context.add(windowRow);
        context.add(this._entryRow(settings, 'context-model-windows', _('Window per model (JSON, e.g. {"claude-opus-5": 1000000})')));
        page.add(context);
        return page;
    }

    _buildOpenAiPage(settings) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "OpenAI" is a brand name, usually keep untranslated.
            title: _('OpenAI'),
            description: _('Codex auth path: empty uses ~/.codex/auth.json.'),
        });
        group.add(this._switchRow(settings, 'openai-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'openai-codex-auth-path', _('Codex auth path')));
        page.add(group);
        return page;
    }

    _buildZaiPage(settings) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "Z.AI" is a brand name, usually keep untranslated.
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
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "OpenRouter" is a brand name, usually keep untranslated.
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
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "DeepSeek" is a brand name, usually keep untranslated.
            title: _('DeepSeek'),
            description: _('Disabled by default; requires an API key (env var or inline).'),
        });
        group.add(this._switchRow(settings, 'deepseek-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'deepseek-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'deepseek-api-key', _('API key (inline)')));
        page.add(group);
        return page;
    }

    _buildKimiPage(settings) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "Kimi" is a brand name, usually keep untranslated.
            title: _('Kimi'),
            description: _('Disabled by default; requires an API key (env var or inline).'),
        });
        group.add(this._switchRow(settings, 'kimi-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'kimi-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'kimi-api-key', _('API key (inline)')));
        page.add(group);
        return page;
    }

    _buildOllamaPage(settings) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            // Translators: "Ollama" is a brand name, usually keep untranslated.
            title: _('Ollama Cloud'),
            description: _('Disabled by default; requires an API key (env var or inline).'),
        });
        group.add(this._switchRow(settings, 'ollama-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'ollama-api-key-env', _('API key env var')));
        group.add(this._passwordRow(settings, 'ollama-api-key', _('API key (inline)')));
        group.add(this._entryRow(settings, 'ollama-plan', _('Plan name (optional)')));
        page.add(group);
        return page;
    }

    _buildCustomPage(settings, cleanups) {
        const page = new Adw.PreferencesPage();

        const group = new Adw.PreferencesGroup({
            title: _('Custom provider'),
            description: _('Any HTTPS endpoint that answers a GET with JSON, mapped to usage rows by JSON Pointer. See the README for an example.'),
        });
        group.add(this._switchRow(settings, 'custom-enabled', _('Enabled')));
        group.add(this._entryRow(settings, 'custom-name', _('Name')));
        group.add(this._entryRow(settings, 'custom-url', _('URL')));
        group.add(this._switchRow(settings, 'custom-allow-http', _('Allow plain HTTP')));
        page.add(group);

        const auth = new Adw.PreferencesGroup({
            title: _('Authentication'),
            description: _('Without a key no auth header is sent. An empty scheme sends the key bare.'),
        });
        auth.add(this._entryRow(settings, 'custom-api-key-env', _('API key env var (optional)')));
        auth.add(this._passwordRow(settings, 'custom-api-key', _('API key (inline)')));
        auth.add(this._entryRow(settings, 'custom-auth-header', _('Auth header')));
        auth.add(this._entryRow(settings, 'custom-auth-scheme', _('Auth scheme')));
        page.add(auth);

        const headers = new Adw.PreferencesGroup({
            title: _('Extra headers'),
            description: _('A JSON object of header names to string values; it must not repeat the auth header.'),
        });
        headers.add(this._jsonEditor(settings, 'custom-extra-headers', text => {
            const authHeader = settings.get_string('custom-auth-header').trim() || 'Authorization';
            return parseExtraHeaders(text, authHeader) === null
                ? [_('Not a JSON object of string header values, or it repeats the auth header.')]
                : [];
        }, cleanups));
        page.add(headers);

        const mapping = new Adw.PreferencesGroup({
            title: _('Mapping'),
            description: _('Metrics (used + limit, or percent) and texts, each read from the response by JSON Pointer. Saved when the editor loses focus and the mapping is valid.'),
        });
        mapping.add(this._jsonEditor(settings, 'custom-mapping', text => {
            let obj;
            try {
                obj = JSON.parse(text);
            } catch (e) {
                return [vformat(_('Not valid JSON: %s'), e.message)];
            }
            return validateMapping(obj);
        }, cleanups));
        page.add(mapping);
        return page;
    }

    // A monospace JSON editor bound to a string key: its text is saved when
    // focus leaves and `validate` finds no problem; otherwise the problems
    // show below it and the saved value stays. Empty is always valid.
    _jsonEditor(settings, key, validate, cleanups) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        const view = new Gtk.TextView({
            monospace: true,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
        });
        view.buffer.text = settings.get_string(key);
        const scroller = new Gtk.ScrolledWindow({
            child: view,
            min_content_height: 140,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            css_classes: ['card'],
        });
        // Problems may quote user text, so they are never parsed as markup.
        const problems = new Gtk.Label({
            use_markup: false,
            wrap: true,
            xalign: 0,
            visible: false,
            css_classes: ['error', 'caption'],
        });
        box.append(scroller);
        box.append(problems);

        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', () => {
            const text = view.buffer.text.trim();
            const found = text === '' ? [] : validate(text);
            problems.label = found.join('\n');
            problems.visible = found.length > 0;
            if (found.length === 0 && settings.get_string(key) !== text)
                settings.set_string(key, text);
        });
        view.add_controller(focus);

        const syncId = settings.connect(`changed::${key}`, () => {
            if (!view.has_focus && view.buffer.text.trim() !== settings.get_string(key))
                view.buffer.text = settings.get_string(key);
        });
        cleanups.push(() => settings.disconnect(syncId));
        return box;
    }

    _switchRow(settings, key, title, subtitle = null) {
        const row = new Adw.SwitchRow(subtitle ? {title, subtitle} : {title});
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

    _shortcutRow(settings, key, title, cleanups) {
        const row = new Adw.ActionRow({title, activatable: true});
        const label = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Reset to default'),
        });

        const resync = () => {
            label.accelerator = settings.get_strv(key)[0] ?? '';
            reset.sensitive = settings.get_user_value(key) !== null;
        };

        const activatedId = row.connect('activated', () =>
            this._captureShortcut(settings, key, row.get_root()));
        const resetId = reset.connect('clicked', () => settings.reset(key));
        const changedId = settings.connect(`changed::${key}`, resync);
        cleanups.push(() => {
            row.disconnect(activatedId);
            reset.disconnect(resetId);
            settings.disconnect(changedId);
        });

        resync();
        row.add_suffix(label);
        row.add_suffix(reset);
        return row;
    }

    // Shortcuts the shell already grabs never reach this window, so a
    // combination taken by GNOME cannot be recorded here.
    _captureShortcut(settings, key, parent) {
        const dialog = new Adw.AlertDialog({
            heading: _('Set shortcut'),
            body: _('Press the new shortcut for opening the popup, or Esc to cancel.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('disable', _('Disable'));
        dialog.set_close_response('cancel');
        dialog.connect('response', (_d, response) => {
            if (response === 'disable')
                settings.set_strv(key, []);
        });

        const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            // A bare or Shift-only key would swallow ordinary typing system-wide;
            // let it through so Esc, Tab and Enter still drive the dialog.
            if ((mask & ~Gdk.ModifierType.SHIFT_MASK) === 0)
                return Gdk.EVENT_PROPAGATE;
            const lower = Gdk.keyval_to_lower(keyval);
            if (!Gtk.accelerator_valid(lower, mask))
                return Gdk.EVENT_STOP;
            settings.set_strv(key, [Gtk.accelerator_name(lower, mask)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(parent);
    }

    _passwordRow(settings, key, title) {
        const row = new Adw.PasswordEntryRow({title});
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}

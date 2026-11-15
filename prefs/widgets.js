import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {rgbToHex} from '../lib/color.js';
import {RowType, schemaRange} from '../lib/prefs-pages.js';

// Only a GSettings handler outlives the window (the settings object is the
// extension's), so each one goes through onSetting, whose disconnect the
// window runs on close-request. Signals on widgets die with them.
export function onSetting(settings, key, fn, cleanups) {
    const id = settings.connect(`changed::${key}`, fn);
    cleanups.push(() => settings.disconnect(id));
}

export function switchRow(settings, key, title, subtitle = null) {
    const row = new Adw.SwitchRow(subtitle ? {title, subtitle} : {title});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function entryRow(settings, key, title) {
    const row = new Adw.EntryRow({title});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function passwordRow(settings, key, title) {
    const row = new Adw.PasswordEntryRow({title});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinWidget({title, subtitle, lower, upper, step, page}) {
    return new Adw.SpinRow({
        title,
        ...subtitle ? {subtitle} : {},
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: page}),
        digits: 0,
    });
}

// An integer key bound straight to a spin row.
// The bounds come from the key's schema range.
export function boundSpinRow(settings, key, opts) {
    const row = spinWidget({...schemaRange(settings.settings_schema, key), ...opts});
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// A combo over `labels`, kept in step with a key through `read()` (the
// stored index, -1 when unknown) and `write(index)`.
export function comboRow(settings, key, {title, subtitle, labels, read, write}, cleanups) {
    const model = new Gtk.StringList();
    for (const label of labels)
        model.append(label);
    const row = new Adw.ComboRow({title, ...subtitle ? {subtitle} : {}, model});
    row.selected = Math.max(0, read());
    row.connect('notify::selected', () => {
        // No selection (Gtk.INVALID_LIST_POSITION) writes nothing.
        if (row.selected < labels.length && read() !== row.selected)
            write(row.selected);
    });
    onSetting(settings, key, () => {
        const i = read();
        if (i >= 0 && row.selected !== i)
            row.selected = i;
    }, cleanups);
    return row;
}

// The rows of a lib/prefs-pages.js spec, built into Adw.PreferencesGroups.
export function specPage(settings, spec) {
    const page = new Adw.PreferencesPage();
    for (const g of spec.groups) {
        const group = new Adw.PreferencesGroup(g.description ? {title: g.title, description: g.description} : {title: g.title});
        for (const r of g.rows)
            group.add(specRow(settings, r));
        page.add(group);
    }
    return page;
}

function specRow(settings, row) {
    switch (row.type) {
    case RowType.SWITCH:
        return switchRow(settings, row.key, row.title);
    case RowType.ENTRY:
        return entryRow(settings, row.key, row.title);
    case RowType.PASSWORD:
        return passwordRow(settings, row.key, row.title);
    case RowType.SPIN:
        return boundSpinRow(settings, row.key, row);
    }
    throw new Error(`Unknown preferences row type "${row.type}"`);
}

function resetButton() {
    return new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: _('Reset to default'),
    });
}

export function colorRow(settings, key, title, defaultHex, cleanups) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false}), valign: Gtk.Align.CENTER});
    const reset = resetButton();

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

    button.connect('notify::rgba', () => {
        if (syncing)
            return;
        const {red, green, blue} = button.get_rgba();
        const hex = rgbToHex(red, green, blue);
        if (settings.get_string(key) !== hex)
            settings.set_string(key, hex);
    });
    reset.connect('clicked', () => settings.set_string(key, ''));
    onSetting(settings, key, resync, cleanups);

    resync();
    row.add_suffix(button);
    row.add_suffix(reset);
    return row;
}

export function shortcutRow(settings, key, title, cleanups) {
    const row = new Adw.ActionRow({title, activatable: true});
    const label = new Gtk.ShortcutLabel({disabled_text: _('Disabled'), valign: Gtk.Align.CENTER});
    const reset = resetButton();

    const resync = () => {
        label.accelerator = settings.get_strv(key)[0] ?? '';
        reset.sensitive = settings.get_user_value(key) !== null;
    };

    row.connect('activated', () => captureShortcut(settings, key, row.get_root()));
    reset.connect('clicked', () => settings.reset(key));
    onSetting(settings, key, resync, cleanups);

    resync();
    row.add_suffix(label);
    row.add_suffix(reset);
    return row;
}

// Shortcuts the shell already grabs never reach this window, so a
// combination taken by GNOME cannot be recorded here.
function captureShortcut(settings, key, parent) {
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

// A monospace JSON editor bound to a string key: its text is saved when
// focus leaves and `validate` finds no problem; otherwise the problems
// show below it and the saved value stays. Empty is always valid.
export function jsonEditor(settings, key, validate, cleanups) {
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

    onSetting(settings, key, () => {
        if (!view.has_focus && view.buffer.text.trim() !== settings.get_string(key))
            view.buffer.text = settings.get_string(key);
    }, cleanups);
    return box;
}

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import {bindPanelVendor, bindPanelLabelVisibility} from '../lib/panel-prefs.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

function makeSettings() {
    const path = import.meta.url.replace(/^file:\/\//, '');
    const root = GLib.path_get_dirname(GLib.path_get_dirname(path));
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([root, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
    return Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.ai-usagebar', false), null, null);
}

class FakeToggle {
    constructor() {
        this._active = false;
        this._callbacks = new Map();
        this._nextId = 1;
    }

    get active() {
        return this._active;
    }

    set active(value) {
        if (this._active === value)
            return;
        this._active = value;
        for (const callback of this._callbacks.values())
            callback();
    }

    connect(_signal, callback) {
        const id = this._nextId++;
        this._callbacks.set(id, callback);
        return id;
    }

    disconnect(id) {
        this._callbacks.delete(id);
    }
}

describe('panel vendor preference binding', () => {
    const settings = makeSettings();
    settings.set_strv('panel-vendors', ['anthropic', 'openai', 'zai', 'openrouter']);
    const cleanups = [];
    const openai = new FakeToggle();
    const deepseek = new FakeToggle();
    bindPanelVendor(settings, 'openai', openai, cleanups);
    bindPanelVendor(settings, 'deepseek', deepseek, cleanups);

    it('reflects the saved selection', () => {
        assertEqual(openai.active, true);
        assertEqual(deepseek.active, false);
    });
    it('deselecting removes only that panel vendor', () => {
        openai.active = false;
        assertDeepEqual(settings.get_strv('panel-vendors'), ['anthropic', 'zai', 'openrouter']);
        assertEqual(settings.get_boolean('openai-enabled'), true);
    });
    it('selecting a disabled vendor enables and displays it', () => {
        deepseek.active = true;
        assertEqual(settings.get_boolean('deepseek-enabled'), true);
        assertDeepEqual(settings.get_strv('panel-vendors'), ['anthropic', 'zai', 'openrouter', 'deepseek']);
    });
    it('external selection changes update the switches', () => {
        settings.set_strv('panel-vendors', ['openai']);
        assertEqual(openai.active, true);
        assertEqual(deepseek.active, false);
    });
    for (const cleanup of cleanups)
        cleanup();
});

describe('vendor label preference visibility', () => {
    const settings = makeSettings();
    settings.set_strv('panel-vendors', ['openai']);
    const cleanups = [];
    const row = {visible: false};
    bindPanelLabelVisibility(settings, 'openai', row, cleanups);
    it('selected vendor label is visible', () => assertEqual(row.visible, true));
    settings.set_strv('panel-vendors', ['anthropic']);
    it('deselected vendor label is hidden', () => assertEqual(row.visible, false));
    for (const cleanup of cleanups)
        cleanup();
});

system.exit(summary());

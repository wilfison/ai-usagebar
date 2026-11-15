import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {readConfig} from './lib/config.js';
import {disposeSession, setUserAgent} from './lib/http.js';
import {Indicator} from './ui/indicator.js';
import {Notifier} from './ui/notifier.js';

const TOGGLE_MENU_KEY = 'toggle-menu';

export default class AiUsagebarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        setUserAgent(`ai-usagebar/${this.metadata['version-name']}`);
        this._notifier = new Notifier(this.path);
        this._placeId = null;
        this._settings.connectObject(
            'changed::panel-box', () => this._queuePlace(),
            'changed::panel-index', () => this._queuePlace(),
            this);
        this._place();

        // Bound here, not on the indicator, so it survives _place() rebuilds.
        Main.wm.addKeybinding(TOGGLE_MENU_KEY, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._indicator?.menu.toggle());
    }

    // Both keys can change in one turn (a reset): one rebuild for the pair.
    _queuePlace() {
        this._placeId ??= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._placeId = null;
            this._place();
            return GLib.SOURCE_REMOVE;
        });
    }

    // A panel item cannot change area in place, so a new position rebuilds it;
    // the cache's fresh TTL keeps that from refetching.
    _place() {
        this._indicator?.destroy();
        this._indicator = new Indicator(this._settings, () => this.openPreferences(), this.path,
            this.metadata['version-name'], this._notifier);
        const {box, index} = readConfig(this._settings).panel;
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    disable() {
        Main.wm.removeKeybinding(TOGGLE_MENU_KEY);
        this._settings.disconnectObject(this);
        if (this._placeId) {
            GLib.Source.remove(this._placeId);
            this._placeId = null;
        }
        this._indicator.destroy();
        this._indicator = null;
        this._notifier.destroy();
        this._notifier = null;
        disposeSession();
        this._settings = null;
    }
}

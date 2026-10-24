import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {readConfig, initializePanelVendors} from './lib/config.js';
import {Indicator} from './ui/indicator.js';

const TOGGLE_MENU_KEY = 'toggle-menu';

export default class AiUsagebarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        initializePanelVendors(this._settings);
        this._placeIds = ['changed::panel-box', 'changed::panel-index']
            .map(signal => this._settings.connect(signal, () => this._place()));
        this._place();

        // Bound here, not on the indicator, so it survives _place() rebuilds.
        Main.wm.addKeybinding(TOGGLE_MENU_KEY, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._indicator?.menu.toggle());
    }

    // A panel item cannot change area in place, so a new position rebuilds it;
    // the cache's fresh TTL keeps that from refetching.
    _place() {
        this._indicator?.destroy();
        this._indicator = new Indicator(this._settings, () => this.openPreferences(), this.path,
            this.metadata['version-name']);
        const {box, index} = readConfig(this._settings).panel;
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    disable() {
        Main.wm.removeKeybinding(TOGGLE_MENU_KEY);
        for (const id of this._placeIds)
            this._settings.disconnect(id);
        this._placeIds = null;
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}

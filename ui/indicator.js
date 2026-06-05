/**
 * @file Top-panel indicator widget. Holds the shared cancellable used to
 * abort in-flight vendor fetches when the extension is disabled.
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

/**
 * `PanelMenu.Button` subclass that shows AI plan usage in the top panel.
 *
 * Construct via `new Indicator()`; `GObject.registerClass` rewires the
 * constructor to call `_init` for you.
 * @class Indicator
 * @extends PanelMenu.Button
 */
export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    /**
     * Build the panel widget and its shared cancellable.
     * @returns {void}
     */
    _init() {
        super._init(0.0, 'ai-usagebar');

        this._cancellable = new Gio.Cancellable();

        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._label = new St.Label({text: 'cld —'});
        this._box.add_child(this._label);
        this.add_child(this._box);
    }

    /**
     * Cancel pending I/O, clear the popup menu, and chain to the GObject
     * destructor. Must remain idempotent.
     * @returns {void}
     */
    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        this.menu?.removeAll();

        super.destroy();
    }
});

/**
 * @file Extension entry point. Mounts {@link Indicator} into the top panel on
 * `enable()` and tears everything down on `disable()` so GNOME's reviewers
 * don't reject for leaks.
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Indicator} from './ui/indicator.js';

/**
 * GNOME Shell extension that surfaces AI plan usage in the top panel.
 * @extends Extension
 */
export default class AiUsagebarExtension extends Extension {
    /**
     * Construct and mount the panel indicator, handing it the GSettings store.
     * @returns {void}
     */
    enable() {
        this._indicator = new Indicator(this.getSettings());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    /**
     * Tear down the panel indicator. Must release every resource created in
     * {@link enable} — widgets, cancellables, timeout sources.
     * @returns {void}
     */
    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

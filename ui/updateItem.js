import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {request} from '../lib/http.js';
import {vformat} from '../lib/format.js';
import {
    RELEASES_API_URL, RELEASES_PAGE_URL, afterCheck, availableUpdate, isDue, parseLatestTag,
} from '../lib/update-check.js';
import {readUpdateState, writeUpdateState} from '../lib/update-store.js';

// The "Update available" menu item, hidden until GitHub names a newer release.
export class UpdateItem {
    constructor(version, cancellable) {
        this._version = version;
        this._cancellable = cancellable;
        this._busy = false;
        this._destroyed = false;
        this._enabled = false;
        this.item = new PopupMenu.PopupImageMenuItem('', 'software-update-available-symbolic');
        this.item.visible = false;
        this.item.connect('activate', () => this._openReleasesPage());
    }

    // Rides the poll tick: the on-disk deadline, not a timer, keeps it to one
    // request a day across indicator rebuilds and logins.
    async check(enabled) {
        this._enabled = enabled;
        if (!enabled) {
            this.item.visible = false;
            return;
        }
        if (this._busy)
            return;
        this._busy = true;
        try {
            let state = await readUpdateState();
            if (this._destroyed)
                return;
            this._paint(state);
            if (!isDue(state, Date.now()))
                return;

            const res = await request({
                url: RELEASES_API_URL,
                headers: {Accept: 'application/vnd.github+json'},
                cancellable: this._cancellable,
            });
            if (this._destroyed)
                return;
            const latest = res.status === 200 ? parseLatestTag(new TextDecoder().decode(res.bodyBytes)) : null;
            state = afterCheck(state, latest, Date.now());
            writeUpdateState(state);
            this._paint(state);
        } catch (e) {
            console.warn(`ai-usagebar: update check failed: ${e}`);
        } finally {
            this._busy = false;
        }
    }

    _paint(state) {
        const latest = this._enabled ? availableUpdate(state, this._version) : null;
        if (latest) {
            // Translators: %s is the version number of the newer release (e.g. "1.6.0").
            this.item.label.text = vformat(_('Update available: %s'), latest);
        }
        this.item.visible = latest !== null;
    }

    _openReleasesPage() {
        try {
            Gio.AppInfo.launch_default_for_uri(RELEASES_PAGE_URL, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`ai-usagebar: could not open the releases page: ${e}`);
        }
    }

    destroy() {
        this._destroyed = true;
    }
}

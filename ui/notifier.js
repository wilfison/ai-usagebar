import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {decide, Urgency} from '../lib/notify.js';
import {vendorLabel, GENERIC_ICON} from '../lib/vendors.js';

// Desktop notifications for usage thresholds and expiring reset credits. Owned
// by the extension, not the indicator, so a panel move keeps the delivered ones.
export class Notifier {
    constructor(extensionPath) {
        this._path = extensionPath;
        this._source = null;
        this._destroyed = false;
    }

    // Only a fresh fetch notifies: a stale fallback or the TTL fast path
    // re-reports numbers that were already judged. The dedupe state is saved
    // before delivery, so a failed save skips the notification instead of
    // repeating it on every poll.
    async maybeNotify(adapter, cache, res, config) {
        if (!res.ok || res.stale || res.cacheAgeMs !== 0 || !config.notifications.enabled)
            return;
        try {
            const vendor = vendorLabel(adapter.id, config);
            const {fired, state} = decide({
                vendor,
                rows: adapter.notifyRows(res.snapshot, _),
                credits: adapter.resetCredits(res.snapshot),
                threshold: config.notifications.threshold,
                previous: await cache.readNotified(),
                now: new Date(),
                _,
            });
            if (this._destroyed)
                return;
            await cache.writeNotified(state);
            for (const n of fired) {
                const source = this._notificationSource();
                source.addNotification(new MessageTray.Notification({
                    source,
                    title: n.title,
                    body: n.body,
                    urgency: n.urgency === Urgency.CRITICAL ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
                }));
            }
            if (fired.length > 0)
                global.display.get_sound_player().play_from_theme('message-new-instant', vendor, null);
        } catch (e) {
            console.warn(`ai-usagebar: notification check failed: ${e}`);
        }
    }

    // One tray source for the extension; the shell destroys it once its last
    // notification is gone, so it is rebuilt on demand.
    _notificationSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'AI Usage Bar', icon: this._icon()});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    _icon() {
        return new Gio.FileIcon({file: Gio.File.new_for_path(GLib.build_filenamev([this._path, 'icons', `${GENERIC_ICON}.svg`]))});
    }

    destroy() {
        this._destroyed = true;
        this._source?.destroy();
        this._source = null;
    }
}

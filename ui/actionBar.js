import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {iconButton} from './tooltip.js';

// The popup footer: a status line on the left and icon-only buttons on the
// right, in one non-reactive row.
export class ActionBar {
    // `actions` is a list of {iconName, label, onClick}.
    constructor(tooltip, actions) {
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'aiusagebar-footer', x_expand: true});
        this._status = new St.Label({
            style_class: 'aiusagebar-dim aiusagebar-footer-status',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._status);
        for (const action of actions)
            box.add_child(iconButton(tooltip, action));
        this.item.add_child(box);
    }

    setStatus(text) {
        this._status.text = text ?? '';
    }
}

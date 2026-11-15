import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const TOOLTIP_DELAY_MS = 400;

// The popup footer: one non-reactive row of icon-only buttons, each with a
// hover tooltip. The tooltip label is shared, created on first hover in the
// uiGroup, and released in destroy() with its timer.
export class ActionBar {
    // `actions` is a list of {iconName, label, onClick}.
    constructor(actions) {
        this._tooltip = null;
        this._tooltipTimeoutId = null;
        this._destroyed = false;

        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({
            style_class: 'aiusagebar-actions',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        for (const {iconName, label, onClick} of actions)
            box.add_child(this._button(iconName, label, onClick));
        this.item.add_child(box);
    }

    _button(iconName, label, onClick) {
        const button = new St.Button({
            style_class: 'aiusagebar-action-button',
            child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
            can_focus: true,
            track_hover: true,
        });
        button.accessible_name = label;
        button.connect('clicked', () => {
            if (this._destroyed)
                return;
            this._hideTooltip();
            onClick();
        });
        button.connect('notify::hover', () => this._onHover(button, label));
        return button;
    }

    _onHover(button, label) {
        if (this._destroyed)
            return;
        this._cancelTimer();
        if (!button.hover) {
            this._hideTooltip();
            return;
        }
        this._tooltipTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._tooltipTimeoutId = null;
            this._showTooltip(button, label);
            return GLib.SOURCE_REMOVE;
        });
    }

    _showTooltip(button, label) {
        if (this._destroyed || !button.hover)
            return;
        if (!this._tooltip) {
            this._tooltip = new St.Label({style_class: 'aiusagebar-tooltip'});
            this._tooltip.hide();
            Main.layoutManager.uiGroup.add_child(this._tooltip);
        }
        this._tooltip.text = label;
        this._tooltip.show();
        const [bx, by] = button.get_transformed_position();
        const x = Math.round(bx + button.width / 2 - this._tooltip.width / 2);
        const y = Math.round(by + button.height + 4);
        this._tooltip.set_position(Math.max(0, x), y);
    }

    _hideTooltip() {
        this._tooltip?.hide();
    }

    _cancelTimer() {
        if (this._tooltipTimeoutId) {
            GLib.Source.remove(this._tooltipTimeoutId);
            this._tooltipTimeoutId = null;
        }
    }

    // The menu item itself goes with the menu.
    destroy() {
        this._destroyed = true;
        this._cancelTimer();
        this._tooltip?.destroy();
        this._tooltip = null;
    }
}

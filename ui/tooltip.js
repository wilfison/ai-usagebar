import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOOLTIP_DELAY_MS = 400;

// One hover tooltip shared by every icon button of the popup. The label is
// created on first hover in the uiGroup and released in destroy() with its timer.
export class Tooltip {
    constructor() {
        this._label = null;
        this._timeoutId = null;
        this._destroyed = false;
    }

    // `text` is a string, or a function read at show time.
    attach(button, text) {
        button.connect('notify::hover', () => this._onHover(button, text));
        // A button rebuilt mid-hover must not leave its tooltip behind.
        button.connect('destroy', () => this.hide());
    }

    hide() {
        this._cancelTimer();
        this._label?.hide();
    }

    _onHover(button, text) {
        if (this._destroyed)
            return;
        this.hide();
        if (!button.hover)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._timeoutId = null;
            this._show(button, typeof text === 'function' ? text() : text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(button, text) {
        if (this._destroyed || !button.hover || !text)
            return;
        if (!this._label) {
            this._label = new St.Label({style_class: 'aiusagebar-tooltip'});
            this._label.hide();
            Main.layoutManager.uiGroup.add_child(this._label);
        }
        this._label.text = text;
        this._label.show();
        const [bx, by] = button.get_transformed_position();
        const x = Math.round(bx + button.width / 2 - this._label.width / 2);
        const y = Math.round(by + button.height + 4);
        this._label.set_position(Math.max(0, x), y);
    }

    _cancelTimer() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    destroy() {
        this._destroyed = true;
        this._cancelTimer();
        this._label?.destroy();
        this._label = null;
    }
}

// An icon-only button: `label` is its accessible name and, unless `tooltipText`
// overrides it, its tooltip.
export function iconButton(tooltip, {iconName, label, onClick, tooltipText = label}) {
    const button = new St.Button({
        style_class: 'aiusagebar-action-button',
        child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
        can_focus: true,
        track_hover: true,
    });
    button.accessible_name = label;
    button.connect('clicked', () => {
        tooltip.hide();
        onClick();
    });
    tooltip.attach(button, tooltipText);
    return button;
}

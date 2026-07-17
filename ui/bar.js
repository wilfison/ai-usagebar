import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {fillSegments} from '../lib/pace-fill.js';

function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
}

const MARKER_W = 2;

// A fill (usage) bar whose children are sized from the *allocated* width every
// layout pass. Reading `.width` on a notify signal is unreliable here: the
// track is x_expand, so its allocation grows past the preferred width without
// emitting notify::width, which would leave the fill sized to the smaller
// preferred width.
const Bar = GObject.registerClass(
class AiUsageBar extends St.Widget {
    _init(fraction, markerFraction, overColor) {
        super._init({
            style_class: 'aiusagebar-bar aiusagebar-bar-track',
            x_expand: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._fraction = fraction;
        this._markerFraction = markerFraction;

        this._fill = new St.Widget({style_class: 'aiusagebar-bar-fill'});
        this.add_child(this._fill);

        // A second fill segment painted past the marker in the pace colour, so
        // the stretch that overshoots the expected ritmo stands out. Built only
        // when both a marker and a pace colour are present; otherwise the fill
        // stays single-colour, exactly as before.
        this._overFill = null;
        if (markerFraction !== null && overColor) {
            this._overFill = new St.Widget({style_class: 'aiusagebar-bar-fill'});
            this._overFill.set_style(`background-color: ${overColor};`);
            this.add_child(this._overFill);
        }

        this._marker = null;
        // A numeric 0 is a valid marker position (window just reset); only
        // null/undefined means "no marker".
        if (markerFraction !== null) {
            this._marker = new St.Widget({style_class: 'aiusagebar-bar-marker'});
            this.add_child(this._marker);
        }
    }

    setFillColor(color) {
        if (color)
            this._fill.set_style(`background-color: ${color};`);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const w = box.get_width();
        const h = box.get_height();
        const seg = fillSegments(this._fraction, this._markerFraction, w, MARKER_W);

        const fillBox = new Clutter.ActorBox();
        fillBox.set_origin(0, 0);
        fillBox.set_size(this._overFill ? seg.baseW : seg.fillW, h);
        this._fill.allocate(fillBox);

        if (this._overFill) {
            const overBox = new Clutter.ActorBox();
            overBox.set_origin(seg.markerX, 0);
            overBox.set_size(seg.overW, h);
            this._overFill.allocate(overBox);
        }

        if (this._marker) {
            const markerBox = new Clutter.ActorBox();
            markerBox.set_origin(seg.markerX, 0);
            markerBox.set_size(MARKER_W, h);
            this._marker.allocate(markerBox);
        }
    }
});

export function makeBar(pct, color = null, elapsedPct = null, overColor = null) {
    const fraction = clamp(pct, 0, 100) / 100;
    const markerFraction = typeof elapsedPct === 'number' ? clamp(elapsedPct, 0, 100) / 100 : null;

    const bar = new Bar(fraction, markerFraction, overColor);
    bar.setFillColor(color);
    return bar;
}

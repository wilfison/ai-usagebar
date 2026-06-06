/**
 * @file Full-width progress bar. St (GNOME 50 / St-18) exposes no `BarLevel`
 * widget, so the bar is a thin hand-drawn `St.Widget`: the widget itself is the
 * rounded translucent track and a single child is the fill, sized to a fraction
 * of the bar's *actual* allocated width on every layout pass (so it fills the
 * card width responsively). All colors live in the `.aiusagebar-bar*` CSS
 * classes — the fill uses `-st-accent-color`, the one themed color token St
 * exposes — so nothing is colored inline here.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * Clamp `n` to the inclusive `[lo, hi]` range.
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
}

/**
 * Build a full-width accent-filled bar at `pct` percent. A `FixedLayout` lets the
 * fill be sized by hand against the live allocation; the bar's own size comes
 * from CSS height + `x_expand`, so resizing the fill cannot feed back into it.
 * @param {number} pct - fill percent; clamped to 0..100.
 * @returns {St.Widget}
 */
export function makeBar(pct) {
    const fraction = clamp(pct, 0, 100) / 100;

    const bar = new St.Widget({
        style_class: 'aiusagebar-bar aiusagebar-bar-track',
        x_expand: true,
        layout_manager: new Clutter.FixedLayout(),
    });

    const fill = new St.Widget({style_class: 'aiusagebar-bar-fill'});
    bar.add_child(fill);

    const apply = () => {
        fill.set_position(0, 0);
        fill.set_size(Math.round(fraction * bar.width), bar.height);
    };
    bar.connect('notify::width', apply);
    bar.connect('notify::height', apply);
    apply();

    return bar;
}

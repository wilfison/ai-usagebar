/**
 * @file Reusable horizontal progress-bar widget. A severity-colored filled
 * portion drawn over a theme-neutral translucent track, used by each popup
 * window/gauge row. Height, rounding, and the track color live in the
 * `.aiusagebar-bar*` CSS classes (so the track follows the shell theme); only
 * the proportional sizing and the dynamic severity fill color are set here.
 *
 * The default `fullWidth` mode (used by the Adwaita boxed-list rows) expands to
 * the available card width and sizes the fill as a fraction of the bar's actual
 * allocation, so the bar tracks the popup width like a libadwaita level bar.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** @type {number} Total bar width in pixels for the legacy fixed-width mode. */
export const BAR_WIDTH_PX = 120;

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
 * Build a full-width progress bar that re-sizes its fill (and optional marker)
 * to a fraction of its own allocated width on every layout pass. The bar widget
 * itself carries the translucent rounded track; a `FixedLayout` lets the fill
 * and marker be positioned/sized by hand against the live allocation.
 * @param {number} fraction - fill fraction in 0..1.
 * @param {string} color - hex fill color.
 * @param {import('../lib/theme.js').Theme} theme - palette (marker color).
 * @param {?{markerPct?: number}} opts - `markerPct` draws a thin elapsed marker.
 * @returns {St.Widget}
 */
function makeFullWidthBar(fraction, color, theme, opts) {
    const bar = new St.Widget({
        style_class: 'aiusagebar-bar aiusagebar-bar-track',
        x_expand: true,
        layout_manager: new Clutter.FixedLayout(),
    });

    const filled = new St.Widget({style_class: 'aiusagebar-bar-fill'});
    filled.set_style(`background-color: ${color};`);
    bar.add_child(filled);

    let marker = null;
    let markerFraction = 0;
    if (opts && typeof opts.markerPct === 'number') {
        marker = new St.Widget();
        marker.set_style(`background-color: ${theme.marker};`);
        bar.add_child(marker);
        markerFraction = clamp(opts.markerPct, 0, 100) / 100;
    }

    // Re-layout against the real allocation; the bar's own size comes from CSS
    // height + x_expand, so setting child sizes here cannot feed back into it.
    const apply = () => {
        const w = bar.width;
        const h = bar.height;
        filled.set_position(0, 0);
        filled.set_size(Math.round(fraction * w), h);
        if (marker) {
            marker.set_position(Math.round(markerFraction * w), 0);
            marker.set_size(2, h);
        }
    };
    bar.connect('notify::width', apply);
    bar.connect('notify::height', apply);
    apply();
    return bar;
}

/**
 * Build a progress bar.
 * @param {number} pct - fill percent; clamped to 0..100.
 * @param {string} color - hex fill color (caller resolves from severity).
 * @param {import('../lib/theme.js').Theme} theme - palette (empty/marker colors).
 * @param {?{markerPct?: number, fullWidth?: boolean}} [opts] - `fullWidth` expands
 *   to the available width (Adwaita boxed rows); otherwise a fixed
 *   {@link BAR_WIDTH_PX}-wide strip. `markerPct` draws a thin elapsed-position
 *   marker using `theme.marker`.
 * @returns {St.Widget} a `St.Widget`/`St.BoxLayout` holding the bar.
 */
export function makeBar(pct, color, theme, opts = null) {
    const fraction = clamp(pct, 0, 100) / 100;
    if (opts?.fullWidth)
        return makeFullWidthBar(fraction, color, theme, opts);

    const fillW = Math.round(fraction * BAR_WIDTH_PX);
    const emptyW = BAR_WIDTH_PX - fillW;

    const bar = new St.BoxLayout({style_class: 'aiusagebar-bar', x_expand: false});

    const filled = new St.Widget({style_class: 'aiusagebar-bar-fill', width: fillW, y_expand: true});
    filled.set_style(`background-color: ${color};`);
    bar.add_child(filled);

    const empty = new St.Widget({style_class: 'aiusagebar-bar-track', width: emptyW, y_expand: true});
    bar.add_child(empty);

    if (opts && typeof opts.markerPct === 'number') {
        const markerX = Math.round((clamp(opts.markerPct, 0, 100) / 100) * BAR_WIDTH_PX);
        const marker = new St.Widget({
            width: 2,
            x: markerX,
            y: 0,
            y_expand: true,
        });
        marker.set_style(`background-color: ${theme.marker};`);
        bar.add_child(marker);
    }

    return bar;
}

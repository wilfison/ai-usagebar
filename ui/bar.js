/**
 * @file Reusable horizontal progress-bar widget. A fixed-width strip split into
 * a severity-colored filled portion and a theme-neutral translucent track, used
 * by each popup window/extra row. Height, rounding, and the track color live in
 * the `.aiusagebar-bar*` CSS classes (so the track follows the shell theme); only
 * the proportional width math and the dynamic severity fill color are set here.
 */

import St from 'gi://St';

/** @type {number} Total bar width in pixels. */
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
 * Build a fixed-width two-segment progress bar.
 * @param {number} pct - fill percent; clamped to 0..100.
 * @param {string} color - hex fill color (caller resolves from severity).
 * @param {import('../lib/theme.js').Theme} theme - palette (empty/marker colors).
 * @param {?{markerPct?: number}} [opts] - `markerPct` draws a thin elapsed-position
 *   marker using `theme.marker`. Reserved for a later opt-in; current callers do
 *   not pass it, but the parameter exists so adding it needs no signature change.
 * @returns {St.Widget} a `St.BoxLayout` holding the filled + empty segments.
 */
export function makeBar(pct, color, theme, opts = null) {
    const fillW = Math.round((clamp(pct, 0, 100) / 100) * BAR_WIDTH_PX);
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

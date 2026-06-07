/**
 * @file Pure color conversion for the prefs color picker. `Gtk.ColorDialogButton`
 * exposes its value as a `Gdk.RGBA` (float channels 0–1) and `RGBA.to_string()`
 * emits `rgb(r,g,b)` rather than hex, so prefs.js needs this float→`#rrggbb`
 * formatter to store the picked color in the same hex form the rest of the
 * extension already consumes. Parsing the other direction is done by
 * `Gdk.RGBA.parse()` in the gi-bound prefs process. No `gi://` imports — unit-tested.
 */

/**
 * Clamp `n` to the inclusive [lo, hi] range.
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

/**
 * Format a single 0–1 float channel as a two-digit lowercase hex byte.
 * @param {number} f - channel value (clamped to [0,1]).
 * @returns {string} two hex digits, e.g. '00', '80', 'ff'.
 */
function channelToHex(f) {
    const n = Math.round(clamp(f, 0, 1) * 255);
    return n < 16 ? `0${n.toString(16)}` : n.toString(16);
}

/**
 * Format RGB floats (0–1, as `Gdk.RGBA` exposes) into a '#rrggbb' hex string.
 * Channels are clamped to [0,1] and rounded to 8 bits. Alpha is ignored —
 * severity colors are opaque.
 * @param {number} red - red channel, 0–1.
 * @param {number} green - green channel, 0–1.
 * @param {number} blue - blue channel, 0–1.
 * @returns {string} lowercase '#rrggbb'.
 */
export function rgbToHex(red, green, blue) {
    return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

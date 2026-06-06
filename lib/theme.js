/**
 * @file Color palette resolution. Ships the default severity palette (Adwaita
 * standard hues, legible on light and dark themes), CLI-style overrides, and the
 * hex blend helper. Only the four severity colors and the pace marker are
 * consumed as hex; the renderer styles foreground/dim/accent text and the bar
 * track via CSS classes that inherit the live shell theme, so `fg`/`dim`/`blue`/
 * `barEmpty` remain only as fallbacks.
 */

/**
 * @typedef {object} Theme
 * @property {string} green - low-severity color (hex).
 * @property {string} yellow - mid-severity color (hex).
 * @property {string} orange - high-severity color (hex).
 * @property {string} red - critical-severity color (hex).
 * @property {string} blue - neutral accent color (hex).
 * @property {string} dim - dim/secondary text color (hex).
 * @property {string} fg - foreground/default text color (hex).
 * @property {string} barEmpty - background of the empty bar (hex).
 * @property {string} marker - progress marker color (hex).
 */

/** @type {Theme} Adwaita standard severity palette; fg/dim/blue/barEmpty are
 * fallbacks only (the renderer prefers theme-following CSS classes). */
const DEFAULT_PALETTE = Object.freeze({
    green: '#2ec27e',
    yellow: '#e5a50a',
    orange: '#ff7800',
    red: '#e01b24',
    blue: '#3584e4',
    dim: '#5c6370',
    fg: '#abb2bf',
    barEmpty: '#3e4451',
    marker: '#77767b',
});

/**
 * Frozen copy of the built-in default palette.
 * @returns {Theme}
 */
export function defaultTheme() {
    return Object.freeze({...DEFAULT_PALETTE});
}

/**
 * Return a copy of {@link Theme} with CLI-style severity overrides applied.
 * @param {Theme} theme - base theme.
 * @param {?{low?: string, mid?: string, high?: string, critical?: string}} overrides
 *   - severity-keyed map of hex strings; null/undefined entries are ignored.
 * @returns {Theme} new frozen theme.
 */
export function withOverrides(theme, overrides) {
    const merged = {...theme};
    const map = {low: 'green', mid: 'yellow', high: 'orange', critical: 'red'};
    if (overrides) {
        for (const [k, paletteKey] of Object.entries(map)) {
            const v = overrides[k];
            if (v !== null && v !== undefined)
                merged[paletteKey] = v;
        }
    }
    return Object.freeze(merged);
}

const HEX6 = /^#?([0-9a-fA-F]{6})$/;

function parseRgb(s) {
    const m = HEX6.exec(s);
    if (!m)
        return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function pad2hex(n) {
    return n < 16 ? `0${n.toString(16)}` : n.toString(16);
}

/**
 * Average two hex colors channel-wise.
 * @param {string} a - hex color, '#rrggbb' (leading '#' optional).
 * @param {string} b - hex color, '#rrggbb' (leading '#' optional).
 * @returns {?string} '#rrggbb' midpoint, or null if either input is malformed.
 */
export function hexBlend(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return null;
    const pa = parseRgb(a);
    const pb = parseRgb(b);
    if (!pa || !pb)
        return null;
    const r = Math.floor((pa[0] + pb[0]) / 2);
    const g = Math.floor((pa[1] + pb[1]) / 2);
    const bl = Math.floor((pa[2] + pb[2]) / 2);
    return `#${pad2hex(r)}${pad2hex(g)}${pad2hex(bl)}`;
}

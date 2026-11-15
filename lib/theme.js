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

export function defaultTheme() {
    return Object.freeze({...DEFAULT_PALETTE});
}

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

function channel(v) {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of a #rrggbb colour, or null when it is not one.
export function luminance(hex) {
    const rgb = typeof hex === 'string' ? parseRgb(hex) : null;
    if (!rgb)
        return null;
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

// About 4:1 against the popup's dark card.
const TEXT_MIN_LUMINANCE = 0.32;

// A severity colour as text on a dark background: the saturated palette
// suits a bar, but its red is too dark to read as small type, so it is
// mixed towards white until it is bright enough. Others pass unchanged.
export function legibleOnDark(hex, minLuminance = TEXT_MIN_LUMINANCE) {
    const rgb = typeof hex === 'string' ? parseRgb(hex) : null;
    if (!rgb)
        return hex;
    for (let t = 0; t <= 1; t += 0.05) {
        const mixed = `#${rgb.map(v => pad2hex(Math.round(v + (255 - v) * t))).join('')}`;
        if (luminance(mixed) >= minLuminance)
            return t === 0 ? hex : mixed;
    }
    return '#ffffff';
}

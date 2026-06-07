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

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function channelToHex(f) {
    const n = Math.round(clamp(f, 0, 1) * 255);
    return n < 16 ? `0${n.toString(16)}` : n.toString(16);
}

export function rgbToHex(red, green, blue) {
    return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

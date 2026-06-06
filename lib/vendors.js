/**
 * @file Vendor identity — the canonical list of supported vendors and their
 * fixed ordering. Kept gi-free so it can be imported by both the pure config
 * layer and the shell-bound UI without pulling in GObject.
 */

/**
 * Supported vendor ids in canonical display/iteration order. Frozen so callers
 * can rely on a stable order without copying.
 * @type {readonly string[]}
 */
export const VENDOR_IDS = Object.freeze([
    'anthropic',
    'openai',
    'zai',
    'openrouter',
    'deepseek',
]);

/**
 * True when `s` is a known vendor id.
 * @param {*} s
 * @returns {boolean}
 */
export function isVendorId(s) {
    return VENDOR_IDS.includes(s);
}

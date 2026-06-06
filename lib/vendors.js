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
 * Human-readable vendor display names, in canonical {@link VENDOR_IDS} order.
 * Used by the (separate-process) prefs window for page titles and the
 * primary-vendor combo, since prefs cannot import the gi-bound adapter registry.
 * Frozen so callers can rely on a stable order without copying.
 * @type {readonly string[]}
 */
export const VENDOR_LABELS = Object.freeze([
    'Anthropic',
    'OpenAI',
    'Z.AI',
    'OpenRouter',
    'DeepSeek',
]);

/**
 * True when `s` is a known vendor id.
 * @param {*} s
 * @returns {boolean}
 */
export function isVendorId(s) {
    return VENDOR_IDS.includes(s);
}

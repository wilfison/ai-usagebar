/**
 * @file Pure configuration logic: API-key resolution, enabled-vendor filtering,
 * empty-string normalization, and primary-vendor fallback. Kept gi-free (the
 * environment lookup is injected) so every branch is unit-testable without the
 * shell.
 */

import {VENDOR_IDS} from './vendors.js';

/**
 * @typedef {object} VendorFlags
 * @property {boolean} enabled
 *
 * @typedef {object} ConfigSnapshotLike
 * @property {string} primaryVendor
 * @property {string} [activeVendor] - the scroll-selected vendor, when set.
 * @property {Object<string, VendorFlags>} vendors - keyed by vendor id.
 */

/**
 * Map an empty string to `null`, passing every other value through unchanged.
 * Used to turn GSettings' empty-string "unset" sentinel into a real `null`.
 * @param {string} s
 * @returns {?string}
 */
export function emptyToNull(s) {
    return s === '' ? null : s;
}

/**
 * Resolve a vendor's API key. An environment variable wins (when it names a
 * non-empty value); otherwise a non-empty inline key is used; otherwise this
 * throws naming both sources so the user knows how to fix it.
 * @param {string} vendorLabel - human label for the error message (e.g. 'Z.AI').
 * @param {string} envName - environment variable name to consult; '' skips it.
 * @param {?string} inline - inline key, or null/'' when unset.
 * @param {(name: string) => ?string} getenv - environment lookup (inject
 *   `GLib.getenv` from the caller).
 * @returns {string} the resolved, non-empty key.
 * @throws {Error} when neither source yields a non-empty key.
 */
export function resolveApiKey(vendorLabel, envName, inline, getenv) {
    if (envName) {
        const fromEnv = getenv(envName);
        if (fromEnv)
            return fromEnv;
    }
    if (inline)
        return inline;
    throw new Error(
        `${vendorLabel}: no API key — export ${envName} or set the inline ` +
        `API key for ${vendorLabel} in the extension preferences.`
    );
}

/**
 * Whether a vendor is enabled in `snapshot`.
 * @param {ConfigSnapshotLike} snapshot
 * @param {string} id - vendor id.
 * @returns {boolean}
 */
export function isEnabled(snapshot, id) {
    return snapshot.vendors[id]?.enabled === true;
}

/**
 * The enabled vendor ids in canonical {@link VENDOR_IDS} order.
 * @param {ConfigSnapshotLike} snapshot
 * @returns {string[]}
 */
export function enabledVendors(snapshot) {
    return VENDOR_IDS.filter(id => isEnabled(snapshot, id));
}

/**
 * The effective primary vendor: the configured one when it is enabled, else the
 * first enabled vendor, else `'anthropic'` as a last-resort default.
 * @param {ConfigSnapshotLike} snapshot
 * @returns {string}
 */
export function normalizePrimary(snapshot) {
    if (isEnabled(snapshot, snapshot.primaryVendor))
        return snapshot.primaryVendor;
    const enabled = enabledVendors(snapshot);
    return enabled.length > 0 ? enabled[0] : 'anthropic';
}

/**
 * The effective display vendor: the scroll-selected `activeVendor` when it is
 * enabled, else the {@link normalizePrimary} fallback. This is what the bar
 * label and the auto-expanded popup section dispatch on.
 * @param {ConfigSnapshotLike} snapshot
 * @returns {string}
 */
export function normalizeActive(snapshot) {
    if (isEnabled(snapshot, snapshot.activeVendor))
        return snapshot.activeVendor;
    return normalizePrimary(snapshot);
}

/**
 * Step to the next/previous vendor in `enabledIds`, wrapping around. When
 * `current` is not present, returns the first element for `dir = +1` and the
 * last for `dir = -1`. Returns `current` unchanged when `enabledIds` is empty.
 * @param {string[]} enabledIds - enabled vendor ids in display order.
 * @param {string} current - the currently active vendor id.
 * @param {number} dir - `+1` for next, `-1` for previous.
 * @returns {string} the cycled vendor id.
 */
export function cycleVendor(enabledIds, current, dir) {
    if (enabledIds.length === 0)
        return current;
    const idx = enabledIds.indexOf(current);
    if (idx === -1)
        return dir >= 0 ? enabledIds[0] : enabledIds[enabledIds.length - 1];
    const next = (idx + dir + enabledIds.length) % enabledIds.length;
    return enabledIds[next];
}

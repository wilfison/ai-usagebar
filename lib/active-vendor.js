/**
 * @file Best-effort disk mirror of the active vendor. The in-memory GSettings
 * `active-vendor` key is the source of truth; this writes the same id to
 * `<cacheRoot>/active_vendor` so a co-running external consumer can stay in
 * sync. It only writes when the cache root already exists (its presence implies
 * such a consumer) and never throws into the event loop.
 */

import Gio from 'gi://Gio';

import {cacheRoot, atomicWrite} from './cache.js';

/** @type {string} Mirror filename under the cache root. */
const MIRROR_NAME = 'active_vendor';

/**
 * Mirror the active vendor id to `<cacheRoot>/active_vendor` as `<id>\n`,
 * atomically. No-op when the cache root does not yet exist (no mkdir). All
 * errors are swallowed (logged at most at `console.debug`) so a failing mirror
 * never disturbs the shell.
 *
 * The id uses our `VENDOR_IDS` slug. Interop is best-effort: an external
 * consumer expecting a different vocabulary simply ignores the file — it must
 * never change our own behavior.
 * @param {string} id - the active vendor id.
 * @returns {void}
 */
export function writeActiveVendorMirror(id) {
    try {
        const root = Gio.File.new_for_path(cacheRoot());
        if (!root.query_exists(null))
            return;
        atomicWrite(root.get_child(MIRROR_NAME), new TextEncoder().encode(`${id}\n`));
    } catch (e) {
        console.debug(`ai-usagebar: active_vendor mirror failed: ${e}`);
    }
}

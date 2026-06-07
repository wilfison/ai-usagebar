import Gio from 'gi://Gio';

import {cacheRoot, atomicWrite} from './cache.js';

const MIRROR_NAME = 'active_vendor';

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

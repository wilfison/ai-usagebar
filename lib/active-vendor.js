import Gio from 'gi://Gio';

import {cacheRoot, atomicWrite} from './cache.js';

const MIRROR_NAME = 'active_vendor';

// Never rejects. No cache root yet means no vendor has fetched: nothing reads
// the mirror, so it is not created for it.
export async function writeActiveVendorMirror(id) {
    try {
        await atomicWrite(Gio.File.new_for_path(cacheRoot()).get_child(MIRROR_NAME), new TextEncoder().encode(`${id}\n`));
    } catch (e) {
        console.debug(`ai-usagebar: active_vendor mirror failed: ${e}`);
    }
}

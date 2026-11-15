import Gio from 'gi://Gio';

import {cacheRoot, atomicWrite} from './cache.js';

const MIRROR_NAME = 'active_vendor';

// Writes run one after another, so an older id never lands last; one
// overtaken by a newer call before it started is skipped.
let _queue = Promise.resolve();
let _latest = null;
let _pending = 0;

async function write(id) {
    if (id !== _latest)
        return;
    try {
        await atomicWrite(Gio.File.new_for_path(cacheRoot()).get_child(MIRROR_NAME), new TextEncoder().encode(`${id}\n`));
    } catch (e) {
        console.debug(`ai-usagebar: active_vendor mirror failed: ${e}`);
    }
}

// Never rejects. No cache root yet means no vendor has fetched: nothing reads
// the mirror, so it is not created for it.
export function writeActiveVendorMirror(id) {
    _latest = id;
    _pending++;
    _queue = _queue.then(() => write(id)).finally(() => _pending--);
    return _queue;
}

export function pendingMirrorWrites() {
    return _pending;
}

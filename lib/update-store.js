import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {cacheRoot, atomicWrite, loadBytesAsync} from './cache.js';
import {parseState, serializeState} from './update-check.js';

const STATE_NAME = 'update_check';

function stateFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([cacheRoot(), STATE_NAME]));
}

export async function readUpdateState() {
    try {
        return parseState(new TextDecoder().decode(await loadBytesAsync(stateFile())));
    } catch (_e) {
        return parseState('');
    }
}

export async function writeUpdateState(state) {
    try {
        GLib.mkdir_with_parents(cacheRoot(), 0o700);
        await atomicWrite(stateFile(), new TextEncoder().encode(serializeState(state)));
    } catch (e) {
        console.debug(`ai-usagebar: update state write failed: ${e}`);
    }
}

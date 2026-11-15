// The JSON credentials files both CLIs keep (~/.claude, ~/.codex): read as a
// top-level object, written back merged and atomically.
import Gio from 'gi://Gio';

import {atomicWrite, loadBytesAsync, isNotFound} from '../cache.js';

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Every failure throws with the login hint; a missing file has `code: 'ENOENT'`.
export async function readJsonCredentials(path, loginCommand) {
    const hint = `Run \`${loginCommand}\` to re-authenticate.`;
    let contents;
    try {
        contents = await loadBytesAsync(Gio.File.new_for_path(path));
    } catch (e) {
        if (!isNotFound(e))
            throw new Error(`could not read ${path}: ${e?.message ?? e}. ${hint}`);
        contents = null;
    }
    if (contents === null) {
        const err = new Error(`credentials file not found at ${path}. ${hint}`);
        err.code = 'ENOENT';
        throw err;
    }

    let raw;
    try {
        raw = JSON.parse(new TextDecoder().decode(contents));
    } catch (e) {
        throw new Error(`could not parse ${path}: ${e?.message ?? e}. ${hint}`);
    }
    if (!isObject(raw))
        throw new Error(`could not parse ${path}: top-level value is not an object. ${hint}`);
    return raw;
}

async function readObjectOrEmpty(file) {
    try {
        const contents = await loadBytesAsync(file);
        const parsed = contents === null ? null : JSON.parse(new TextDecoder().decode(contents));
        return isObject(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

// `update(doc)` runs on the file as it is on disk now, so a field the CLI
// wrote since the fetch read it survives. Never throws: `{ok}` or
// `{ok: false, kind: 'io', message}`.
export async function updateJsonCredentials(path, update) {
    const file = Gio.File.new_for_path(path);
    let merged;
    try {
        merged = update(await readObjectOrEmpty(file));
    } catch (e) {
        return {ok: false, kind: 'io', message: `merge failed: ${e?.message ?? e}`};
    }
    try {
        await atomicWrite(file, new TextEncoder().encode(JSON.stringify(merged, null, 2)));
    } catch (e) {
        return {ok: false, kind: 'io', message: e?.message ?? String(e)};
    }
    return {ok: true};
}

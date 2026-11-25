import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {RETRY_AFTER_MS} from './vendors/fetch-common.js';
import {parseState, serializeState} from './notify.js';
import {parseTrend, serializeTrend} from './trend.js';

const APP_DIR = 'ai-usagebar';
const PAYLOAD_NAME = 'usage.json';
const STALE_NAME = '.stale';
const ERROR_NAME = '.last_error';
const NOTIFIED_NAME = '.notified';
const RETRY_NAME = '.retry_after';
const TREND_NAME = '.trend';

// The env is read on each call: get_user_cache_dir() keeps its first answer,
// and the tests point XDG_CACHE_HOME at a temp dir per case.
export function cacheRoot() {
    const xdg = GLib.getenv('XDG_CACHE_HOME');
    const base = xdg && xdg.length > 0 ? xdg : GLib.get_user_cache_dir();
    return GLib.build_filenamev([base, APP_DIR]);
}

function toBytes(input) {
    if (input instanceof Uint8Array)
        return input;
    if (typeof input === 'string')
        return new TextEncoder().encode(input);
    throw new TypeError('writePayload: bytes must be Uint8Array or string');
}

export function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) === true;
}

// Wraps a Gio `<name>_async` / `<name>_finish` pair as a Promise. Reads and
// writes all go through these: the Shell main loop never waits on the disk.
function gio(obj, name, ...args) {
    return new Promise((resolve, reject) => {
        obj[`${name}_async`](...args, (o, res) => {
            try {
                resolve(o[`${name}_finish`](res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// The finish call throws NOT_FOUND, which callers handle via isNotFound().
export async function loadBytesAsync(file) {
    const [ok, contents] = await gio(file, 'load_contents', null);
    return ok ? contents : null;
}

function queryInfoAsync(file, attributes, flags) {
    return gio(file, 'query_info', attributes, flags, GLib.PRIORITY_DEFAULT, null);
}

async function deleteIfExists(file) {
    try {
        await gio(file, 'delete', GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (!isNotFound(e))
            throw e;
    }
}

// The bytes go to a private sibling tempfile, then a rename replaces the
// destination (a symlink there is replaced, not followed). GLib.Bytes, not a
// Uint8Array: the async write must own its buffer.
export async function atomicWrite(file, bytes) {
    const parent = file.get_parent();
    if (parent === null)
        throw new Error('atomicWrite: destination has no parent directory');
    const tmp = parent.get_child(`.${file.get_basename()}.tmp-${GLib.get_monotonic_time()}-${Math.floor(Math.random() * 1e9)}`);
    try {
        await new Promise((resolve, reject) => {
            tmp.replace_contents_bytes_async(new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.PRIVATE, null, (f, res) => {
                try {
                    resolve(f.replace_contents_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        await gio(tmp, 'move', file, Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT, null, null);
    } catch (e) {
        await deleteIfExists(tmp).catch(() => { /* best-effort */ });
        throw e;
    }
}

export class Cache {
    constructor(vendor) {
        if (!vendor || typeof vendor !== 'string')
            throw new TypeError('Cache: vendor must be a non-empty string');
        this._vendor = vendor;
        this._dir = GLib.build_filenamev([cacheRoot(), vendor]);
    }

    get dir() {
        return this._dir;
    }

    get payloadPath() {
        return GLib.build_filenamev([this._dir, PAYLOAD_NAME]);
    }

    // Once per instance; `_put` re-creates it if it vanished since.
    ensureDir() {
        if (this._dirReady)
            return;
        const rc = GLib.mkdir_with_parents(this._dir, 0o700);
        if (rc !== 0)
            throw new Error(`Cache.ensureDir: mkdir_with_parents(${this._dir}) failed`);
        this._dirReady = true;
    }

    _file(name) {
        return Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
    }

    // A missing file reads as null.
    async _readBytes(name) {
        try {
            return await loadBytesAsync(this._file(name));
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    async _readText(name) {
        const contents = await this._readBytes(name);
        return contents === null ? null : new TextDecoder().decode(contents);
    }

    async _put(write) {
        this.ensureDir();
        try {
            await write();
        } catch (e) {
            if (!isNotFound(e))
                throw e;
            this._dirReady = false;
            this.ensureDir();
            await write();
        }
    }

    _writeText(name, text) {
        return this._put(() => atomicWrite(this._file(name), new TextEncoder().encode(text)));
    }

    _remove(name) {
        return deleteIfExists(this._file(name));
    }

    async payloadAgeMs() {
        const f = this._file(PAYLOAD_NAME);
        try {
            const info = await queryInfoAsync(
                f,
                'time::modified,time::modified-usec',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS
            );
            const sec = info.get_attribute_uint64('time::modified');
            const usec = info.get_attribute_uint32('time::modified-usec');
            const mtimeMs = sec * 1000 + Math.floor(usec / 1000);
            const ageMs = Date.now() - mtimeMs;
            return ageMs < 0 ? 0 : ageMs;
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    async freshPayload(ttlMs) {
        const age = await this.payloadAgeMs();
        if (age === null || age >= ttlMs)
            return null;
        return this.maybePayload();
    }

    maybePayload() {
        return this._readBytes(PAYLOAD_NAME);
    }

    async writePayload(bytes) {
        await this._put(() => atomicWrite(this._file(PAYLOAD_NAME), toBytes(bytes)));
        await this._remove(STALE_NAME);
        await this.clearLastError();
    }

    async clearLastError() {
        await this._remove(ERROR_NAME);
        await this.clearRetryAfter();
    }

    // An empty marker file: replace_contents can't take a zero-length buffer
    // (gjs binds it as NULL), so a stream is opened and closed.
    markStale() {
        return this._put(async () => {
            const stream = await gio(this._file(STALE_NAME), 'replace', null, false, Gio.FileCreateFlags.PRIVATE,
                GLib.PRIORITY_DEFAULT, null);
            await gio(stream, 'close', GLib.PRIORITY_DEFAULT, null);
        });
    }

    // A 429 from any endpoint (usage or token) arms the backoff.
    async writeLastError(code, msg) {
        if (code === 429)
            await this.writeRetryAfter(Date.now() + RETRY_AFTER_MS);
        await this._writeText(ERROR_NAME, `${code}\n${msg ?? ''}`);
    }

    async readLastError() {
        const text = await this._readText(ERROR_NAME);
        if (text === null)
            return null;
        const nl = text.indexOf('\n');
        const code = Number.parseInt(nl < 0 ? text.trim() : text.slice(0, nl).trim(), 10);
        if (!Number.isFinite(code))
            return null;
        return {code, body: nl < 0 ? '' : text.slice(nl + 1)};
    }

    writeRetryAfter(untilMs) {
        return this._writeText(RETRY_NAME, String(Math.ceil(untilMs / 1000)));
    }

    // Epoch ms, or null for an absent or corrupt marker (corrupt = no backoff).
    async readRetryAfter() {
        const text = (await this._readText(RETRY_NAME))?.trim() ?? null;
        if (text === null || !/^\d+$/.test(text))
            return null;
        return Number(text) * 1000;
    }

    clearRetryAfter() {
        return this._remove(RETRY_NAME);
    }

    // Notification dedupe state; intentionally not cleared by writePayload().
    // Rejects on failure so the caller can skip delivery instead of repeating it.
    writeNotified(state) {
        return this._writeText(NOTIFIED_NAME, serializeState(state));
    }

    async readNotified() {
        return parseState(await this._readText(NOTIFIED_NAME) ?? '');
    }

    // Usage trend samples (lib/trend.js); like .notified, kept by writePayload().
    writeTrend(trend) {
        return this._writeText(TREND_NAME, serializeTrend(trend));
    }

    async readTrend() {
        return parseTrend(await this._readText(TREND_NAME));
    }
}

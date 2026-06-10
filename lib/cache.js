import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const APP_DIR = 'ai-usagebar';
const PAYLOAD_NAME = 'usage.json';
const STALE_NAME = '.stale';
const ERROR_NAME = '.last_error';
const NOTIFIED_NAME = '.notified';

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

function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) === true;
}

// Async reads keep the Shell main loop responsive; the finish call throws
// NOT_FOUND, which callers handle via isNotFound().
export function loadBytesAsync(file) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(null, (f, res) => {
            try {
                const [ok, contents] = f.load_contents_finish(res);
                resolve(ok ? contents : null);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function queryInfoAsync(file, attributes, flags) {
    return new Promise((resolve, reject) => {
        file.query_info_async(attributes, flags, GLib.PRIORITY_DEFAULT, null, (f, res) => {
            try {
                resolve(f.query_info_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function atomicWrite(file, bytes, {perms = 0o600} = {}) {
    const parent = file.get_parent();
    if (parent === null)
        throw new Error('atomicWrite: destination has no parent directory');
    const baseName = file.get_basename();
    const tmpName = `.${baseName}.tmp-${GLib.get_monotonic_time()}-${Math.floor(Math.random() * 1e9)}`;
    const tmp = parent.get_child(tmpName);
    try {
        const stream = tmp.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        try {
            stream.write_all(bytes, null);
            stream.flush(null);
        } finally {
            stream.close(null);
        }
        if (perms !== 0o600) {
            tmp.set_attribute_uint32(
                'unix::mode',
                perms,
                Gio.FileQueryInfoFlags.NONE,
                null
            );
        }
        tmp.move(
            file,
            Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.NOFOLLOW_SYMLINKS,
            null,
            null
        );
    } catch (e) {
        try { tmp.delete(null); } catch (_) { /* best-effort */ }
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

    static forVendor(vendor) {
        return new Cache(vendor);
    }

    get dir() {
        return this._dir;
    }

    get payloadPath() {
        return GLib.build_filenamev([this._dir, PAYLOAD_NAME]);
    }

    ensureDir() {
        const rc = GLib.mkdir_with_parents(this._dir, 0o700);
        if (rc !== 0)
            throw new Error(`Cache.ensureDir: mkdir_with_parents(${this._dir}) failed`);
    }

    _file(name) {
        return Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
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

    async maybePayload() {
        const f = this._file(PAYLOAD_NAME);
        try {
            return await loadBytesAsync(f);
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    writePayload(bytes) {
        this.ensureDir();
        atomicWrite(this._file(PAYLOAD_NAME), toBytes(bytes));
        this._removeIfExists(STALE_NAME);
        this._removeIfExists(ERROR_NAME);
    }

    markStale() {
        this.ensureDir();
        // replace_contents() can't take a zero-length Uint8Array (gjs binds
        // it as NULL, which triggers a GIO-CRITICAL). Open-and-close an
        // output stream so the on-disk file is truly empty.
        const stream = this._file(STALE_NAME).replace(
            null,
            false,
            Gio.FileCreateFlags.PRIVATE,
            null
        );
        stream.close(null);
    }

    isStale() {
        return this._file(STALE_NAME).query_exists(null);
    }

    writeLastError(code, msg) {
        this.ensureDir();
        const text = `${code}\n${msg ?? ''}`;
        this._file(ERROR_NAME).replace_contents(
            new TextEncoder().encode(text),
            null,
            false,
            Gio.FileCreateFlags.PRIVATE,
            null
        );
    }

    async readLastError() {
        const f = this._file(ERROR_NAME);
        try {
            const contents = await loadBytesAsync(f);
            if (contents === null)
                return null;
            const text = new TextDecoder().decode(contents);
            const nl = text.indexOf('\n');
            const codeStr = nl < 0 ? text.trim() : text.slice(0, nl).trim();
            const code = Number.parseInt(codeStr, 10);
            if (!Number.isFinite(code))
                return null;
            const body = nl < 0 ? '' : text.slice(nl + 1);
            return {code, body};
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    // Notification debounce state; intentionally not cleared by writePayload().
    writeNotified(state) {
        this.ensureDir();
        const percent = state.percent == null ? '' : String(state.percent);
        const at = state.at == null ? '' : String(state.at);
        const text = `${percent}\n${at}\n${state.windowKey ?? ''}`;
        this._file(NOTIFIED_NAME).replace_contents(
            new TextEncoder().encode(text),
            null,
            false,
            Gio.FileCreateFlags.PRIVATE,
            null
        );
    }

    async readNotified() {
        const f = this._file(NOTIFIED_NAME);
        try {
            const contents = await loadBytesAsync(f);
            if (contents === null)
                return null;
            const lines = new TextDecoder().decode(contents).split('\n');
            return {
                percent: lines[0] ? Number(lines[0]) : null,
                at: lines[1] ? Number(lines[1]) : null,
                windowKey: lines.slice(2).join('\n'),
            };
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    _removeIfExists(name) {
        const f = this._file(name);
        try {
            f.delete(null);
        } catch (e) {
            if (isNotFound(e))
                return;
            throw e;
        }
    }
}

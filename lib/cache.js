import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const APP_DIR = 'ai-usagebar';
const PAYLOAD_NAME = 'usage.json';
const STALE_NAME = '.stale';
const ERROR_NAME = '.last_error';

function cacheRoot() {
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

    payloadAgeMs() {
        const f = this._file(PAYLOAD_NAME);
        if (!f.query_exists(null))
            return null;
        try {
            const info = f.query_info(
                'time::modified,time::modified-usec',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null
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

    freshPayload(ttlMs) {
        const age = this.payloadAgeMs();
        if (age === null || age >= ttlMs)
            return null;
        return this.maybePayload();
    }

    maybePayload() {
        const f = this._file(PAYLOAD_NAME);
        try {
            const [ok, contents] = f.load_contents(null);
            return ok ? contents : null;
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    writePayload(bytes) {
        this.ensureDir();
        const data = toBytes(bytes);
        const tmpName = `.usage.json.tmp-${GLib.get_monotonic_time()}-${Math.floor(Math.random() * 1e9)}`;
        const tmp = this._file(tmpName);
        const stream = tmp.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        try {
            stream.write_all(data, null);
            stream.flush(null);
        } finally {
            stream.close(null);
        }
        const dst = this._file(PAYLOAD_NAME);
        tmp.move(
            dst,
            Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.NOFOLLOW_SYMLINKS,
            null,
            null
        );
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

    readLastError() {
        const f = this._file(ERROR_NAME);
        try {
            const [ok, contents] = f.load_contents(null);
            if (!ok)
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

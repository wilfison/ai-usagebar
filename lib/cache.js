/**
 * @file Per-vendor on-disk cache under `$XDG_CACHE_HOME/ai-usagebar/<vendor>/`.
 * Holds the last successful usage payload plus sidecar markers (`.stale`,
 * `.last_error`). All writes are atomic — see {@link atomicWrite}.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const APP_DIR = 'ai-usagebar';
const PAYLOAD_NAME = 'usage.json';
const STALE_NAME = '.stale';
const ERROR_NAME = '.last_error';

/**
 * Resolve the cache root directory (`$XDG_CACHE_HOME/ai-usagebar` or the GLib
 * fallback). Exported so other modules (e.g. the active-vendor mirror) resolve
 * the same path instead of duplicating the logic.
 * @returns {string} absolute path.
 */
export function cacheRoot() {
    const xdg = GLib.getenv('XDG_CACHE_HOME');
    const base = xdg && xdg.length > 0 ? xdg : GLib.get_user_cache_dir();
    return GLib.build_filenamev([base, APP_DIR]);
}

/**
 * Normalize string or Uint8Array input to bytes.
 * @param {string | Uint8Array} input
 * @returns {Uint8Array}
 * @throws {TypeError} if input is neither a string nor a Uint8Array.
 */
function toBytes(input) {
    if (input instanceof Uint8Array)
        return input;
    if (typeof input === 'string')
        return new TextEncoder().encode(input);
    throw new TypeError('writePayload: bytes must be Uint8Array or string');
}

/**
 * True if `e` is a Gio NOT_FOUND error.
 * @param {*} e
 * @returns {boolean}
 */
function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) === true;
}

/**
 * Atomic file write: write to a sibling tempfile in the destination's parent
 * directory, then rename via `Gio.File.move(OVERWRITE | NOFOLLOW_SYMLINKS)`.
 * Tempfile is cleaned up on error. The default 0o600 perms come from
 * `Gio.FileCreateFlags.PRIVATE`; a different value triggers a follow-up
 * `unix::mode` set on the tempfile before rename.
 * @param {Gio.File} file - destination.
 * @param {Uint8Array} bytes - payload.
 * @param {{perms?: number}} [opts] - optional override of file mode.
 * @throws on IO failure (after best-effort tempfile cleanup).
 */
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

/**
 * Per-vendor cache directory + payload/stale/error helpers.
 *
 * Directory layout: `$XDG_CACHE_HOME/ai-usagebar/<vendor>/`
 *   - `usage.json` — last successful payload
 *   - `.stale`     — sidecar marker set when the next fetch fails
 *   - `.last_error` — `<status>\n<body>` from the most recent failure
 */
export class Cache {
    /**
     * @param {string} vendor - non-empty vendor key (e.g. 'anthropic').
     * @throws {TypeError} if vendor is not a non-empty string.
     */
    constructor(vendor) {
        if (!vendor || typeof vendor !== 'string')
            throw new TypeError('Cache: vendor must be a non-empty string');
        this._vendor = vendor;
        this._dir = GLib.build_filenamev([cacheRoot(), vendor]);
    }

    /**
     * Convenience factory for a per-vendor cache directory.
     * @param {string} vendor
     * @returns {Cache}
     */
    static forVendor(vendor) {
        return new Cache(vendor);
    }

    /** @returns {string} absolute path to the vendor cache directory. */
    get dir() {
        return this._dir;
    }

    /** @returns {string} absolute path to the cached usage.json. */
    get payloadPath() {
        return GLib.build_filenamev([this._dir, PAYLOAD_NAME]);
    }

    /**
     * Create the vendor directory (mode 0o700) and all missing parents.
     * @returns {void}
     * @throws on mkdir failure.
     */
    ensureDir() {
        const rc = GLib.mkdir_with_parents(this._dir, 0o700);
        if (rc !== 0)
            throw new Error(`Cache.ensureDir: mkdir_with_parents(${this._dir}) failed`);
    }

    /**
     * Resolve a child file under the vendor directory.
     * @param {string} name
     * @returns {Gio.File}
     */
    _file(name) {
        return Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
    }

    /**
     * Age of the cached payload in milliseconds, or null when absent.
     * @returns {?number}
     */
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

    /**
     * Return the cached payload only if it is younger than `ttlMs`.
     * @param {number} ttlMs - max acceptable age in milliseconds.
     * @returns {?Uint8Array} payload bytes, or null when missing/stale.
     */
    freshPayload(ttlMs) {
        const age = this.payloadAgeMs();
        if (age === null || age >= ttlMs)
            return null;
        return this.maybePayload();
    }

    /**
     * Return the cached payload regardless of age, or null when absent.
     * @returns {?Uint8Array}
     */
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

    /**
     * Atomically persist a fresh payload and clear the stale/error markers.
     * @param {string | Uint8Array} bytes
     * @returns {void}
     */
    writePayload(bytes) {
        this.ensureDir();
        atomicWrite(this._file(PAYLOAD_NAME), toBytes(bytes));
        this._removeIfExists(STALE_NAME);
        this._removeIfExists(ERROR_NAME);
    }

    /**
     * Touch the `.stale` sidecar so the indicator can paint a "stale" badge
     * on top of the still-loadable cached payload.
     * @returns {void}
     */
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

    /**
     * @returns {boolean} true if the `.stale` marker exists.
     */
    isStale() {
        return this._file(STALE_NAME).query_exists(null);
    }

    /**
     * Persist the most recent failure (HTTP status + body) to `.last_error`.
     * @param {number} code - numeric error/status code.
     * @param {?string} [msg] - optional body/message.
     * @returns {void}
     */
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

    /**
     * Read the last error sidecar.
     * @returns {?{code: number, body: string}} parsed error, or null when
     *   missing or malformed.
     */
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

    /**
     * Unlink a child file if present; swallow NOT_FOUND.
     * @param {string} name
     * @returns {void}
     */
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

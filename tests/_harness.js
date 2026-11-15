// Shared test fixtures: a main-loop promise runner, HTTP stubs, temp files
// and a throwaway XDG cache home.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Cache} from '../lib/cache.js';

// The `it` harness is synchronous, so resolve promises against a main loop.
export function runSync(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value, err, rejected = false, done = false;
    Promise.resolve(promise).then(
        v => {
            value = v;
            done = true;
            loop.quit();
        },
        e => {
            err = e;
            rejected = true;
            done = true;
            loop.quit();
        }
    );
    if (!done)
        loop.run();
    // A falsy reason (`Promise.reject()`) is still a rejection.
    if (rejected)
        throw err;
    return value;
}

export function res(status, text) {
    return {status, headers: {}, bodyBytes: new TextEncoder().encode(text ?? ''), error: null};
}

export function resTransport(message = 'connection refused') {
    return {status: 0, headers: {}, bodyBytes: new Uint8Array(0), error: {kind: 'transport', message}};
}

// One response for every call, or a list walked in order whose last entry repeats.
export function httpStub(responses) {
    const seq = Array.isArray(responses) ? responses : [responses];
    const calls = [];
    const fn = opts => {
        const r = seq[Math.min(calls.length, seq.length - 1)];
        calls.push(opts);
        return Promise.resolve(r);
    };
    fn.calls = calls;
    return fn;
}

// Answers by request key (the url by default), so parallel requests may land in any order.
export function routeStub(routes, {key = opts => opts.url, fallback} = {}) {
    const calls = [];
    const fn = opts => {
        calls.push(opts);
        const r = routes[key(opts)] ?? fallback;
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    };
    fn.calls = calls;
    return fn;
}

export function rmRf(path) {
    const f = Gio.File.new_for_path(path);
    if (!f.query_exists(null))
        return;
    let info;
    try {
        info = f.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (_) {
        return;
    }
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const en = f.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let child;
        while ((child = en.next_file(null)))
            rmRf(GLib.build_filenamev([path, child.get_name()]));
        en.close(null);
    }
    try {
        f.delete(null);
    } catch (_) {
        // best-effort
    }
}

export function chmod(path, mode) {
    Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
}

export function readText(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(bytes);
}

// `private` creates the file 0600, like a credentials file.
export function writeText(path, text, {private: priv = false} = {}) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const flags = priv ? Gio.FileCreateFlags.PRIVATE : Gio.FileCreateFlags.NONE;
    Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode(text), null, false, flags, null);
    return path;
}

// Wraps a test body: `fn` gets `{dir, ...setup(dir)}` for a fresh temp dir,
// removed afterwards.
export function withTempDir(fn, {setup = () => ({})} = {}) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-test-XXXXXX');
        try {
            return fn({dir, ...setup(dir)});
        } finally {
            rmRf(dir);
        }
    };
}

// Like withTempDir, with XDG_CACHE_HOME pointed at the dir for the body's
// duration; `cache` is that vendor's Cache (null without a vendor).
export function withCacheHome(vendor, fn, {setup = () => ({})} = {}) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-test-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            return fn({cache: vendor ? new Cache(vendor) : null, dir, ...setup(dir)});
        } finally {
            if (prev !== null && prev !== undefined)
                GLib.setenv('XDG_CACHE_HOME', prev, true);
            else
                GLib.unsetenv('XDG_CACHE_HOME');
            rmRf(dir);
        }
    };
}

export function isStale(cache) {
    return Gio.File.new_for_path(GLib.build_filenamev([cache.dir, '.stale'])).query_exists(null);
}

export function retryArmed(cache) {
    return Gio.File.new_for_path(GLib.build_filenamev([cache.dir, '.retry_after'])).query_exists(null);
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Unpadded base64url of the UTF-8 bytes of `str`.
export function b64url(str) {
    const bytes = new TextEncoder().encode(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
        out += B64URL[b0 >> 2];
        out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
        if (b1 === undefined)
            break;
        out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
        if (b2 === undefined)
            break;
        out += B64URL[b2 & 63];
    }
    return out;
}

export function fakeJwt(claims) {
    return `${b64url(JSON.stringify({alg: 'none'}))}.${b64url(JSON.stringify(claims))}.sig`;
}

export function backdate(cache, secs) {
    const f = Gio.File.new_for_path(cache.payloadPath);
    f.set_attribute_uint64('time::modified', Math.floor(Date.now() / 1000) - secs, Gio.FileQueryInfoFlags.NONE, null);
    f.set_attribute_uint32('time::modified-usec', 0, Gio.FileQueryInfoFlags.NONE, null);
}

const SCHEMA_ID = 'org.gnome.shell.extensions.ai-usagebar';

// The extension's schema, compiled from this checkout's schemas/ (`make test`
// runs `make schemas` first).
export function extensionSchema() {
    const tests = GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//u, ''));
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([GLib.path_get_dirname(tests), 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
    return source.lookup(SCHEMA_ID, false);
}

// Settings on a memory backend of their own, so nothing reaches the user's
// dconf and each call starts from the defaults; `overrides` maps keys to
// plain values, typed from the schema.
export function testSettings(overrides = {}) {
    const schema = extensionSchema();
    const settings = Gio.Settings.new_full(schema, Gio.memory_settings_backend_new(), null);
    for (const [key, value] of Object.entries(overrides))
        settings.set_value(key, new GLib.Variant(schema.get_key(key).get_value_type().dup_string(), value));
    return settings;
}

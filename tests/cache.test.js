import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache, atomicWrite} from '../lib/cache.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

function runSync(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value, err, done = false;
    Promise.resolve(promise).then(
        v => { value = v; done = true; loop.quit(); },
        e => { err = e; done = true; loop.quit(); }
    );
    if (!done)
        loop.run();
    if (err)
        throw err;
    return value;
}

function rmRf(path) {
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
        const en = f.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
        let child;
        while ((child = en.next_file(null)))
            rmRf(GLib.build_filenamev([path, child.get_name()]));
        en.close(null);
    }
    try {
        f.delete(null);
    } catch (_) { /* best-effort */ }
}

function withTempCache(fn) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-test-XXXXXX');
        const prev = GLib.getenv('XDG_CACHE_HOME');
        GLib.setenv('XDG_CACHE_HOME', dir, true);
        try {
            fn(dir);
        } finally {
            if (prev !== null && prev !== undefined)
                GLib.setenv('XDG_CACHE_HOME', prev, true);
            else
                GLib.unsetenv('XDG_CACHE_HOME');
            rmRf(dir);
        }
    };
}

function bytesToString(u8) {
    return new TextDecoder().decode(u8);
}

function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}

describe('Cache', () => {
    it('payloadAgeMs returns null on empty dir (no throw)', withTempCache(() => {
        const c = Cache.forVendor('test');
        assertEqual(runSync(c.payloadAgeMs()), null);
    }));

    it('writePayload round-trip via maybePayload, path is <xdg>/ai-usagebar/<vendor>/usage.json', withTempCache((dir) => {
        const c = Cache.forVendor('test');
        const data = new TextEncoder().encode('{"x":1}');
        c.writePayload(data);
        const got = runSync(c.maybePayload());
        if (!bytesEqual(got, data))
            throw new Error(`round-trip mismatch: got ${bytesToString(got)}`);
        const expectedPath = GLib.build_filenamev([dir, 'ai-usagebar', 'test', 'usage.json']);
        assertEqual(c.payloadPath, expectedPath);
        assertEqual(Gio.File.new_for_path(expectedPath).query_exists(null), true);
    }));

    it('freshPayload TTL boundary: fresh when age < ttl, null when age >= ttl', withTempCache(() => {
        const c = Cache.forVendor('test');
        c.writePayload('{}');
        // Backdate mtime by 60 seconds so age is deterministic.
        const f = Gio.File.new_for_path(c.payloadPath);
        const past = Math.floor(Date.now() / 1000) - 60;
        f.set_attribute_uint64('time::modified', past, Gio.FileQueryInfoFlags.NONE, null);
        f.set_attribute_uint32('time::modified-usec', 0, Gio.FileQueryInfoFlags.NONE, null);

        const fresh = runSync(c.freshPayload(120_000));
        if (fresh === null)
            throw new Error('freshPayload(120_000) should return bytes when age ≈ 60s');

        assertEqual(runSync(c.freshPayload(30_000)), null, 'freshPayload(30_000) when age ≈ 60s');

        // Self-consistent boundary: age >= ttl returns null.
        const ageNow = runSync(c.payloadAgeMs());
        assertEqual(runSync(c.freshPayload(ageNow)), null, 'freshPayload(age) at the boundary');
        if (runSync(c.freshPayload(ageNow + 5_000)) === null)
            throw new Error('freshPayload(age + 5_000) should return bytes');
    }));

    it('markStale / isStale / writePayload clears .stale', withTempCache(() => {
        const c = Cache.forVendor('test');
        assertEqual(c.isStale(), false);
        c.markStale();
        assertEqual(c.isStale(), true);
        c.writePayload('{}');
        assertEqual(c.isStale(), false);
    }));

    it('writeLastError / readLastError; on-disk format is first-line code + body; writePayload clears .last_error', withTempCache((dir) => {
        const c = Cache.forVendor('test');
        c.writeLastError(429, 'rate limited');
        assertDeepEqual(runSync(c.readLastError()), {code: 429, body: 'rate limited'});

        const errPath = GLib.build_filenamev([dir, 'ai-usagebar', 'test', '.last_error']);
        const [ok, contents] = Gio.File.new_for_path(errPath).load_contents(null);
        assertEqual(ok, true);
        assertEqual(bytesToString(contents), '429\nrate limited');

        c.writePayload('{}');
        assertEqual(runSync(c.readLastError()), null);
    }));

    it('writeNotified / readNotified round-trip; absent → null; writePayload keeps .notified', withTempCache((dir) => {
        const c = Cache.forVendor('test');
        assertEqual(runSync(c.readNotified()), null);

        c.writeNotified({percent: 95, at: 1700000000000, windowKey: '2026-06-08T12:00:00.000Z'});
        assertDeepEqual(runSync(c.readNotified()),
            {percent: 95, at: 1700000000000, windowKey: '2026-06-08T12:00:00.000Z'});

        const path = GLib.build_filenamev([dir, 'ai-usagebar', 'test', '.notified']);
        const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
        assertEqual(ok, true);
        assertEqual(bytesToString(contents), '95\n1700000000000\n2026-06-08T12:00:00.000Z');

        // No percentage / no window key (e.g. DeepSeek) round-trip as null / ''.
        c.writeNotified({percent: null, at: 1700000000000, windowKey: ''});
        assertDeepEqual(runSync(c.readNotified()), {percent: null, at: 1700000000000, windowKey: ''});

        // The debounce state must survive a payload write (unlike .stale/.last_error).
        c.writePayload('{}');
        assertDeepEqual(runSync(c.readNotified()), {percent: null, at: 1700000000000, windowKey: ''});
    }));

    it('atomic write: orphan sibling tempfile leaves usage.json unchanged', withTempCache(() => {
        const c = Cache.forVendor('test');
        c.writePayload('sentinel');
        // Simulate an aborted writePayload — sibling tempfile written but never renamed.
        const orphan = Gio.File.new_for_path(GLib.build_filenamev([c.dir, '.usage.json.tmp-orphan']));
        orphan.replace_contents(
            new TextEncoder().encode('garbage'),
            null,
            false,
            Gio.FileCreateFlags.PRIVATE,
            null
        );
        assertEqual(bytesToString(runSync(c.maybePayload())), 'sentinel');
    }));

    it('readLastError + maybePayload return null on missing cache (no throw)', withTempCache(() => {
        const c = Cache.forVendor('test');
        assertEqual(runSync(c.readLastError()), null);
        assertEqual(runSync(c.maybePayload()), null);
    }));

    it('atomicWrite: round-trip to an arbitrary path', withTempCache((dir) => {
        const targetDir = GLib.build_filenamev([dir, 'aw-target']);
        GLib.mkdir_with_parents(targetDir, 0o700);
        const targetPath = GLib.build_filenamev([targetDir, 'data.bin']);
        const file = Gio.File.new_for_path(targetPath);
        const data = new TextEncoder().encode('hello atomic');
        atomicWrite(file, data);

        const [ok, contents] = file.load_contents(null);
        assertEqual(ok, true);
        assertEqual(bytesToString(contents), 'hello atomic');

        // No tempfile left behind.
        const en = Gio.File.new_for_path(targetDir).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null
        );
        const names = [];
        let child;
        while ((child = en.next_file(null)))
            names.push(child.get_name());
        en.close(null);
        assertDeepEqual(names, ['data.bin']);
    }));
});

system.exit(summary());

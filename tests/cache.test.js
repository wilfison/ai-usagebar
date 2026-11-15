import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {Cache, atomicWrite, isNotFound} from '../lib/cache.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';
import {runSync, withCacheHome} from './_harness.js';

const withTempCache = fn => withCacheHome(null, ({dir}) => fn(dir));

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

    it('writeNotified / readNotified round-trip JSON; absent or old format → empty; writePayload keeps .notified', withTempCache((dir) => {
        const c = Cache.forVendor('test');
        const empty = {version: 2, entries: {}};
        assertDeepEqual(runSync(c.readNotified()), empty);

        const state = {version: 2, entries: {'Claude::session': {notifiedAt: 1700000000000, resetAt: null}}};
        c.writeNotified(state);
        assertDeepEqual(runSync(c.readNotified()), state);

        const path = GLib.build_filenamev([dir, 'ai-usagebar', 'test', '.notified']);
        const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
        assertEqual(ok, true);
        assertDeepEqual(JSON.parse(bytesToString(contents)), state);

        // The dedupe state must survive a payload write (unlike .stale/.last_error).
        c.writePayload('{}');
        assertDeepEqual(runSync(c.readNotified()), state);

        // The three-line format of older releases is discarded.
        Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode('95\n1700000000000\n'),
            null, false, Gio.FileCreateFlags.NONE, null);
        assertDeepEqual(runSync(c.readNotified()), empty);
    }));

    it('atomic write: orphan sibling tempfile leaves usage.json unchanged', withTempCache(() => {
        const c = Cache.forVendor('test');
        c.writePayload('sentinel');
        // Simulate an aborted writePayload: sibling tempfile written but never renamed.
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

describe('Cache retry_after sidecar', () => {
    it('round-trips an epoch-seconds marker as ms', withTempCache(() => {
        const c = Cache.forVendor('rt');
        assertEqual(runSync(c.readRetryAfter()), null);
        c.writeRetryAfter(1_800_000_000_500);
        assertEqual(runSync(c.readRetryAfter()), 1_800_000_001_000);
        c.clearRetryAfter();
        assertEqual(runSync(c.readRetryAfter()), null);
    }));

    it('a corrupt marker reads as no backoff', withTempCache((dir) => {
        const c = Cache.forVendor('rt');
        c.ensureDir();
        Gio.File.new_for_path(GLib.build_filenamev([dir, 'ai-usagebar', 'rt', '.retry_after'])).replace_contents(
            new TextEncoder().encode('soon'), null, false, Gio.FileCreateFlags.NONE, null);
        assertEqual(runSync(c.readRetryAfter()), null);
    }));

    it('writeLastError(429) arms it; other codes do not', withTempCache(() => {
        const c = Cache.forVendor('rt');
        c.writeLastError(500, 'down');
        assertEqual(runSync(c.readRetryAfter()), null);
        const before = Date.now();
        c.writeLastError(429, 'slow down');
        const until = runSync(c.readRetryAfter());
        assertEqual(until >= before + 5 * 60 * 1000 && until <= Date.now() + 5 * 60 * 1000 + 1000, true);
    }));

    it('writePayload and clearLastError clear it', withTempCache(() => {
        const c = Cache.forVendor('rt');
        c.writeLastError(429, 'x');
        c.writePayload('{}');
        assertEqual(runSync(c.readRetryAfter()), null);
        c.writeLastError(429, 'x');
        c.clearLastError();
        assertEqual(runSync(c.readRetryAfter()), null);
        assertEqual(runSync(c.readLastError()), null);
    }));
});

describe('isNotFound', () => {
    it('matches a Gio NOT_FOUND error only', () => {
        assertEqual(isNotFound(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND, 'gone')), true);
        assertEqual(isNotFound(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED, 'no')), false);
        assertEqual(isNotFound(new Error('plain')), false);
        assertEqual(isNotFound(null), false);
    });
});

system.exit(summary());

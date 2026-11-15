import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {writeActiveVendorMirror, pendingMirrorWrites} from '../lib/active-vendor.js';
import {describe, it, assertEqual, summary} from './_assert.js';
import {runSync, withCacheHome} from './_harness.js';

const withTempCache = fn => withCacheHome(null, ({dir}) => fn(dir));

function bytesToString(u8) {
    return new TextDecoder().decode(u8);
}

describe('writeActiveVendorMirror', () => {
    it('writes <id>\\n when the cache root exists', withTempCache((dir) => {
        const root = GLib.build_filenamev([dir, 'ai-usagebar']);
        GLib.mkdir_with_parents(root, 0o700);

        runSync(writeActiveVendorMirror('zai'));

        const mirror = Gio.File.new_for_path(GLib.build_filenamev([root, 'active_vendor']));
        assertEqual(mirror.query_exists(null), true, 'mirror file should exist');
        const [ok, contents] = mirror.load_contents(null);
        assertEqual(ok, true);
        assertEqual(bytesToString(contents), 'zai\n');
    }));

    it('does not create the file (and does not throw) when the cache root is absent', withTempCache((dir) => {
        const root = GLib.build_filenamev([dir, 'ai-usagebar']);

        runSync(writeActiveVendorMirror('openrouter'));

        assertEqual(Gio.File.new_for_path(root).query_exists(null), false, 'cache root must not be created');
        const mirror = Gio.File.new_for_path(GLib.build_filenamev([root, 'active_vendor']));
        assertEqual(mirror.query_exists(null), false, 'mirror file must not be created');
    }));
});

describe('writeActiveVendorMirror: overlapping writes', () => {
    it('the last call wins, and the ones it overtook are skipped', withTempCache((dir) => {
        const root = GLib.build_filenamev([dir, 'ai-usagebar']);
        GLib.mkdir_with_parents(root, 0o700);
        const ids = ['openai', 'zai', 'kimi', 'deepseek', 'anthropic'];
        const writes = ids.map(id => writeActiveVendorMirror(id));
        runSync(Promise.all(writes));
        const [, contents] = Gio.File.new_for_path(GLib.build_filenamev([root, 'active_vendor'])).load_contents(null);
        assertEqual(bytesToString(contents), 'anthropic\n');
        assertEqual(pendingMirrorWrites(), 0);
    }));
});

system.exit(summary());

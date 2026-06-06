import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {describe, it, assertEqual, summary} from './_assert.js';

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

describe('writeActiveVendorMirror', () => {
    it('writes <id>\\n when the cache root exists', withTempCache((dir) => {
        const root = GLib.build_filenamev([dir, 'ai-usagebar']);
        GLib.mkdir_with_parents(root, 0o700);

        writeActiveVendorMirror('zai');

        const mirror = Gio.File.new_for_path(GLib.build_filenamev([root, 'active_vendor']));
        assertEqual(mirror.query_exists(null), true, 'mirror file should exist');
        const [ok, contents] = mirror.load_contents(null);
        assertEqual(ok, true);
        assertEqual(bytesToString(contents), 'zai\n');
    }));

    it('does not create the file (and does not throw) when the cache root is absent', withTempCache((dir) => {
        const root = GLib.build_filenamev([dir, 'ai-usagebar']);

        writeActiveVendorMirror('openrouter');

        assertEqual(Gio.File.new_for_path(root).query_exists(null), false, 'cache root must not be created');
        const mirror = Gio.File.new_for_path(GLib.build_filenamev([root, 'active_vendor']));
        assertEqual(mirror.query_exists(null), false, 'mirror file must not be created');
    }));
});

system.exit(summary());

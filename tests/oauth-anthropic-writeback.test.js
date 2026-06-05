import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {writeBack, readCreds} from '../lib/oauth/anthropic.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from './_assert.js';

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
        // Restore directory writable so we can delete its children if a test chmodded it.
        try { f.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null); } catch (_) { /* best-effort */ }
        const en = f.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let child;
        while ((child = en.next_file(null)))
            rmRf(GLib.build_filenamev([path, child.get_name()]));
        en.close(null);
    }
    try { f.delete(null); } catch (_) { /* best-effort */ }
}

function withTempDir(fn) {
    return () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-wb-XXXXXX');
        const path = GLib.build_filenamev([dir, '.credentials.json']);
        try {
            fn({dir, path});
        } finally {
            rmRf(dir);
        }
    };
}

function writeText(path, text) {
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(text),
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        null
    );
}

function readText(path) {
    const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok)
        throw new Error(`failed to read ${path}`);
    return new TextDecoder().decode(contents);
}

const baseOauth = {
    accessToken: 'NEW',
    refreshToken: 'NEW-RT',
    expiresAtMs: 1735000000000,
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_5x',
    scopes: null,
};

describe('writeBack', () => {
    it('preserves unknown top-level fields through a round-trip', withTempDir(({path}) => {
        writeText(path, JSON.stringify({
            claudeAiOauth: {
                accessToken: 'OLD', refreshToken: 'OLD-RT',
                expiresAt: 1, subscriptionType: 'max', rateLimitTier: '',
            },
            someOtherField: 'keep me',
            mcpOAuth: {x: 1},
        }));

        const result = writeBack(path, {...baseOauth, expiresAtMs: 999});
        assertEqual(result.ok, true);

        const round = JSON.parse(readText(path));
        assertEqual(round.someOtherField, 'keep me');
        assertEqual(round.mcpOAuth.x, 1);
        assertEqual(round.claudeAiOauth.accessToken, 'NEW');
        assertEqual(round.claudeAiOauth.expiresAt, 999);
    }));

    it('missing file is OK — creates with just claudeAiOauth', withTempDir(({path}) => {
        // path is in a fresh tmpdir; no file there.
        const result = writeBack(path, baseOauth);
        assertEqual(result.ok, true);
        const {oauth, raw} = readCreds(path);
        assertEqual(oauth.accessToken, 'NEW');
        assertDeepEqual(Object.keys(raw), ['claudeAiOauth']);
    }));

    it('garbage existing file is OK — overwritten with fresh object', withTempDir(({path}) => {
        writeText(path, 'not json');
        const result = writeBack(path, baseOauth);
        assertEqual(result.ok, true);
        const round = JSON.parse(readText(path));
        assertEqual(round.claudeAiOauth.accessToken, 'NEW');
        assertDeepEqual(Object.keys(round), ['claudeAiOauth']);
    }));

    it('array-shaped existing file is OK — overwritten with fresh object', withTempDir(({path}) => {
        writeText(path, '[1,2,3]');
        const result = writeBack(path, baseOauth);
        assertEqual(result.ok, true);
        const round = JSON.parse(readText(path));
        assertDeepEqual(Object.keys(round), ['claudeAiOauth']);
    }));

    it('scopes round-trip: non-null persists, null omits the key', withTempDir(({path}) => {
        writeBack(path, {...baseOauth, scopes: ['user:inference']});
        let round = JSON.parse(readText(path));
        assertDeepEqual(round.claudeAiOauth.scopes, ['user:inference']);

        writeBack(path, {...baseOauth, scopes: null});
        round = JSON.parse(readText(path));
        assertEqual('scopes' in round.claudeAiOauth, false);
    }));

    it('atomic: no leftover tempfile on success', withTempDir(({dir, path}) => {
        writeBack(path, baseOauth);
        const en = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null
        );
        let leftover = false;
        let child;
        while ((child = en.next_file(null))) {
            const name = child.get_name();
            if (name.includes('.tmp-'))
                leftover = true;
        }
        en.close(null);
        assertEqual(leftover, false);
    }));

    it('permission denied returns failure, does not throw, file unchanged', withTempDir(({dir, path}) => {
        writeText(path, JSON.stringify({claudeAiOauth: {
            accessToken: 'OLD', refreshToken: 'OLD-RT',
            expiresAt: 1, subscriptionType: 'max', rateLimitTier: '',
        }}));
        const original = readText(path);

        // 0o500 — readable + executable but not writable, so tempfile creation fails.
        const dirFile = Gio.File.new_for_path(dir);
        dirFile.set_attribute_uint32('unix::mode', 0o500, Gio.FileQueryInfoFlags.NONE, null);
        try {
            const result = writeBack(path, baseOauth);
            assertEqual(result.ok, false);
            assertEqual(result.kind, 'io');
            if (!result.message || result.message.length === 0)
                throw new Error('expected non-empty error message');
            assertEqual(readText(path), original);
        } finally {
            dirFile.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
        }
    }));

    it('output is pretty-printed (2-space indent)', withTempDir(({path}) => {
        writeBack(path, baseOauth);
        const raw = readText(path);
        if (!raw.includes('\n  "claudeAiOauth"'))
            throw new Error(`expected 2-space indent before claudeAiOauth; got:\n${raw}`);
    }));

    it('concurrent writes settle to exactly one of the two complete documents', withTempDir(({path}) => {
        const a = {...baseOauth, accessToken: 'A'};
        const b = {...baseOauth, accessToken: 'B'};
        const loop = GLib.MainLoop.new(null, false);
        Promise.all([
            Promise.resolve().then(() => writeBack(path, a)),
            Promise.resolve().then(() => writeBack(path, b)),
        ]).then(() => loop.quit());
        loop.run();
        const round = JSON.parse(readText(path));
        if (round.claudeAiOauth.accessToken !== 'A' && round.claudeAiOauth.accessToken !== 'B')
            throw new Error(`expected A or B; got ${round.claudeAiOauth.accessToken}`);
    }));
});

system.exit(summary());

import GLib from 'gi://GLib';
import system from 'system';

import {readJsonCredentials, updateJsonCredentials} from '../../../lib/oauth/creds-file.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';
import {runSync, readText, writeText, withTempDir as withTempDirIn} from '../../_harness.js';

const withTempDir = fn => withTempDirIn(fn, {setup: dir => ({path: GLib.build_filenamev([dir, 'creds.json'])})});

function readError(path) {
    try {
        runSync(readJsonCredentials(path, 'login-cmd'));
    } catch (e) {
        return e;
    }
    throw new Error('expected a throw');
}

describe('readJsonCredentials', () => {
    it('answers the top-level object', withTempDir(({path}) => {
        writeText(path, '{"a":{"b":1}}');
        assertDeepEqual(runSync(readJsonCredentials(path, 'login-cmd')), {a: {b: 1}});
    }));
    it('a missing file is ENOENT with the login hint', withTempDir(({path}) => {
        const e = readError(path);
        assertEqual(e.code, 'ENOENT');
        assertEqual(e.message, `credentials file not found at ${path}. Run \`login-cmd\` to re-authenticate.`);
    }));
    it('invalid JSON names the file and the hint', withTempDir(({path}) => {
        writeText(path, '{');
        const e = readError(path);
        assertEqual(e.message.startsWith(`could not parse ${path}: `), true);
        assertEqual(e.message.endsWith('Run `login-cmd` to re-authenticate.'), true);
    }));
    it('a non-object top level is refused', withTempDir(({path}) => {
        writeText(path, '[1]');
        assertEqual(readError(path).message, `could not parse ${path}: top-level value is not an object. Run \`login-cmd\` to re-authenticate.`);
    }));
});

describe('updateJsonCredentials', () => {
    it('merges into the file as it is on disk now, pretty-printed', withTempDir(({path}) => {
        writeText(path, '{"keep":"me","tokens":{"a":"old"}}');
        const r = runSync(updateJsonCredentials(path, doc => ({...doc, tokens: {...doc.tokens, a: 'new'}})));
        assertEqual(r.ok, true);
        assertDeepEqual(JSON.parse(readText(path)), {keep: 'me', tokens: {a: 'new'}});
        assertEqual(readText(path).includes('\n  "keep"'), true);
    }));
    it('an unreadable or absent file merges into an empty object', withTempDir(({path}) => {
        assertEqual(runSync(updateJsonCredentials(path, doc => ({...doc, x: 1}))).ok, true);
        assertDeepEqual(JSON.parse(readText(path)), {x: 1});
        writeText(path, 'not json');
        runSync(updateJsonCredentials(path, doc => ({...doc, y: 2})));
        assertDeepEqual(JSON.parse(readText(path)), {y: 2});
    }));
    it('a write failure is kind io, never a throw', withTempDir(({dir}) => {
        const r = runSync(updateJsonCredentials(GLib.build_filenamev([dir, 'missing', 'c.json']), doc => doc));
        assertEqual(r.ok, false);
        assertEqual(r.kind, 'io');
    }));
    it('a failing update is kind io too', withTempDir(({path}) => {
        const r = runSync(updateJsonCredentials(path, () => {
            throw new Error('boom');
        }));
        assertEqual(r.kind, 'io');
        assertEqual(r.message, 'merge failed: boom');
    }));
});

system.exit(summary());

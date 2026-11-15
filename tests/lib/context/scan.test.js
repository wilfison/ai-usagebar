import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import system from 'system';

import {scanSessions} from '../../../lib/context/scan.js';
import {describe, it, assertEqual, summary} from '../../_assert.js';
import {runSync, writeText, withTempDir} from '../../_harness.js';

const LINE = JSON.stringify({type: 'assistant', sessionId: 's1', message: {model: 'claude-opus-5', usage: {input_tokens: 10}}});

function cancelledError(fn) {
    try {
        runSync(fn());
    } catch (e) {
        return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) === true;
    }
    return false;
}

describe('scanSessions', () => {
    it('reads the transcripts under the root', withTempDir(({dir}) => {
        writeText(GLib.build_filenamev([dir, 'proj', 's1.jsonl']), `${LINE}\n`);
        const r = runSync(scanSessions({root: dir, modelWindows: {}, defaultWindow: null}));
        assertEqual(r.error, null);
        assertEqual(r.discovered, 1);
        assertEqual(r.sessions.length, 1);
    }));

    it('a missing root is reported, not thrown', withTempDir(({dir}) => {
        const r = runSync(scanSessions({root: GLib.build_filenamev([dir, 'nope']), modelWindows: {}, defaultWindow: null}));
        assertEqual(r.sessions.length, 0);
        assertEqual(r.error.startsWith('cannot read '), true);
    }));

    it('a cancelled scan rejects with CANCELLED, never reports an unreadable root', withTempDir(({dir}) => {
        writeText(GLib.build_filenamev([dir, 'proj', 's1.jsonl']), `${LINE}\n`);
        const cancellable = new Gio.Cancellable();
        cancellable.cancel();
        assertEqual(cancelledError(() => scanSessions({root: dir, modelWindows: {}, defaultWindow: null, cancellable})), true);
    }));
});

system.exit(summary());

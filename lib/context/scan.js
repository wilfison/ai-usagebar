import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseSessionTail, recentFirst, SHOWN_SESSIONS} from './parser.js';

const MAX_WALK_ENTRIES = 10_000;
const MAX_TAIL_BYTES = 2 * 1024 * 1024;
const BATCH = 100;
const ATTRS = 'standard::name,standard::type,standard::is-symlink,standard::size,time::modified,time::modified-usec';

export function defaultProjectsPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'projects']);
}

function call(obj, method, ...args) {
    return new Promise((resolve, reject) => {
        obj[`${method}_async`](...args, (o, res) => {
            try {
                resolve(o[`${method}_finish`](res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function isCancelled(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) === true;
}

function mtimeMs(info) {
    return info.get_attribute_uint64('time::modified') * 1000 +
        Math.floor(info.get_attribute_uint32('time::modified-usec') / 1000);
}

// Every *.jsonl under `root`, skipping subagent transcripts and never
// following a symlink; the walk stops after MAX_WALK_ENTRIES entries.
async function discover(root, cancellable) {
    const candidates = [];
    const pending = [{dir: Gio.File.new_for_path(root), project: null}];
    let seen = 0;
    while (pending.length > 0 && seen < MAX_WALK_ENTRIES) {
        const {dir, project} = pending.pop();
        let en;
        try {
            en = await call(dir, 'enumerate_children', ATTRS, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, cancellable);
        } catch (e) {
            if (project === null || isCancelled(e))
                throw e;
            continue;
        }
        try {
            for (;;) {
                const infos = await call(en, 'next_files', BATCH, GLib.PRIORITY_LOW, cancellable);
                if (infos.length === 0)
                    break;
                for (const info of infos) {
                    if (++seen > MAX_WALK_ENTRIES)
                        break;
                    if (info.get_is_symlink())
                        continue;
                    const name = info.get_name();
                    const child = dir.get_child(name);
                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        if (name !== 'subagents')
                            pending.push({dir: child, project: project ?? name});
                    } else if (info.get_file_type() === Gio.FileType.REGULAR && name.endsWith('.jsonl')) {
                        candidates.push({path: child.get_path(), mtime: mtimeMs(info), size: info.get_size(), project});
                    }
                }
            }
        } finally {
            en.close_async(GLib.PRIORITY_LOW, null, null);
        }
    }
    return candidates;
}

// The last MAX_TAIL_BYTES of a transcript, and whether it starts mid-file.
async function readTail(path, size, cancellable) {
    const stream = await call(Gio.File.new_for_path(path), 'read', GLib.PRIORITY_LOW, cancellable);
    try {
        const start = Math.max(0, size - MAX_TAIL_BYTES);
        if (start > 0)
            stream.seek(start, GLib.SeekType.SET, cancellable);
        const chunks = [];
        let total = 0;
        while (total < MAX_TAIL_BYTES) {
            const bytes = await call(stream, 'read_bytes', MAX_TAIL_BYTES - total, GLib.PRIORITY_LOW, cancellable);
            const data = bytes.get_data() ?? new Uint8Array(0);
            if (data.length === 0)
                break;
            chunks.push(data);
            total += data.length;
        }
        const all = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
            all.set(c, at);
            at += c.length;
        }
        return {text: new TextDecoder().decode(all), fromMiddle: start > 0};
    } finally {
        stream.close_async(GLib.PRIORITY_LOW, null, null);
    }
}

// Recent Claude Code sessions, newest first. Only the SHOWN_SESSIONS most
// recent tails are read: reading all of them would cost the Shell up to
// 200 MiB per refresh. Only a cancellation rejects (CANCELLED); a missing
// root is reported as `error` and an unreadable transcript is skipped.
export async function scanSessions({root, modelWindows, defaultWindow, cancellable = null}) {
    const started = GLib.get_monotonic_time();
    const dir = root || defaultProjectsPath();
    let candidates;
    try {
        candidates = recentFirst(await discover(dir, cancellable));
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return {sessions: [], discovered: 0, error: `cannot read ${dir}: ${e?.message ?? e}`};
    }

    const sessions = [];
    for (const c of candidates.slice(0, SHOWN_SESSIONS)) {
        try {
            const {text, fromMiddle} = await readTail(c.path, c.size, cancellable);
            const fileStem = GLib.path_get_basename(c.path).replace(/\.jsonl$/u, '');
            sessions.push(parseSessionTail(text, {
                mtime: new Date(c.mtime), fileStem, projectDir: c.project, modelWindows, defaultWindow, fromMiddle,
            }));
        } catch (e) {
            if (isCancelled(e))
                throw e;
        }
    }
    const ms = Math.round((GLib.get_monotonic_time() - started) / 1000);
    console.debug(`ai-usagebar: context scan: ${candidates.length} transcripts, ${sessions.length} read, ${ms} ms`);
    return {sessions, discovered: candidates.length, error: null};
}

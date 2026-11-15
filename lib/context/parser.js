import {sanitizeUntrusted, vformat} from '../format.js';

export const MAX_LINE_CHARS = 512 * 1024;
export const MAX_DISPLAY_CHARS = 120;
export const MAX_SESSIONS = 100;
export const SHOWN_SESSIONS = 8;

// Transcript text is untrusted: controls stripped, newlines flattened, capped.
export function cleanDisplay(s) {
    return sanitizeUntrusted(String(s), MAX_DISPLAY_CHARS).replace(/\s+/gu, ' ').trim();
}

function capture(record, key) {
    const v = record[key];
    if (typeof v !== 'string')
        return null;
    const clean = cleanDisplay(v);
    return clean === '' ? null : clean;
}

function count(v) {
    return Number.isSafeInteger(v) && v >= 0 ? v : null;
}

// Claude Code's own context figure: fresh input plus both cache counts of the
// latest response. `input_tokens` is required; an absent or null cache count
// is 0, but a malformed one makes the whole reading unusable.
function inputTokens(record) {
    const usage = record.message?.usage;
    if (usage === null || typeof usage !== 'object')
        return null;
    const input = count(usage.input_tokens);
    if (input === null)
        return null;
    let total = input;
    for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
        const v = usage[key];
        if (v === undefined || v === null)
            continue;
        const n = count(v);
        if (n === null)
            return null;
        total += n;
    }
    return total;
}

function lastSegment(path) {
    const segs = String(path).split('/').filter(s => s !== '');
    return segs.length ? cleanDisplay(segs[segs.length - 1]) || null : null;
}

// One transcript tail → one session. `fromMiddle` means the tail starts
// mid-file, so its first line is a fragment and is dropped. The last
// activity is the file's mtime, never a timestamp inside a line.
export function parseSessionTail(text, {mtime, fileStem, projectDir = null, modelWindows = {}, defaultWindow = null, fromMiddle = false}) {
    const lines = String(text).split('\n');
    if (fromMiddle)
        lines.shift();

    let sessionId = null, cwd = null, title = null, model = null;
    let usage = {state: 'unknown'};
    let skipped = 0;
    for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '')
            continue;
        if (line.length > MAX_LINE_CHARS) {
            skipped++;
            continue;
        }
        let record;
        try {
            record = JSON.parse(line);
        } catch (_e) {
            skipped++;
            continue;
        }
        if (record === null || typeof record !== 'object' || Array.isArray(record))
            continue;

        sessionId = capture(record, 'sessionId') ?? sessionId;
        cwd = capture(record, 'cwd') ?? cwd;
        if (record.type === 'custom-title') {
            title = capture(record, 'customTitle') ?? title;
            title = capture(record, 'title') ?? title;
        } else if (record.type === 'assistant') {
            if (typeof record.message?.model === 'string')
                model = cleanDisplay(record.message.model) || model;
            const tokens = inputTokens(record);
            if (tokens !== null)
                usage = {state: 'tokens', inputTokens: tokens};
        } else if (record.type === 'system' && record.subtype === 'compact_boundary') {
            usage = {state: 'compacted'};
        }
    }

    if (usage.state === 'tokens') {
        const windowTokens = windowFor(model, modelWindows, defaultWindow);
        usage.windowTokens = windowTokens;
        usage.percent = windowTokens === null ? null : Math.floor((usage.inputTokens * 100) / windowTokens);
    }

    return {
        sessionId: sessionId ?? cleanDisplay(fileStem),
        title,
        project: (cwd && lastSegment(cwd)) ?? (projectDir && cleanDisplay(projectDir)) ?? null,
        model,
        lastActive: mtime,
        usage,
        skipped,
    };
}

function windowFor(model, modelWindows, defaultWindow) {
    const configured = model !== null ? modelWindows[model] : undefined;
    if (Number.isSafeInteger(configured) && configured > 0)
        return configured;
    return Number.isSafeInteger(defaultWindow) && defaultWindow > 0 ? defaultWindow : null;
}

// The context-model-windows pref: a JSON object of model → token count.
// Empty keys and non-positive or non-integer counts are dropped.
export function parseModelWindows(text) {
    let obj;
    try {
        obj = JSON.parse(String(text ?? ''));
    } catch (_e) {
        return {};
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        return {};
    const out = {};
    for (const [model, tokens] of Object.entries(obj)) {
        if (model.trim() !== '' && Number.isSafeInteger(tokens) && tokens > 0)
            out[model] = tokens;
    }
    return out;
}

// What parseModelWindows would drop, as messages for the preferences; an
// empty list means the text is kept whole. Empty text is valid (no windows).
export function validateModelWindows(text, _ = s => s) {
    if (String(text ?? '').trim() === '')
        return [];
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        return [vformat(_('Not valid JSON: %s'), e.message)];
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        return [_('Not a JSON object of model names to token counts.')];
    const problems = [];
    for (const [model, tokens] of Object.entries(obj)) {
        if (model.trim() === '')
            problems.push(_('A model name cannot be empty.'));
        else if (!(Number.isSafeInteger(tokens) && tokens > 0))
            // Translators: %s is a model name, e.g. claude-opus-5.
            problems.push(vformat(_('%s: the token count must be a whole number above 0.'), model));
    }
    return problems;
}

// Newest first, ties broken by path so the order is stable; capped at `keep`.
export function recentFirst(candidates, keep = MAX_SESSIONS) {
    return [...candidates]
        .sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .slice(0, keep);
}

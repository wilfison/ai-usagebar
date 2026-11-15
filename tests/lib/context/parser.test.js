import system from 'system';

import {
    parseSessionTail, parseModelWindows, validateModelWindows, recentFirst, cleanDisplay, MAX_LINE_CHARS, MAX_DISPLAY_CHARS,
} from '../../../lib/context/parser.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../../_assert.js';

const MTIME = new Date('2026-09-29T14:03:12Z');
const j = o => JSON.stringify(o);

function assistant(input, {create = 0, read = 0, model = 'claude-opus-5', session = 's-1', cwd = '/home/u/Projects/ai-usagebar'} = {}) {
    return j({type: 'assistant', sessionId: session, cwd,
        message: {model, usage: {input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: read}}});
}
const compact = j({type: 'system', subtype: 'compact_boundary'});
const user = j({type: 'user', sessionId: 's-1', cwd: '/home/u/Projects/ai-usagebar', message: {content: 'hi'}});

function parse(lines, opts = {}) {
    return parseSessionTail(lines.join('\n'), {mtime: MTIME, fileStem: 'file-stem', modelWindows: {'claude-opus-5': 200000}, ...opts});
}

describe('parseSessionTail: a normal session', () => {
    const s = parse([user, assistant(1000, {create: 500, read: 48500}), j({type: 'custom-title', customTitle: 'release prep'})]);

    it('reads the id, project, title and model', () => {
        assertEqual(s.sessionId, 's-1');
        assertEqual(s.project, 'ai-usagebar');
        assertEqual(s.title, 'release prep');
        assertEqual(s.model, 'claude-opus-5');
    });

    it('input + both cache counts of the latest response, over the model window', () => {
        assertDeepEqual(s.usage, {state: 'tokens', inputTokens: 50000, windowTokens: 200000, percent: 25});
    });

    it('last activity is the file mtime', () => assertEqual(s.lastActive, MTIME));

    it('the latest usable response wins', () => {
        assertEqual(parse([assistant(10), assistant(30)]).usage.inputTokens, 30);
    });

    it('percent is floored and not capped here', () => {
        assertEqual(parse([assistant(1999)], {modelWindows: {'claude-opus-5': 1000}}).usage.percent, 199);
        assertEqual(parse([assistant(1)], {modelWindows: {'claude-opus-5': 3}}).usage.percent, 33);
    });

    it('absent or null cache counts are 0', () => {
        const line = j({type: 'assistant', message: {model: 'claude-opus-5', usage: {input_tokens: 7, cache_read_input_tokens: null}}});
        assertEqual(parse([line]).usage.inputTokens, 7);
    });

    it('a title field overrides customTitle', () => {
        assertEqual(parse([j({type: 'custom-title', customTitle: 'a', title: 'b'})]).title, 'b');
    });
});

describe('parseSessionTail: compacted and unknown', () => {
    it('a compact boundary after the last usage → compacted', () => {
        assertDeepEqual(parse([assistant(90000), compact]).usage, {state: 'compacted'});
    });

    it('a response after the compaction supplies the new reading', () => {
        assertEqual(parse([assistant(90000), compact, assistant(12)]).usage.inputTokens, 12);
    });

    it('no assistant record → unknown', () => {
        assertDeepEqual(parse([user]).usage, {state: 'unknown'});
    });

    it('a malformed usage number is unknown, not zero', () => {
        const bad = j({type: 'assistant', message: {usage: {input_tokens: '12'}}});
        assertDeepEqual(parse([bad]).usage, {state: 'unknown'});
        const badCache = j({type: 'assistant', message: {usage: {input_tokens: 12, cache_read_input_tokens: -1}}});
        assertDeepEqual(parse([badCache]).usage, {state: 'unknown'});
    });
});

describe('parseSessionTail: windows', () => {
    it('an unknown model with no default shows raw tokens, never a %', () => {
        const s = parse([assistant(5000, {model: 'mystery-model'})]);
        assertEqual(s.usage.windowTokens, null);
        assertEqual(s.usage.percent, null);
        assertEqual(s.usage.inputTokens, 5000);
    });

    it('an unknown model falls back to the default window', () => {
        assertEqual(parse([assistant(5000, {model: 'mystery-model'})], {defaultWindow: 10000}).usage.percent, 50);
    });

    it('no model at all uses the default window', () => {
        const line = j({type: 'assistant', message: {usage: {input_tokens: 10}}});
        const s = parse([line], {defaultWindow: 100});
        assertEqual(s.model, null);
        assertEqual(s.usage.percent, 10);
    });
});

describe('parseSessionTail: tolerance', () => {
    it('an invalid line in the middle is skipped, not fatal', () => {
        const s = parse([assistant(42), '{"type":"assistant", broken', user]);
        assertEqual(s.usage.inputTokens, 42);
        assertEqual(s.skipped, 1);
    });

    it('a tail read mid-file drops its partial first line', () => {
        const text = ['":0}}}', assistant(42)].join('\n');
        const s = parseSessionTail(text, {mtime: MTIME, fileStem: 'x', fromMiddle: true});
        assertEqual(s.skipped, 0);
        assertEqual(s.usage.inputTokens, 42);
    });

    it('from the start of the file the first line is kept', () => {
        const s = parseSessionTail(assistant(42), {mtime: MTIME, fileStem: 'x'});
        assertEqual(s.usage.inputTokens, 42);
    });

    it('an oversized line is skipped', () => {
        const huge = j({type: 'user', pad: 'x'.repeat(MAX_LINE_CHARS)});
        const s = parse([assistant(42), huge]);
        assertEqual(s.skipped, 1);
        assertEqual(s.usage.inputTokens, 42);
    });

    it('CRLF line endings', () => {
        assertEqual(parseSessionTail(`${assistant(42)}\r\n`, {mtime: MTIME, fileStem: 'x'}).usage.inputTokens, 42);
    });

    it('falls back to the file stem and the project directory', () => {
        const line = j({type: 'assistant', message: {usage: {input_tokens: 1}}});
        const s = parse([line], {projectDir: '-home-u-Projects-foo'});
        assertEqual(s.sessionId, 'file-stem');
        assertEqual(s.project, '-home-u-Projects-foo');
        assertEqual(parse([line]).project, null);
    });

    it('titles and paths are sanitized and capped', () => {
        const s = parse([
            j({type: 'custom-title', customTitle: 'build\u001b[2J\nrelease'}),
            j({type: 'user', cwd: `/p/${'y'.repeat(300)}`}),
        ]);
        assertEqual(s.title, 'build[2J release');
        assertEqual(s.project.length <= MAX_DISPLAY_CHARS, true);
        assertEqual(/^y+$/u.test(s.project), true);
    });
});

describe('cleanDisplay', () => {
    it('flattens whitespace, strips controls, trims', () => assertEqual(cleanDisplay('  a\t\n b\u0007 '), 'a b'));
});

describe('parseModelWindows', () => {
    it('keeps positive integer windows with non-empty names', () =>
        assertDeepEqual(parseModelWindows('{"a": 200000, "": 5, "b": 0, "c": -1, "d": 1.5, "e": "9"}'), {a: 200000}));
    it('empty or invalid JSON → {}', () => {
        assertDeepEqual(parseModelWindows(''), {});
        assertDeepEqual(parseModelWindows('{'), {});
        assertDeepEqual(parseModelWindows('[1]'), {});
    });
});

describe('recentFirst', () => {
    it('newest first, ties by path, capped', () => {
        const c = [{path: 'b', mtime: 1}, {path: 'a', mtime: 1}, {path: 'z', mtime: 5}, {path: 'y', mtime: 3}];
        assertDeepEqual(recentFirst(c).map(x => x.path), ['z', 'y', 'a', 'b']);
        assertDeepEqual(recentFirst(c, 2).map(x => x.path), ['z', 'y']);
    });
});

describe('validateModelWindows', () => {
    const bracket = s => `[${s}]`;
    it('empty and a valid object have no problem', () => {
        assertDeepEqual(validateModelWindows(''), []);
        assertDeepEqual(validateModelWindows('{"claude-opus-5": 1000000}'), []);
    });
    it('names each entry parseModelWindows would drop', () =>
        assertDeepEqual(validateModelWindows('{"a": 0, "": 5, "b": 1.5, "c": "9"}', bracket), [
            '[%s: the token count must be a whole number above 0.]'.replace('%s', 'a'),
            '[A model name cannot be empty.]',
            '[%s: the token count must be a whole number above 0.]'.replace('%s', 'b'),
            '[%s: the token count must be a whole number above 0.]'.replace('%s', 'c'),
        ]));
    it('invalid JSON and a non-object are one problem each', () => {
        assertEqual(validateModelWindows('{', bracket)[0].startsWith('[Not valid JSON: '), true);
        assertDeepEqual(validateModelWindows('[1]', bracket), ['[Not a JSON object of model names to token counts.]']);
    });
});

system.exit(summary());

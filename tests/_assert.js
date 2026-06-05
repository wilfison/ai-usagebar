// Minimal assertion + grouping helpers. US-009 will flesh this out into
// the full runner; for US-003 we only need enough to drive cache tests.

import GLib from 'gi://GLib';

let _passes = 0;
let _failures = 0;
let _describe = '';

const _useColor = !GLib.getenv('NO_COLOR');
const C = {
    green: _useColor ? '\x1b[32m' : '',
    red: _useColor ? '\x1b[31m' : '',
    dim: _useColor ? '\x1b[2m' : '',
    reset: _useColor ? '\x1b[0m' : '',
};

export function describe(name, fn) {
    const prev = _describe;
    _describe = prev ? `${prev} > ${name}` : name;
    try {
        fn();
    } finally {
        _describe = prev;
    }
}

export function it(name, fn) {
    const fullName = _describe ? `${_describe} > ${name}` : name;
    try {
        fn();
        _passes++;
        print(`${C.green}PASS${C.reset} ${C.dim}${fullName}${C.reset}`);
    } catch (e) {
        _failures++;
        print(`${C.red}FAIL${C.reset} ${fullName}`);
        print(`  ${e.message ?? e}`);
        if (e?.stack)
            print(`  ${e.stack.split('\n').slice(0, 4).join('\n  ')}`);
    }
}

export function assertEqual(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`${msg ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertDeepEqual(actual, expected, msg) {
    const sa = JSON.stringify(actual);
    const sb = JSON.stringify(expected);
    if (sa !== sb)
        throw new Error(`${msg ?? 'assertDeepEqual'}: expected ${sb}, got ${sa}`);
}

export function assertThrows(fn, msg) {
    try {
        fn();
    } catch (_) {
        return;
    }
    throw new Error(`${msg ?? 'assertThrows'}: expected throw`);
}

export function summary() {
    print(`\n${_passes} passed, ${_failures} failed`);
    return _failures === 0 ? 0 : 1;
}

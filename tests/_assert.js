/**
 * @file Minimal `describe`/`it`/`assert*` helpers used by every `*.test.js`
 * under `tests/`. Subprocess-isolated by `tests/run.js`, so the module-level
 * counters reset implicitly between files.
 */

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

/**
 * Group a block of `it` calls under a shared name. Nests via ` > `.
 * @param {string} name
 * @param {() => void} fn
 * @returns {void}
 */
export function describe(name, fn) {
    const prev = _describe;
    _describe = prev ? `${prev} > ${name}` : name;
    try {
        fn();
    } finally {
        _describe = prev;
    }
}

/**
 * Run a single test case. Failures are reported to stdout; throws are
 * captured so the next case still runs.
 * @param {string} name
 * @param {() => void} fn
 * @returns {void}
 */
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

/**
 * Strict `===` equality check.
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 * @throws {Error} on mismatch.
 */
export function assertEqual(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`${msg ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * JSON-stringify equality check — cheap structural comparison sufficient for
 * the shapes the test suite throws at it.
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 * @throws {Error} on mismatch.
 */
export function assertDeepEqual(actual, expected, msg) {
    const sa = JSON.stringify(actual);
    const sb = JSON.stringify(expected);
    if (sa !== sb)
        throw new Error(`${msg ?? 'assertDeepEqual'}: expected ${sb}, got ${sa}`);
}

/**
 * Assert that `fn` throws any error.
 * @param {() => void} fn
 * @param {string} [msg]
 * @throws {Error} when `fn` returns normally.
 */
export function assertThrows(fn, msg) {
    try {
        fn();
    } catch (_) {
        return;
    }
    throw new Error(`${msg ?? 'assertThrows'}: expected throw`);
}

/**
 * Print "{passed} passed, {failed} failed" and return a process exit code.
 * @returns {number} 0 on full pass, 1 otherwise.
 */
export function summary() {
    print(`\n${_passes} passed, ${_failures} failed`);
    return _failures === 0 ? 0 : 1;
}

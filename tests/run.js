/**
 * @file Discovers `tests/*.test.js` and runs each one as a `gjs -m`
 * subprocess. Each test file is self-contained (calls
 * `system.exit(summary())` on its own), so subprocess isolation keeps the
 * existing files runnable standalone AND lets the runner aggregate pass/fail
 * across the whole suite.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

const useColor = !GLib.getenv('NO_COLOR');
const C = {
    green: useColor ? '\x1b[32m' : '',
    red: useColor ? '\x1b[31m' : '',
    dim: useColor ? '\x1b[2m' : '',
    bold: useColor ? '\x1b[1m' : '',
    reset: useColor ? '\x1b[0m' : '',
};

/**
 * Resolve the directory containing this script so `gjs -m tests/run.js`
 * works from any cwd. `import.meta.url` is a file:// URL on gjs.
 * @returns {string} absolute path.
 */
function testsDir() {
    const url = import.meta.url;
    const path = url.startsWith('file://') ? url.slice('file://'.length) : url;
    return GLib.path_get_dirname(path);
}

/**
 * List every `*.test.js` under `dir`, sorted for stable output.
 * @param {string} dir
 * @returns {string[]} absolute paths.
 */
function discoverTests(dir) {
    const found = [];
    const d = GLib.Dir.open(dir, 0);
    let name;
    while ((name = d.read_name()) !== null) {
        if (name.endsWith('.test.js'))
            found.push(GLib.build_filenamev([dir, name]));
    }
    d.close();
    found.sort();
    return found;
}

/**
 * Run a single test file as `gjs -m <path>` and capture its merged output.
 * @param {string} path
 * @returns {{ok: boolean, stdout: string}}
 */
function runOne(path) {
    const proc = Gio.Subprocess.new(
        ['gjs', '-m', path],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
    );
    const [, stdout] = proc.communicate_utf8(null, null);
    const ok = proc.get_successful();
    return {ok, stdout: stdout ?? ''};
}

/**
 * Extract the trailing "N passed, M failed" line emitted by `summary()`.
 * @param {string} stdout
 * @returns {?{passed: number, failed: number, line: string}}
 */
function summaryFor(stdout) {
    const lines = stdout.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/(\d+) passed, (\d+) failed/);
        if (m)
            return {passed: Number(m[1]), failed: Number(m[2]), line: lines[i]};
    }
    return null;
}

/**
 * Runner entry point.
 * @returns {number} process exit code (0 on full pass).
 */
function main() {
    const dir = testsDir();
    const files = discoverTests(dir);
    if (files.length === 0) {
        print(`${C.red}No tests found in ${dir}${C.reset}`);
        return 1;
    }

    let totalPassed = 0;
    let totalFailed = 0;
    let failedFiles = 0;
    const failures = [];

    for (const path of files) {
        const rel = GLib.path_get_basename(path);
        const {ok, stdout} = runOne(path);
        const s = summaryFor(stdout);

        if (ok && s && s.failed === 0) {
            totalPassed += s.passed;
            print(`${C.green}OK${C.reset}   ${rel}  ${C.dim}(${s.passed} passed)${C.reset}`);
        } else {
            failedFiles += 1;
            if (s) {
                totalPassed += s.passed;
                totalFailed += s.failed;
            }
            print(`${C.red}FAIL${C.reset} ${rel}${s ? `  ${C.dim}(${s.passed} passed, ${s.failed} failed)${C.reset}` : ''}`);
            failures.push({rel, stdout});
        }
    }

    if (failures.length > 0) {
        print('');
        print(`${C.bold}Failure details:${C.reset}`);
        for (const f of failures) {
            print(`${C.red}── ${f.rel} ──${C.reset}`);
            print(f.stdout.trimEnd());
        }
    }

    print('');
    const overall = failedFiles === 0
        ? `${C.green}${C.bold}PASS${C.reset}  ${totalPassed} tests across ${files.length} files`
        : `${C.red}${C.bold}FAIL${C.reset}  ${totalPassed} passed, ${totalFailed} failed across ${files.length} files (${failedFiles} file${failedFiles === 1 ? '' : 's'} failed)`;
    print(overall);

    return failedFiles === 0 ? 0 : 1;
}

system.exit(main());

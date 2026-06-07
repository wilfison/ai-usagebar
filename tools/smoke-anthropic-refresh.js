import system from 'system';
import GLib from 'gi://GLib';

import {
    defaultCredsPath,
    readCreds,
    planLabel,
    needsRefresh,
    refresh,
    writeBack,
} from '../lib/oauth/anthropic.js';
import {request, disposeSession} from '../lib/http.js';

const EXIT = {
    ok: 0,
    generic: 1,
    enoent: 2,
    transport: 3,
    http: 4,
    schema: 5,
    io: 6,
};

function parseArgs(argv) {
    const out = {force: false, path: null};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force') {
            out.force = true;
        } else if (a === '--path') {
            out.path = argv[++i];
            if (out.path === undefined)
                throw new Error('--path requires a value');
        } else if (a === '--help' || a === '-h') {
            out.help = true;
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    return out;
}

function printHelp() {
    print('Usage: gjs -m tools/smoke-anthropic-refresh.js [--force] [--path PATH]');
    print('  --force       skip needsRefresh and POST a refresh, then writeBack');
    print('  --path PATH   override default ~/.claude/.credentials.json');
}

function topLevelKeys(path) {
    try {
        const {raw} = readCreds(path);
        return Object.keys(raw).sort();
    } catch (_) {
        return [];
    }
}

function runSync(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value, err, done = false;
    Promise.resolve(promise).then(
        v => { value = v; done = true; loop.quit(); },
        e => { err = e; done = true; loop.quit(); }
    );
    if (!done)
        loop.run();
    if (err)
        throw err;
    return value;
}

function nowSecs() {
    return Math.trunc(GLib.get_real_time() / 1_000_000);
}

function reportRefreshFailure(result) {
    if (result.kind === 'transport') {
        print(`TRANSPORT: ${result.message}`);
        return EXIT.transport;
    }
    if (result.kind === 'http') {
        print(`HTTP ${result.status}: ${result.body}`);
        return EXIT.http;
    }
    if (result.kind === 'schema') {
        print(`SCHEMA: ${result.message}`);
        return EXIT.schema;
    }
    print(`UNKNOWN failure kind: ${JSON.stringify(result)}`);
    return EXIT.generic;
}

function main() {
    let args;
    try {
        args = parseArgs(system.programArgs);
    } catch (e) {
        print(`error: ${e.message}`);
        printHelp();
        return EXIT.generic;
    }
    if (args.help) {
        printHelp();
        return EXIT.ok;
    }

    const path = args.path ?? defaultCredsPath();
    print(`creds path: ${path}`);

    let oauth;
    try {
        ({oauth} = readCreds(path));
    } catch (e) {
        if (e?.code === 'ENOENT') {
            print(`ENOENT: ${path} not found. Run \`claude\` to authenticate.`);
            return EXIT.enoent;
        }
        print(`error: ${e?.message ?? e}`);
        return EXIT.generic;
    }

    const label = planLabel(oauth);
    const expiresAtSecs = Math.trunc(oauth.expiresAtMs / 1000);
    const deltaSecs = expiresAtSecs - nowSecs();
    print(`plan: ${label}`);
    print(`expiresAtMs: ${oauth.expiresAtMs} (in ${deltaSecs}s)`);

    const need = needsRefresh(expiresAtSecs, nowSecs());
    print(`needsRefresh: ${need}`);

    if (!args.force) {
        return EXIT.ok;
    }

    const before = topLevelKeys(path);
    print(`top-level keys before: ${JSON.stringify(before)}`);

    let result;
    try {
        result = runSync(refresh(request, oauth.refreshToken));
    } catch (e) {
        print(`error: refresh threw: ${e?.message ?? e}`);
        disposeSession();
        return EXIT.generic;
    }
    disposeSession();

    if (!result.ok)
        return reportRefreshFailure(result);

    const merged = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? oauth.refreshToken,
        expiresAtMs: (nowSecs() + result.expiresIn) * 1000,
        subscriptionType: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
        scopes: oauth.scopes,
    };

    const writeResult = writeBack(path, merged);
    if (!writeResult.ok) {
        print(`IO: ${writeResult.message}`);
        return EXIT.io;
    }

    const after = topLevelKeys(path);
    print(`top-level keys after:  ${JSON.stringify(after)}`);
    print('refresh + writeBack: OK');
    return EXIT.ok;
}

system.exit(main());

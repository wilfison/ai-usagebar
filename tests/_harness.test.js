import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';

import {describe, it, assertEqual, assertDeepEqual} from './_assert.js';
import {
    runSync, httpStub, routeStub, res, resTransport, rmRf, chmod, readText, writeText, withTempDir, withCacheHome, backdate, b64url, fakeJwt, retryArmed,
} from './_harness.js';
import {summary} from './_assert.js';

function expectThrow(fn) {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected throw');
}

describe('runSync', () => {
    it('returns a resolved value', () => assertEqual(runSync(Promise.resolve(7)), 7));
    it('accepts a plain value', () => assertEqual(runSync(3), 3));
    it('waits for a value resolved on the main loop', () => {
        const p = new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            resolve('later');
            return GLib.SOURCE_REMOVE;
        }));
        assertEqual(runSync(p), 'later');
    });
    it('rethrows a rejection', () => {
        const e = expectThrow(() => runSync(Promise.reject(new Error('boom'))));
        assertEqual(e.message, 'boom');
    });
});

describe('res / resTransport', () => {
    it('res encodes the body', () => {
        const r = res(200, 'hi');
        assertEqual(r.status, 200);
        assertEqual(new TextDecoder().decode(r.bodyBytes), 'hi');
        assertEqual(r.error, null);
    });
    it('res without text is an empty body', () => assertEqual(res(204).bodyBytes.length, 0));
    it('resTransport carries a transport error', () => {
        const r = resTransport('refused');
        assertEqual(r.status, 0);
        assertDeepEqual(r.error, {kind: 'transport', message: 'refused'});
    });
    it('resTransport defaults its message', () => assertEqual(resTransport().error.message, 'connection refused'));
});

describe('httpStub', () => {
    it('answers every call with a single response and records the calls', () => {
        const http = httpStub(res(200, 'a'));
        runSync(http({url: 'u1'}));
        const r = runSync(http({url: 'u2'}));
        assertEqual(r.status, 200);
        assertDeepEqual(http.calls.map(c => c.url), ['u1', 'u2']);
    });
    it('walks a list and repeats the last entry', () => {
        const http = httpStub([res(500), res(200)]);
        assertDeepEqual([1, 2, 3].map(() => runSync(http({})).status), [500, 200, 200]);
    });
});

describe('routeStub', () => {
    it('answers by url', () => {
        const http = routeStub({a: res(200), b: res(401)});
        assertEqual(runSync(http({url: 'b'})).status, 401);
        assertEqual(http.calls.length, 1);
    });
    it('uses the key function and fallback', () => {
        const http = routeStub({'/x': res(200)}, {key: o => o.url.replace(/^.*\/api/u, ''), fallback: res(404)});
        assertEqual(runSync(http({url: 'https://h/api/x'})).status, 200);
        assertEqual(runSync(http({url: 'https://h/api/y'})).status, 404);
    });
    it('rejects for an Error route', () => {
        const http = routeStub({a: new Error('down')});
        assertEqual(expectThrow(() => runSync(http({url: 'a'}))).message, 'down');
    });
});

describe('files', () => {
    it('writeText creates parents and readText reads it back', () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-harness-XXXXXX');
        const path = GLib.build_filenamev([dir, 'a', 'b.txt']);
        writeText(path, 'hello');
        assertEqual(readText(path), 'hello');
        rmRf(dir);
        assertEqual(GLib.file_test(dir, GLib.FileTest.EXISTS), false);
    });
    it('chmod sets the mode', () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-harness-XXXXXX');
        const path = GLib.build_filenamev([dir, 'f']);
        writeText(path, 'x');
        chmod(path, 0o600);
        const info = Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        assertEqual(info.get_attribute_uint32('unix::mode') & 0o777, 0o600);
        rmRf(dir);
    });
    it('rmRf ignores a missing path', () => rmRf('/nonexistent/ai-usagebar-harness'));
    it('writeText with private creates a 0600 file', () => {
        const dir = GLib.Dir.make_tmp('ai-usagebar-harness-XXXXXX');
        const path = GLib.build_filenamev([dir, 'p']);
        writeText(path, 'x', {private: true});
        const info = Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        assertEqual(info.get_attribute_uint32('unix::mode') & 0o777, 0o600);
        rmRf(dir);
    });
});

describe('withTempDir', () => {
    it('hands a temp dir plus setup to the body, then removes it', () => {
        let seen = null;
        withTempDir(({dir, path}) => {
            seen = dir;
            assertEqual(GLib.file_test(dir, GLib.FileTest.IS_DIR), true);
            assertEqual(path, GLib.build_filenamev([dir, 'auth.json']));
        }, {setup: dir => ({path: GLib.build_filenamev([dir, 'auth.json'])})})();
        assertEqual(GLib.file_test(seen, GLib.FileTest.EXISTS), false);
    });
    it('leaves XDG_CACHE_HOME alone', () => {
        const before = GLib.getenv('XDG_CACHE_HOME');
        withTempDir(() => assertEqual(GLib.getenv('XDG_CACHE_HOME'), before))();
    });
});

describe('withCacheHome', () => {
    it('points XDG_CACHE_HOME at a temp dir, then restores and removes it', () => {
        const before = GLib.getenv('XDG_CACHE_HOME');
        let seen = null;
        withCacheHome('zai', ({cache, dir}) => {
            seen = dir;
            assertEqual(GLib.getenv('XDG_CACHE_HOME'), dir);
            assertEqual(cache.dir.startsWith(dir), true, 'cache lives under the temp dir');
        })();
        assertEqual(GLib.getenv('XDG_CACHE_HOME'), before);
        assertEqual(GLib.file_test(seen, GLib.FileTest.EXISTS), false);
    });
    it('without a vendor gives no cache', () => {
        withCacheHome(null, ({cache, dir}) => {
            assertEqual(cache, null);
            assertEqual(GLib.getenv('XDG_CACHE_HOME'), dir);
        })();
    });
    it('merges what setup returns into the context', () => {
        withCacheHome('zai', ({extra}) => assertEqual(extra, 42), {setup: () => ({extra: 42})})();
    });
    it('restores the env even when the body throws', () => {
        const before = GLib.getenv('XDG_CACHE_HOME');
        expectThrow(withCacheHome('zai', () => {
            throw new Error('x');
        }));
        assertEqual(GLib.getenv('XDG_CACHE_HOME'), before);
    });
});

describe('b64url / fakeJwt', () => {
    it('b64url is unpadded base64url', () => {
        assertEqual(b64url('a'), 'YQ');
        assertEqual(b64url('ab'), 'YWI');
        assertEqual(b64url('abc'), 'YWJj');
        assertEqual(b64url('ÿþ'), 'w7_Dvg');
    });
    it('fakeJwt round-trips its claims through the payload segment', () => {
        const [head, payload, sig] = fakeJwt({exp: 5, sub: 'x'}).split('.');
        assertEqual(head, b64url(JSON.stringify({alg: 'none'})));
        assertEqual(payload, b64url(JSON.stringify({exp: 5, sub: 'x'})));
        assertEqual(sig, 'sig');
    });
});

describe('retryArmed', () => {
    it('is false until a backoff is written, then true', withCacheHome('zai', ({cache}) => {
        assertEqual(retryArmed(cache), false);
        cache.writeRetryAfter(Date.now() + 60_000);
        assertEqual(retryArmed(cache), true);
    }));
});

describe('backdate', () => {
    it('moves the payload mtime into the past', withCacheHome('zai', ({cache}) => {
        cache.writePayload('{}');
        backdate(cache, 3600);
        const age = runSync(cache.payloadAgeMs());
        assertEqual(age >= 3600_000 && age < 3700_000, true, `age ${age}`);
    }));
});

system.exit(summary());

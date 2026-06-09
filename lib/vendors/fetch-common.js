// Shared fetch-state-machine helpers for every vendor `main.js`. Pure JS
// (the cache is duck-typed), so this is unit-tested directly.

const _locks = new Map();

// Serialize calls that share a key (the cache dir) so concurrent fetches for
// one vendor don't double-request or race the cache writes. The chain is kept
// rejection-free so a failing `fn` never surfaces as an unhandled rejection.
export function withMutex(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    _locks.set(key, result.then(() => {}, () => {}));
    return result;
}

// Build a stale `ok:true` result from the cached payload, or return `noCache`
// when nothing is cached / the payload no longer parses. `parse(bytes) →
// snapshot` is the vendor's pure parser and may throw.
export function staleResult(cache, parse, noCache) {
    const bytes = cache.maybePayload();
    if (bytes !== null) {
        try {
            return {
                ok: true,
                snapshot: parse(bytes),
                stale: true,
                lastError: cache.readLastError(),
                cacheAgeMs: cache.payloadAgeMs() ?? 0,
            };
        } catch (_) {
            // Unparseable cached payload — fall through to `noCache`.
        }
    }
    return noCache;
}

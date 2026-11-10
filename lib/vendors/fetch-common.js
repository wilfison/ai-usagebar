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

import {sanitizeUntrusted, redactSecret} from '../format.js';

// A 429 pauses every request to that vendor this long, so the poll does not
// keep the block alive.
export const RETRY_AFTER_MS = 5 * 60 * 1000;
export const RATE_LIMITED = 'rate-limited';

// When a backoff is active, the epoch ms it lifts at; otherwise null.
export async function underBackoff(cache, now) {
    const until = await cache.readRetryAfter();
    return until !== null && until > now.getTime() ? until : null;
}

// Served instead of any request while under backoff: the cached payload (if
// still within MAX_STALE_MS) marked stale, else a rate-limited error.
export async function backoffResult(cache, parse, untilMs, now) {
    const retryInMs = untilMs - now.getTime();
    const bytes = await cache.maybePayload();
    const ageMs = bytes === null ? null : await cache.payloadAgeMs() ?? 0;
    if (bytes !== null && ageMs <= MAX_STALE_MS) {
        try {
            return {
                ok: true,
                snapshot: parse(bytes),
                stale: true,
                lastError: {code: RATE_LIMITED, retryInMs},
                cacheAgeMs: ageMs,
            };
        } catch (_) {
            // Unparseable: report the backoff itself.
        }
    }
    return {ok: false, kind: 'error', code: RATE_LIMITED, retryInMs};
}

export const AUTH_REJECTED = 'auth-rejected';
export const INVALID_MAPPING = 'invalid-mapping';

// What an HTTP failure may keep: a 401/403 body can echo a credential, so only
// its status survives; any other body is sanitized and capped.
export function redactHttpError(status, body) {
    if (status === 401 || status === 403)
        return {code: AUTH_REJECTED, status};
    return {code: 'http', status, body: sanitizeUntrusted(body, 4096)};
}

// Records a redacted HTTP failure in `.last_error`; the result carries the
// same redacted pair the UI will render.
export function recordHttpError(cache, status, body, message) {
    const e = redactHttpError(status, body);
    cache.writeLastError(status, e.body ?? '');
    if (e.code === AUTH_REJECTED)
        return {ok: false, kind: 'error', code: AUTH_REJECTED, status, message: `HTTP ${status}: authentication rejected`};
    return {ok: false, kind: 'error', status, message};
}

// Past this age a cached figure is history, not usage: the failure is shown instead.
export const MAX_STALE_MS = 7 * 86400 * 1000;

function redactAll(text, secrets) {
    return secrets.reduce((t, s) => redactSecret(t, s), text);
}

// A cache whose `.last_error` writes never carry a secret: the key is gone
// before the first point of writing, not scrubbed after.
export function redactingCache(cache, secrets) {
    const wrapped = Object.create(cache);
    wrapped.writeLastError = (status, body) => cache.writeLastError(status, redactAll(body, secrets));
    return wrapped;
}

// The text a result carries to the UI, with the same secrets removed.
export function redactResult(result, secrets) {
    if (!result || secrets.length === 0)
        return result;
    const out = {...result};
    if (typeof out.message === 'string')
        out.message = redactAll(out.message, secrets);
    if (out.lastError && typeof out.lastError.body === 'string')
        out.lastError = {...out.lastError, body: redactAll(out.lastError.body, secrets)};
    return out;
}

// Runs a vendor fetch with every secret it was handed (`null` entries are
// skipped) kept out of the cache and out of the result.
export async function redactedFetch(secrets, deps, doFetch) {
    const live = secrets.filter(s => typeof s === 'string' && s !== '');
    if (live.length === 0)
        return doFetch(deps);
    const result = await doFetch({...deps, cache: redactingCache(deps.cache, live)});
    return redactResult(result, live);
}

// Build a stale `ok:true` result from the cached payload, or return
// `original` (the result that caused the fallback) when nothing usable is
// cached (absent, older than MAX_STALE_MS, or unparseable). `parse(bytes) →
// snapshot` is the vendor's pure parser and may throw.
export async function staleResult(cache, parse, original) {
    const bytes = await cache.maybePayload();
    if (bytes === null)
        return original;
    const ageMs = await cache.payloadAgeMs() ?? 0;
    if (ageMs > MAX_STALE_MS)
        return original;
    try {
        return {
            ok: true,
            snapshot: parse(bytes),
            stale: true,
            lastError: await cache.readLastError(),
            cacheAgeMs: ageMs,
        };
    } catch (_) {
        return original;
    }
}

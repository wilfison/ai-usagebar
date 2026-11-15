// Shared fetch-state-machine helpers for every vendor `main.js`. Pure JS
// (the cache is duck-typed), so this is unit-tested directly.

import {sanitizeUntrusted, redactSecret} from '../format.js';
import {isSuccess, bodyText} from '../http-util.js';
import {needsRefresh} from '../oauth/refresh.js';

export const CACHE_TTL_MS = 60_000;
export const HTTP_TIMEOUT_MS = 10_000;

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
// OAuth stops the popup words itself; `loginCommand` rides along.
export const NO_ACCESS_TOKEN = 'no-access-token';
export const TOKEN_REFRESH_FAILED = 'token-refresh-failed';

// What an HTTP failure may keep: a 401/403 body can echo a credential, so only
// its status survives; any other body is sanitized and capped.
export function redactHttpError(status, body) {
    if (status === 401 || status === 403)
        return {code: AUTH_REJECTED, status};
    return {code: 'http', status, body: sanitizeUntrusted(body, 4096)};
}

// Records a redacted HTTP failure in `.last_error`; the result carries the
// same redacted pair the UI will render.
export async function recordHttpError(cache, status, body, message) {
    const e = redactHttpError(status, body);
    await cache.writeLastError(status, e.body ?? '');
    if (e.code === AUTH_REJECTED)
        return {ok: false, kind: 'error', code: AUTH_REJECTED, status, message: `HTTP ${status}: authentication rejected`};
    return {ok: false, kind: 'error', status, message};
}

// Past this age a cached figure is history, not usage: the failure is shown instead.
export const MAX_STALE_MS = 7 * 86400 * 1000;

// Read at each call, so a secret pushed mid-fetch (a rotated token) is covered.
function redactAll(text, secrets) {
    return secrets.filter(s => typeof s === 'string' && s !== '').reduce((t, s) => redactSecret(t, s), text);
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
    return redactedRun(live, deps.cache, cache => doFetch({...deps, cache}));
}

// Same, for secrets only known once the fetch has started (OAuth tokens read
// from disk): `secrets` is a live array the caller may push rotated ones to.
export async function redactedRun(secrets, cache, run) {
    return redactResult(await run(redactingCache(cache, secrets)), secrets);
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

export function errorResult(e) {
    return {ok: false, kind: 'error', message: e?.message ?? String(e)};
}

// A new object each time: a caller may annotate the result it gets.
export function loading() {
    return {ok: false, kind: 'loading'};
}

// The fetch every vendor runs: a fresh cache answers alone; under a 429
// backoff nothing is sent; `authorize` may stop before the request (its
// result falls back to the cache); a transport failure is a silent stale
// fallback; a 2xx is parsed before it is cached; any other status is
// recorded and falls back. `request` may answer one response or a list,
// and `parse` gets the same value.
export async function runFetch({
    cache, now = new Date(), cacheTtlMs = CACHE_TTL_MS, parseCached,
    authorize = null, request, parse, enrich = null, toCache,
    httpErrorMessage, httpErrorBody = bodyText, errorExtras = {},
}) {
    const staleOr = original => staleResult(cache, parseCached, original);

    const fresh = await cache.freshPayload(cacheTtlMs);
    if (fresh !== null) {
        try {
            return {ok: true, snapshot: parseCached(fresh), stale: false, lastError: null, cacheAgeMs: await cache.payloadAgeMs() ?? 0};
        } catch (_) {
            // Corrupt fresh cache: fall through to a live fetch.
        }
    }

    const backoffUntil = await underBackoff(cache, now);
    if (backoffUntil !== null)
        return backoffResult(cache, parseCached, backoffUntil, now);

    if (authorize) {
        const blocked = await authorize();
        if (blocked)
            return staleOr(blocked);
    }

    const answer = await request();
    const responses = Array.isArray(answer) ? answer : [answer];
    if (responses.some(r => r.error))
        return staleOr(loading());

    const failed = responses.find(r => !isSuccess(r.status));
    if (failed) {
        await cache.markStale();
        const recorded = await recordHttpError(cache, failed.status, httpErrorBody(failed), httpErrorMessage(failed.status));
        return staleOr({...recorded, ...errorExtras});
    }

    let snapshot;
    try {
        snapshot = parse(answer);
    } catch (e) {
        const message = e?.message ?? String(e);
        await cache.markStale();
        await cache.writeLastError(0, message);
        return staleOr({ok: false, kind: 'error', message, ...errorExtras});
    }
    if (enrich)
        snapshot = await enrich(snapshot);
    await cache.writePayload(toCache(snapshot));
    return {ok: true, snapshot, stale: false, lastError: null, cacheAgeMs: 0};
}

// What a token refresh `rr` leaves the fetch with: null when the new token
// can be used, else the result to stop on. `apply(rr)` folds a successful
// refresh in and saves it, answering `{rotated, saved}`.
export async function settleRefresh(rr, cache, {loginCommand, apply}) {
    const failed = (status = null) => ({
        ok: false,
        kind: 'error',
        code: TOKEN_REFRESH_FAILED,
        loginCommand,
        message: `token refresh failed; run \`${loginCommand}\` to re-authenticate`,
        ...(status ? {status} : {}),
    });
    if (rr.ok) {
        const {rotated, saved} = await apply(rr);
        // Losing a rotated refresh token logs the user out on the next run;
        // a new access token alone is best-effort.
        if (saved.ok || !rotated)
            return null;
        await cache.writeLastError(0, `refreshed token could not be saved (${saved.message}); ` +
            `the rotated refresh token is lost; re-run \`${loginCommand}\``);
        return failed();
    }
    if (rr.kind === 'http') {
        await recordHttpError(cache, rr.status, rr.body);
        return failed(rr.status);
    }
    if (rr.kind === 'transport')
        return loading();
    await cache.writeLastError(0, rr.message);
    return failed();
}

// The OAuth vendors' pre-request step: refreshes an expiring token, then
// checks one is left; a result means the fetch stops there. `tokens` is the
// live `{accessToken, refreshToken}` that `apply(rr)` updates; `extras` is
// added to an error.
export async function authorizeOAuth({tokens, expiresAtSecs, nowSecs, cache, loginCommand, refresh, apply, extras = {}}) {
    // An empty refresh token (signed out, or a flow without one) is never
    // POSTed: the token endpoint would 400 and record an auth error.
    const haveRefresh = (tokens.refreshToken ?? '').trim() !== '';
    if (haveRefresh && needsRefresh(expiresAtSecs, nowSecs)) {
        const rr = await refresh(tokens.refreshToken);
        const failure = await settleRefresh(rr, cache, {loginCommand, apply: () => apply(rr)});
        if (failure)
            return failure.kind === 'error' ? {...failure, ...extras} : failure;
    }

    // A blank token is a signed-out credentials file, not a rate limit: sent as
    // `Bearer `, its 429 would arm a backoff that outlives the next login.
    if ((tokens.accessToken ?? '').trim() === '')
        return {ok: false, kind: 'error', code: NO_ACCESS_TOKEN, loginCommand, message: `no access token; run \`${loginCommand}\` to log in`, ...extras};
    return null;
}

// A vendor's `fetchSnapshot`: serialized per cache dir, with the secrets
// `secretsOf(deps)` names kept out of the cache and the result.
export function vendorFetch(id, secretsOf, doFetch) {
    return deps => withMutex(deps?.cache?.dir ?? id, () => redactedFetch(secretsOf(deps ?? {}), deps, doFetch));
}

export function httpGet(deps, url, headers) {
    return deps.http({method: 'GET', url, headers, timeoutMs: HTTP_TIMEOUT_MS, cancellable: deps.signal ?? undefined});
}

// A request whose failure (transport, HTTP or parse) never costs the fetch:
// it answers `fallback`, and the body is dropped unread.
export async function optionalRequest(pending, parse, fallback) {
    try {
        const res = await pending;
        if (res.error || !isSuccess(res.status))
            return fallback;
        return parse(res);
    } catch (_) {
        return fallback;
    }
}

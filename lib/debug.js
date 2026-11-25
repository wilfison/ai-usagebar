// Dev-only overrides driven by environment variables (see `make run`). Pure so
// it stays unit-testable; the gi-bound caller reads the env value and passes the
// raw string in.

export const FAKE_PCT_ENV = 'AI_USAGEBAR_FAKE_PCT';

// Parse the AI_USAGEBAR_FAKE_PCT value into a clamped 0..100 percentage. Returns
// null when unset, blank, or non-numeric, so callers fall back to the real fetch.
export function parseFakePct(raw) {
    if (raw === null || raw === undefined)
        return null;
    const s = String(raw).trim();
    if (s === '')
        return null;
    const n = Number(s);
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.min(100, n));
}

// One override per window kind, AI_USAGEBAR_FAKE_PCT_<KIND>, for every vendor
// that has that window. Any of them turns synthetic usage on; a kind left unset
// takes AI_USAGEBAR_FAKE_PCT, or 0 without it.
export const FAKE_PCT_KINDS = Object.freeze(['session', 'weekly', 'monthly', 'sonnet', 'scoped', 'mcp', 'code_review', 'credits']);

export function fakePctEnv(kind) {
    return `${FAKE_PCT_ENV}_${kind.toUpperCase()}`;
}

// `getenv(name)` returns the raw value or null. Null when no FAKE_PCT env is
// set, otherwise {base, <kind>: pct...} with every kind filled in.
export function parseFakePcts(getenv) {
    const base = parseFakePct(getenv(FAKE_PCT_ENV));
    const own = FAKE_PCT_KINDS.map(kind => [kind, parseFakePct(getenv(fakePctEnv(kind)))]);
    if (base === null && own.every(([, v]) => v === null))
        return null;
    const pcts = {base: base ?? 0};
    for (const [kind, v] of own)
        pcts[kind] = v ?? pcts.base;
    return Object.freeze(pcts);
}

// `base=40 weekly=95`: the base plus every kind that differs from it.
export function formatFakePcts(pcts) {
    const parts = [`base=${pcts.base}`];
    for (const kind of FAKE_PCT_KINDS) {
        if (pcts[kind] !== pcts.base)
            parts.push(`${kind}=${pcts[kind]}`);
    }
    return parts.join(' ');
}

export const FAKE_ERROR_ENV = 'AI_USAGEBAR_FAKE_ERROR';
export const FAKE_DELAY_ENV = 'AI_USAGEBAR_FAKE_DELAY_MS';
export const FAKE_ERROR_MESSAGE = `${FAKE_ERROR_ENV}: simulated failure`;
const MAX_FAKE_DELAY_MS = 120_000;

export const FakeFailure = Object.freeze({ERROR: 'error', STALE: 'stale'});

// The vendors AI_USAGEBAR_FAKE_ERROR fails, as a Map id -> FakeFailure: a comma
// list of `id` (an error) or `id:stale` (stale data with an HTTP error), where
// `*` stands for every vendor and a later entry overrides an earlier one. Null
// when unset or naming no known vendor.
export function parseFakeErrorVendors(raw, knownIds) {
    if (raw === null || raw === undefined)
        return null;
    const failures = new Map();
    for (const entry of String(raw).split(',').map(s => s.trim()).filter(Boolean)) {
        const [id, mode = ''] = entry.split(':').map(s => s.trim());
        const failure = mode === 'stale' ? FakeFailure.STALE : mode === '' ? FakeFailure.ERROR : null;
        if (failure === null)
            continue;
        for (const known of id === '*' ? knownIds : knownIds.filter(k => k === id))
            failures.set(known, failure);
    }
    return failures.size > 0 ? failures : null;
}

// AI_USAGEBAR_FAKE_DELAY_MS as whole milliseconds, capped at two minutes; null
// when unset, blank, non-numeric or not positive.
export function parseFakeDelayMs(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '')
        return null;
    const n = Math.round(Number(String(raw).trim()));
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return Math.min(MAX_FAKE_DELAY_MS, n);
}

// What a fetch under AI_USAGEBAR_FAKE_PCT returns, taking the shapes a real
// failure ends in: an error, or the snapshot marked stale with an HTTP error.
// `makeSnapshot` is only called when a snapshot is shown.
export function fakeResult(failure, makeSnapshot) {
    if (failure === FakeFailure.ERROR)
        return {ok: false, kind: 'error', message: FAKE_ERROR_MESSAGE};
    const stale = failure === FakeFailure.STALE;
    return {
        ok: true,
        snapshot: makeSnapshot(),
        stale,
        lastError: stale ? {code: 503, body: FAKE_ERROR_MESSAGE} : null,
        cacheAgeMs: 0,
    };
}

// The response a failed vendor's real fetch gets under AI_USAGEBAR_FAKE_ERROR
// without FAKE_PCT, so its own stale fallback and sidecars run.
export function fakeHttpFailure() {
    return {status: 503, headers: {}, bodyBytes: new TextEncoder().encode(FAKE_ERROR_MESSAGE), error: null};
}

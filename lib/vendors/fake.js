// Shared builders for dev-only synthetic snapshots (AI_USAGEBAR_FAKE_PCT and
// AI_USAGEBAR_FAKE_PCT_<KIND>). Each vendor's snapshot shape differs, but the
// window-based vendors all reduce to the same `{utilizationPct, resetsAt,
// windowMs}` quad, built here once. Pure: no gi:// imports, fully unit-tested.

export function clampPct(pct) {
    const n = Math.round(Number(pct));
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, n));
}

// The percentage for one window kind: `pct` is a plain number (one value for
// every window) or the per-kind object from parseFakePcts().
export function fakePct(pct, kind) {
    if (pct !== null && typeof pct === 'object')
        return pct[kind] ?? pct.base ?? 0;
    return pct;
}

function nowMs(now) {
    return now instanceof Date ? now.getTime() : Number(now);
}

// A synthetic usage window at `pct` with `elapsedPct` (0..100) of it already
// passed, so the reset is the rest of a window-length out.
export function fakeWindow(pct, windowMs, now = new Date(), elapsedPct = 0) {
    const elapsed = Math.max(0, Math.min(100, Number(elapsedPct) || 0));
    return {
        utilizationPct: clampPct(pct),
        resetsAt: new Date(nowMs(now) + Math.round(windowMs * (100 - elapsed) / 100)),
        windowMs,
    };
}

// The elapsed share of every fake window: the `elapsed` of parseFakePcts().
export function fakeElapsed(pct) {
    return pct !== null && typeof pct === 'object' ? pct.elapsed ?? 0 : 0;
}

// fakeWindow() for one window kind of the fake percentages.
export function fakeKindWindow(pct, kind, windowMs, now = new Date()) {
    return fakeWindow(fakePct(pct, kind), windowMs, now, fakeElapsed(pct));
}

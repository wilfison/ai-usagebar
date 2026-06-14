// Shared builders for dev-only synthetic snapshots (AI_USAGEBAR_FAKE_PCT). Each
// vendor's snapshot shape differs, but the window-based vendors all reduce to
// the same `{utilizationPct, resetsAt, windowMs}` quad — built here once. Pure:
// no gi:// imports, fully unit-tested.

export function clampPct(pct) {
    const n = Math.round(Number(pct));
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, n));
}

function nowMs(now) {
    return now instanceof Date ? now.getTime() : Number(now);
}

// A synthetic usage window at `pct`, resetting one window-length out so the
// popup countdown has something to tick.
export function fakeWindow(pct, windowMs, now = new Date()) {
    return {
        utilizationPct: clampPct(pct),
        resetsAt: new Date(nowMs(now) + windowMs),
        windowMs,
    };
}

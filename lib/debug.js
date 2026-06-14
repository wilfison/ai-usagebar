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

/**
 * @file Utilization severity buckets — pct → tier, tier → theme hex.
 *   >= 90 → critical;  >= 75 → high;  >= 50 → mid;  else low.
 */

/**
 * Utilization severity tier.
 * @enum {string}
 */
export const Severity = Object.freeze({
    LOW: 'low',
    MID: 'mid',
    HIGH: 'high',
    CRITICAL: 'critical',
});

/**
 * Bucket a utilization percent into a {@link Severity} tier.
 * @param {number} pct - utilization percent (typically 0-100).
 * @returns {string} one of {@link Severity}.
 */
export function severityFor(pct) {
    if (pct >= 90)
        return Severity.CRITICAL;
    if (pct >= 75)
        return Severity.HIGH;
    if (pct >= 50)
        return Severity.MID;
    return Severity.LOW;
}

/**
 * Resolve a {@link Severity} tier to its hex color in `theme`.
 * @param {string} sev - one of {@link Severity}.
 * @param {import('./theme.js').Theme} theme
 * @returns {string} hex color; falls back to `theme.fg` for unknown tiers.
 */
export function severityColor(sev, theme) {
    switch (sev) {
        case Severity.CRITICAL: return theme.red;
        case Severity.HIGH:     return theme.orange;
        case Severity.MID:      return theme.yellow;
        case Severity.LOW:      return theme.green;
        default:                return theme.fg;
    }
}

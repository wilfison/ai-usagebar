/**
 * @file Human-readable countdown between two instants. Mirrors
 * `tmp/ai-usagebar-rust/src/countdown.rs`:
 *   - null reset            → "—"
 *   - reset <= now          → "now"
 *   - >= 1 day remaining    → "{d}d {h}h"
 *   - < 1 day remaining     → "{h}h {mm:02d}m"
 */

/**
 * Zero-pad a small non-negative integer to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format the time remaining until `reset`.
 * @param {?Date} reset - reset instant, or null/undefined when unknown.
 * @param {Date} now - current instant.
 * @returns {string} '—', 'now', `{d}d {h}h`, or `{h}h {mm:02d}m`.
 */
export function format(reset, now) {
    if (reset === null || reset === undefined)
        return '—';

    const secs = Math.floor((reset.getTime() - now.getTime()) / 1000);
    if (secs <= 0)
        return 'now';

    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);

    if (days > 0)
        return `${days}d ${hours}h`;
    return `${hours}h ${pad2(mins)}m`;
}

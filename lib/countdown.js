/**
 * @file Human-readable countdown between two instants:
 *   - null reset            → "—"
 *   - reset <= now          → "now"
 *   - >= 1 day remaining    → "{d}d {h}h"
 *   - < 1 day remaining     → "{h}h {mm:02d}m"
 *
 * Pure — no `gi://` import. The unit labels are translatable via an injected
 * translator (defaults to identity), so the module stays unit-testable while the
 * caller (the gi-bound section builders) supplies the real gettext.
 */

import {vformat} from './format.js';

/**
 * Format the time remaining until `reset`.
 * @param {?Date} reset - reset instant, or null/undefined when unknown.
 * @param {Date} now - current instant.
 * @param {(s: string) => string} [_] - gettext translator; identity by default.
 * @returns {string} '—', 'now', `{d}d {h}h`, or `{h}h {mm:02d}m`.
 */
export function format(reset, now, _ = (s) => s) {
    if (reset === null || reset === undefined)
        return '—'; // em-dash marker — punctuation, not translated.

    const secs = Math.floor((reset.getTime() - now.getTime()) / 1000);
    if (secs <= 0)
        return _('now');

    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);

    if (days > 0)
        // Translators: compact countdown — d = days, h = hours.
        return vformat(_('%dd %dh'), days, hours);
    // Translators: compact countdown — h = hours, m = minutes (zero-padded).
    return vformat(_('%dh %02dm'), hours, mins);
}

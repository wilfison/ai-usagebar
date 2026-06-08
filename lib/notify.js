import {Severity} from './severity.js';
import {vformat} from './format.js';

export const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Decide whether to fire a notification and what debounce state to persist.
// peak: {percent: number|null, resetsAt: Date|null}; null percent → use severity.
// last: {percent, at, windowKey} from the previous evaluation, or null.
// now: current time in ms (Date.now()). The returned {percent, at, windowKey}
// is the state the caller must persist (via cache.writeNotified) and pass back.
export function evaluateNotification({
    enabled, peak, severity, threshold, last, now, cooldownMs = NOTIFY_COOLDOWN_MS,
}) {
    const windowKey = peak.resetsAt ? peak.resetsAt.toISOString() : '';
    const percent = peak.percent;
    const alerting = enabled && (percent != null
        ? percent >= threshold
        : severity === Severity.CRITICAL);

    const prevPercent = last ? last.percent : null;
    const prevAt = last ? last.at : null;

    if (!alerting)
        return {notify: false, alerting, percent: prevPercent, at: prevAt, windowKey};

    // A changed windowKey means the usage window rolled over (e.g. Anthropic's
    // 5h reset) — a fresh event that re-arms immediately.
    const windowChanged = last == null || last.windowKey !== windowKey;
    // Within the same window, don't re-announce the identical percentage…
    const samePercent = !windowChanged && percent != null && prevPercent === percent;
    // …and never re-fire more often than the cooldown.
    const cooledDown = windowChanged || prevAt == null || now - prevAt >= cooldownMs;

    const notify = cooledDown && !samePercent;
    return {
        notify,
        alerting,
        percent: notify ? percent : prevPercent,
        at: notify ? now : prevAt,
        windowKey,
    };
}

// `_` is an injected translator (identity default) per the pure-module rule.
export function notificationText(peak, _ = (s) => s) {
    if (peak.percent == null)
        return _('Usage is critical');
    return vformat(_('Usage at %d%%'), peak.percent);
}

import {Severity} from './severity.js';
import {vformat} from './format.js';

// `notify` is true only on the edge into the alerting state; caller persists
// `alerting`/`windowKey` (via cache.writeNotified) and passes them back as `last`.
// peak: {percent: number|null, resetsAt: Date|null}; null percent → use severity.
export function evaluateNotification({enabled, peak, severity, threshold, last}) {
    const windowKey = peak.resetsAt ? peak.resetsAt.toISOString() : '';
    if (!enabled)
        return {notify: false, alerting: false, windowKey};

    const alerting = peak.percent != null
        ? peak.percent >= threshold
        : severity === Severity.CRITICAL;

    // A changed windowKey means the usage window rolled over (e.g. Anthropic's
    // 5h reset), so a fresh crossing re-notifies.
    const wasAlerting = last && last.windowKey === windowKey ? last.alerting : false;

    return {notify: alerting && !wasAlerting, alerting, windowKey};
}

// `_` is an injected translator (identity default) per the pure-module rule.
export function notificationText(peak, _ = (s) => s) {
    if (peak.percent == null)
        return _('Usage is critical');
    return vformat(_('Usage at %d%%'), peak.percent);
}

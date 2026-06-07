import {vformat} from './format.js';

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

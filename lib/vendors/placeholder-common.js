// Shared pieces of the vendors' `placeholders()` and peak-usage reports.
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';

export const NO_WINDOW = Object.freeze({utilizationPct: 0, resetsAt: null});
export const WINDOW_SUFFIXES = Object.freeze(['pct', 'reset', 'elapsed', 'pace', 'pace_indicator']);
// The cross-vendor session_* / weekly_* keys carry no pace indicator.
export const SHARED_SUFFIXES = Object.freeze(['pct', 'reset', 'elapsed', 'pace']);
export const EMPTY_FIELDS = Object.freeze({pct: '', reset: '', elapsed: '', pace: '', paceIndicator: ''});

// The placeholder strings of one usage window; `calc` is its full pace report.
export function windowFields(win, now, windowMs = win.windowMs) {
    const pace = calc({usagePct: win.utilizationPct, reset: win.resetsAt, now, windowMs});
    return {
        pct: String(win.utilizationPct),
        reset: formatCountdown(win.resetsAt, now),
        elapsed: String(pace.elapsedPct),
        pace: paceGlyph(pace.ratioPace, pace.state),
        paceIndicator: paceGlyph(pace.pointPace, pace.state),
        calc: pace,
    };
}

const FIELD_OF = Object.freeze({
    pct: 'pct', reset: 'reset', elapsed: 'elapsed', pace: 'pace', pace_indicator: 'paceIndicator',
});

export function setWindowPlaceholders(m, prefix, fields, suffixes = WINDOW_SUFFIXES) {
    for (const suffix of suffixes)
        m.set(`${prefix}_${suffix}`, fields[FIELD_OF[suffix]]);
}

// The highest `{percent, resetsAt}`; on a tie the first one listed wins.
export function peakOf(candidates, fallback = {percent: 0, resetsAt: null}) {
    let peak = null;
    for (const c of candidates) {
        if (peak === null || c.percent > peak.percent)
            peak = c;
    }
    return peak ?? fallback;
}

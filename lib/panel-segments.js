import {panelLabel} from './format.js';
import {Severity} from './severity.js';

export const Tone = Object.freeze({SEVERITY: 'severity', PLAIN: 'plain'});

// Beside other segments a short mark, so N vendors loading don't spell it N times.
const LOADING_MARK = '…';
const ERROR_MARK = '⚠';

// What one panel segment shows for a vendor's FetchResult (or undefined
// before its first fetch). `alone` is true when it is the only segment.
export function segmentModel(res, {adapter, barFormat, paceArrows = false, alone = true, now = new Date()},
    _ = s => s, ngettext = (one, many, n) => (n === 1 ? one : many)) {
    if (res?.ok) {
        const values = adapter.placeholders(res.snapshot, now, ngettext);
        return {
            text: panelLabel(barFormat, values, {paceArrows, stale: res.stale}),
            tone: Tone.SEVERITY,
            severity: adapter.severity(res.snapshot),
        };
    }
    if (res?.kind === 'error')
        return {text: ERROR_MARK, tone: Tone.SEVERITY, severity: Severity.CRITICAL};
    return {text: alone ? _('Loading…') : LOADING_MARK, tone: Tone.PLAIN, severity: null};
}

// The id of the span holding `x`, else of the horizontally nearest one (a
// click in a gap or the button's padding still means a segment); null with
// no spans. Spans are half-open, so a shared edge belongs to the right one.
export function nearestSegment(x, spans) {
    let best = null;
    let bestDistance = Infinity;
    for (const s of spans) {
        const distance = x < s.x ? s.x - x : Math.max(0, x - (s.x + s.width) + 1);
        if (distance < bestDistance) {
            best = s.id;
            bestDistance = distance;
        }
    }
    return best;
}

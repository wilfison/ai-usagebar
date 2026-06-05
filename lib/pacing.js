/**
 * @file Pacing math — two parallel notions:
 *   ratio  = usagePct / elapsedPct, with a ±tolerance pp band, capped at 999.
 *   point  = usagePct - elapsedPct, no tolerance.
 * Mirrors tmp/ai-usagebar-rust/src/pacing.rs; integer division via Math.trunc
 * so outputs match the Rust binary byte-for-byte.
 */

/**
 * Default ±tolerance band (percentage points) around the ratio pace.
 * @type {number}
 */
export const DEFAULT_TOLERANCE = 5;

/**
 * Direction of pacing relative to the window's elapsed share.
 * @enum {string}
 */
export const Pace = Object.freeze({
    AHEAD: 'ahead',
    ON_TRACK: 'on_track',
    UNDER: 'under',
});

/**
 * Glyph for a Pace value, used in the panel label.
 * @param {string} pace - one of {@link Pace}.
 * @returns {string} '↑', '↓', or '→'.
 */
export function paceGlyph(pace) {
    if (pace === Pace.AHEAD)
        return '↑';
    if (pace === Pace.UNDER)
        return '↓';
    return '→';
}

/**
 * Severity tier for the point delta (usagePct - elapsedPct).
 * @enum {string}
 */
export const PaceSeverity = Object.freeze({
    LOW: 'low',
    MID: 'mid',
    HIGH: 'high',
    CRITICAL: 'critical',
});

/**
 * Bucket a point delta into a {@link PaceSeverity} tier.
 * @param {number} delta - usagePct - elapsedPct, in percentage points.
 * @returns {string} one of {@link PaceSeverity}.
 */
export function paceSeverity(delta) {
    if (delta >= 10)
        return PaceSeverity.CRITICAL;
    if (delta > 0)
        return PaceSeverity.HIGH;
    if (delta >= -10)
        return PaceSeverity.MID;
    return PaceSeverity.LOW;
}

/**
 * @typedef {object} PaceResult
 * @property {number} elapsedPct - integer percent of the window that has elapsed (0-100).
 * @property {string} ratioPace - {@link Pace} value derived from usagePct / elapsedPct.
 * @property {string} pointPace - {@link Pace} value derived from usagePct - elapsedPct.
 * @property {number} delta - signed point delta (usagePct - elapsedPct).
 * @property {string} ratioLabel - human-readable ratio label (e.g. "12% ahead").
 * @property {string} pointLabel - human-readable point label (e.g. "3pts under").
 */

/**
 * Neutral result returned when the window/reset is unknown.
 * @returns {PaceResult}
 */
function neutral() {
    return {
        elapsedPct: 0,
        ratioPace: Pace.ON_TRACK,
        pointPace: Pace.ON_TRACK,
        delta: 0,
        ratioLabel: 'on track',
        pointLabel: 'on track',
    };
}

/**
 * Compute pacing for a quota window.
 * @param {object} args
 * @param {number} args.usagePct - integer percent of the quota consumed (0-100).
 * @param {?Date} args.reset - end-of-window instant, or null/undefined when unknown.
 * @param {Date} args.now - current instant.
 * @param {number} args.windowMs - full window length in ms.
 * @param {number} [args.tolerance={@link DEFAULT_TOLERANCE}] - ±pp band on ratio pace.
 * @returns {PaceResult}
 */
export function calc({usagePct, reset, now, windowMs, tolerance = DEFAULT_TOLERANCE}) {
    if (reset === null || reset === undefined)
        return neutral();
    if (windowMs <= 0)
        return neutral();

    const remaining = Math.trunc((reset.getTime() - now.getTime()) / 1000);
    const total = Math.trunc(windowMs / 1000);
    if (total <= 0)
        return neutral();

    let elapsedPct = Math.trunc(((total - remaining) * 100) / total);
    if (elapsedPct < 0)
        elapsedPct = 0;
    if (elapsedPct > 100)
        elapsedPct = 100;

    const delta = usagePct - elapsedPct;
    let pointPace, pointLabel;
    if (delta > 0) {
        pointPace = Pace.AHEAD;
        pointLabel = `${delta}pts ahead`;
    } else if (delta < 0) {
        pointPace = Pace.UNDER;
        pointLabel = `${-delta}pts under`;
    } else {
        pointPace = Pace.ON_TRACK;
        pointLabel = 'on track';
    }

    let ratioPace = Pace.ON_TRACK;
    let ratioLabel = 'on track';
    if (elapsedPct > 0) {
        const pacingX100 = Math.trunc((usagePct * 100) / elapsedPct);
        const tol = tolerance;
        if (pacingX100 > 100 + tol) {
            const dev = Math.min(pacingX100 - 100, 999);
            ratioPace = Pace.AHEAD;
            ratioLabel = `${dev}% ahead`;
        } else if (pacingX100 < 100 - tol) {
            const dev = Math.min(100 - pacingX100, 999);
            ratioPace = Pace.UNDER;
            ratioLabel = `${dev}% under`;
        }
    }

    return {elapsedPct, ratioPace, pointPace, delta, ratioLabel, pointLabel};
}

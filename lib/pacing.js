export const DEFAULT_TOLERANCE = 5;

export const Pace = Object.freeze({
    AHEAD: 'ahead',
    ON_TRACK: 'on_track',
    UNDER: 'under',
});

export const PaceState = Object.freeze({
    OK: 'ok',
    ESTIMATING: 'estimating',
    LIMIT: 'limit',
    NEUTRAL: 'neutral',
});

// No glyph while there is nothing honest to say: too early in the window,
// already at the cap, or no reset to pace against.
export function paceGlyph(pace, state = PaceState.OK) {
    if (state !== PaceState.OK)
        return '';
    if (pace === Pace.AHEAD)
        return '↑';
    if (pace === Pace.UNDER)
        return '↓';
    return '→';
}

export const PaceVerdict = Object.freeze({
    CALM: 'calm',
    OVER: 'over',
    CRITICAL: 'critical',
});

// Tolerance around the pace line, from upstream: a verdict needs both the
// projection at the reset and the points the bar sits past the marker, since
// early in a long window one percent of use swings the projection a lot.
export const PACE_OVER_PERCENT = 110;
export const PACE_OVER_GAP = 3;
export const PACE_CRITICAL_PERCENT = 130;
export const PACE_CRITICAL_GAP = 5;
export const PACE_CRITICAL_LEFT = 10;
// A burst in the opening stretch of a long window with most of it left is a
// warning, not a run-out: it projects wildly from a few hours of use.
export const PACE_EARLY_ELAPSED = 15;
export const PACE_EARLY_LEFT = 50;

function verdictFor(usagePct, projectedPct, elapsedPct) {
    const gap = usagePct - elapsedPct;
    if (projectedPct > 100 && 100 - usagePct < PACE_CRITICAL_LEFT)
        return PaceVerdict.CRITICAL;
    if (projectedPct > PACE_CRITICAL_PERCENT && gap >= PACE_CRITICAL_GAP) {
        const early = elapsedPct < PACE_EARLY_ELAPSED && 100 - usagePct >= PACE_EARLY_LEFT;
        return early ? PaceVerdict.OVER : PaceVerdict.CRITICAL;
    }
    if (projectedPct > PACE_OVER_PERCENT && gap >= PACE_OVER_GAP)
        return PaceVerdict.OVER;
    return PaceVerdict.CALM;
}

function neutral(now) {
    return {
        elapsedPct: 0,
        ratioPace: Pace.ON_TRACK,
        pointPace: Pace.ON_TRACK,
        delta: 0,
        ratioLabel: 'on track',
        pointLabel: 'on track',
        state: PaceState.NEUTRAL,
        projectedPct: null,
        runsOutAt: null,
        verdict: null,
        now,
    };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// The first minutes of a long window say nothing about pace: 1% of it,
// clamped to [60 s, 1 h].
function estimatingThresholdMs(windowMs) {
    return Math.min(HOUR_MS, Math.max(MINUTE_MS, windowMs * 0.01));
}

function paceState(usagePct, reset, now, windowMs) {
    if (usagePct >= 100)
        return PaceState.LIMIT;
    const remainingMs = reset.getTime() - now.getTime();
    const elapsedMs = windowMs - remainingMs;
    if (usagePct > 0 && remainingMs > 0 && elapsedMs < estimatingThresholdMs(windowMs))
        return PaceState.ESTIMATING;
    return PaceState.OK;
}

export function calc({usagePct, reset, now, windowMs, tolerance = DEFAULT_TOLERANCE}) {
    if (reset === null || reset === undefined)
        return neutral(now);
    if (windowMs <= 0)
        return neutral(now);

    const remaining = Math.trunc((reset.getTime() - now.getTime()) / 1000);
    const total = Math.trunc(windowMs / 1000);
    if (total <= 0)
        return neutral(now);

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

    const state = paceState(usagePct, reset, now, windowMs);
    // Unrounded: the integer elapsedPct would push early-window rows over a gap edge.
    const elapsedMs = windowMs - (reset.getTime() - now.getTime());
    const projectedPct = elapsedMs > 0 ? usagePct * windowMs / elapsedMs : null;
    const verdict = state === PaceState.OK && projectedPct !== null
        ? verdictFor(usagePct, projectedPct, elapsedMs * 100 / windowMs)
        : null;
    let runsOutAt = null;
    if (verdict === PaceVerdict.CRITICAL) {
        const at = now.getTime() + (100 - usagePct) * elapsedMs / usagePct;
        if (at > now.getTime() && at < reset.getTime())
            runsOutAt = new Date(at);
    }
    return {elapsedPct, ratioPace, pointPace, delta, ratioLabel, pointLabel, state, projectedPct, runsOutAt, verdict, now};
}

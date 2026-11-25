// Recent usage samples per window, for the popup's trend line. A port of the
// upstream history (src/history.rs): bounded in points, series, age and bytes.
// Pure: the file lives in the vendor's cache dir and is read and written by
// the caller.
import {RESET_MOVE_TOLERANCE_MS} from './notify.js';

export const MAX_POINTS = 20;
export const SPARK_POINTS = 12;
export const MIN_POINTS = 3;
// A sample closer than this to the last one replaces it, so a burst of
// refreshes does not flatten the line.
export const MIN_INTERVAL_MS = 10 * 1000;
export const MAX_AGE_MS = 8 * 24 * 3600 * 1000;
// A clock stepped back (NTP, a manual fix) by up to this keeps the history;
// points further ahead are dropped as bogus.
export const MAX_SKEW_MS = 3600 * 1000;
export const MAX_SERIES = 64;
export const MAX_BYTES = 64 * 1024;

export function emptyTrend() {
    return {series: new Map()};
}

function resetMs(resetsAt) {
    return resetsAt instanceof Date && Number.isFinite(resetsAt.getTime()) ? resetsAt.getTime() : null;
}

// A series is one row key. Upstream keys it by the exact reset too, but
// vendors jitter that instant between fetches and rolling windows slide it,
// so, as notifications do, only a reset moved later by more than the
// tolerance starts a new window.
function newWindow(current, recorded) {
    return current !== null && recorded !== null && current - recorded > RESET_MOVE_TOLERANCE_MS;
}

function validPoint(p) {
    return Array.isArray(p) && p.length === 2 && Number.isInteger(p[0])
        && Number.isInteger(p[1]) && p[1] >= 0 && p[1] <= 100;
}

// Anything malformed or oversized is an empty history, never an error.
export function parseTrend(text) {
    const trend = emptyTrend();
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BYTES)
        return trend;
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return trend;
    }
    if (!raw?.series || typeof raw.series !== 'object' || Array.isArray(raw.series))
        return trend;
    for (const [key, entry] of Object.entries(raw.series)) {
        if (!entry || !Array.isArray(entry.points))
            continue;
        const points = entry.points.filter(validPoint).map(([at, pct]) => ({at, pct}));
        const reset = Number.isInteger(entry.reset) ? entry.reset : null;
        if (points.length > 0)
            trend.series.set(key, {reset, points});
    }
    return trend;
}

export function serializeTrend(trend) {
    const series = {};
    for (const [key, {reset, points}] of trend.series)
        series[key] = {reset, points: points.map(p => [p.at, p.pct])};
    return JSON.stringify({series});
}

function lastAt({points}) {
    return points.length > 0 ? points[points.length - 1].at : -Infinity;
}

function dropOldest(series) {
    let oldest = null;
    for (const [key, entry] of series) {
        if (oldest === null || lastAt(entry) < lastAt(series.get(oldest)))
            oldest = key;
    }
    if (oldest !== null)
        series.delete(oldest);
}

function prune(series, nowMs) {
    const cutoff = nowMs - MAX_AGE_MS;
    for (const [key, {reset, points}] of series) {
        const kept = [];
        for (const p of [...points].sort((a, b) => a.at - b.at)) {
            if (p.at < cutoff || p.at > nowMs + MAX_SKEW_MS)
                continue;
            if (kept.length > 0 && kept[kept.length - 1].at === p.at)
                kept[kept.length - 1] = p;
            else
                kept.push(p);
        }
        if (kept.length === 0)
            series.delete(key);
        else
            series.set(key, {reset, points: kept.slice(-MAX_POINTS)});
    }
    while (series.size > MAX_SERIES)
        dropOldest(series);
}

// Two rows sharing a key (scoped windows the vendor names alike) get their
// own series: the nth repeat is keyed `key#n`, in row order.
function uniqueKeys(rows) {
    const seen = new Map();
    return rows.map(row => {
        const base = String(row.key);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return n === 0 ? {...row, key: base} : {...row, key: `${base}#${n}`};
    });
}

// The history without points too old or too far ahead of `now`; recordTrend
// with no rows. Also for a history read from disk before it is drawn.
export function pruneTrend(trend, now) {
    return recordTrend(trend, [], now);
}

// One sample per notify row (`{key, percent, resetsAt}`) with a finite
// percent. Returns a new history; the one passed in is left as it was.
export function recordTrend(trend, rows, now) {
    const nowMs = now.getTime();
    const series = new Map([...trend.series].map(([k, e]) => [k, {reset: e.reset, points: [...e.points]}]));
    prune(series, nowMs);
    for (const row of uniqueKeys(rows)) {
        if (typeof row.percent !== 'number' || !Number.isFinite(row.percent))
            continue;
        const key = String(row.key);
        const reset = resetMs(row.resetsAt);
        const pct = Math.max(0, Math.min(100, Math.round(row.percent)));
        if (!series.has(key) && series.size >= MAX_SERIES)
            dropOldest(series);
        const entry = series.get(key);
        const points = entry && !newWindow(reset, entry.reset) ? entry.points : [];
        const last = points[points.length - 1];
        const sinceLast = last ? nowMs - last.at : Infinity;
        if (sinceLast >= 0 && sinceLast < MIN_INTERVAL_MS)
            points[points.length - 1] = {at: last.at, pct};
        else
            // Behind the last point the clock went back: keep the order
            // until it catches up.
            points.push({at: sinceLast < 0 ? last.at + 1 : nowMs, pct});
        // Follow the latest reset so a sliding window drifts fetch to fetch.
        const latest = reset === null ? entry?.reset ?? null : Math.max(reset, entry?.reset ?? reset);
        series.set(key, {reset: latest, points: points.slice(-MAX_POINTS)});
    }
    return {series};
}

// The last SPARK_POINTS percents of a row's series, or null below MIN_POINTS.
export function trendPoints(trend, row) {
    const entry = trend?.series.get(String(row.key));
    if (!entry || entry.points.length < MIN_POINTS || newWindow(resetMs(row.resetsAt), entry.reset))
        return null;
    return entry.points.slice(-SPARK_POINTS).map(p => p.pct);
}

// Puts `trend` on each window row whose title is a notify row's label (the
// two share their wording and order). A repeated label (a vendor-named
// scoped window) pairs the nth window with the nth notify row of that label.
// Rows are modified in place.
export function attachTrends(modelRows, notifyRows, trend) {
    if (!trend)
        return modelRows;
    const byLabel = new Map();
    for (const r of uniqueKeys(notifyRows)) {
        if (!byLabel.has(r.label))
            byLabel.set(r.label, []);
        byLabel.get(r.label).push(r);
    }
    for (const row of modelRows) {
        if (row.kind !== 'window')
            continue;
        const source = byLabel.get(row.title)?.shift();
        const points = source ? trendPoints(trend, source) : null;
        if (points)
            row.trend = points;
    }
    return modelRows;
}

// Dev-only (AI_USAGEBAR_FAKE_TREND): SPARK_POINTS samples per row, one every
// `stepMs` up to `now`, rising to each row's percent, so a fake window draws
// its line at once.
export function seedTrend(rows, now, stepMs = 15 * 60 * 1000) {
    const nowMs = now.getTime();
    let trend = emptyTrend();
    for (let k = 0; k < SPARK_POINTS; k++) {
        const share = 0.35 + 0.65 * ((k / (SPARK_POINTS - 1)) ** 0.85);
        const scaled = rows.map(row => ({...row, percent: typeof row.percent === 'number' ? row.percent * share : row.percent}));
        trend = recordTrend(trend, scaled, new Date(nowMs - (SPARK_POINTS - 1 - k) * stepMs));
    }
    return trend;
}

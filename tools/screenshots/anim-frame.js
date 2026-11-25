// Evaluated in the headless shell by capture.sh for each animation frame:
// sets the Anthropic windows to globalThis.__aiubFrame ({session, weekly,
// scoped, first}) and appends those readings to the trend, so the line grows
// with the usage. Dev only; reaches into indicator privates.
/* global Main */
(() => {
    const i = Main.panel.statusArea['ai-usagebar@wilfison'];
    const s = i._poller._results.get('anthropic').snapshot;
    const f = globalThis.__aiubFrame;
    const windows = {session: s.session, weekly: s.weekly, 'scoped:Fable': s.scoped[0]};
    const values = {session: f.session, weekly: f.weekly, 'scoped:Fable': f.scoped};
    const trend = i._trends.get('anthropic') ?? {series: new Map()};
    if (f.first)
        trend.series = new Map();
    const now = Date.now();
    for (const [key, win] of Object.entries(windows)) {
        win.utilizationPct = values[key];
        const entry = trend.series.get(key) ?? {reset: win.resetsAt.getTime(), points: []};
        const last = entry.points.at(-1)?.at ?? now - 3600 * 1000;
        entry.points = [...entry.points, {at: last + 60 * 1000, pct: values[key]}].slice(-20);
        trend.series.set(key, entry);
    }
    i._trends.set('anthropic', trend);
    i._paintSegment('anthropic');
    i._renderVendorSection('anthropic');
    return 'ok';
})();

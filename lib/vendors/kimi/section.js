import {vformat} from '../../format.js';
import {closingRows, pacedWindowRow, ICON_SESSION as ICON_WINDOW, ICON_WEEKLY} from '../section-common.js';

// A null `windowMs` (the monthly pool) is a row without pace.
function windowRow(icon, title, win, now, theme, _) {
    return pacedWindowRow({icon, title, pct: win.utilizationPct, resetsAt: win.resetsAt, windowMs: win.windowMs, now, theme, _, footnote: false});
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];

    if (snapshot.window)
        rows.push(windowRow(ICON_WINDOW, _('Window (5h)'), snapshot.window, now, theme, _));
    if (snapshot.weekly)
        rows.push(windowRow(ICON_WEEKLY, _('Weekly'), snapshot.weekly, now, theme, _));
    if (snapshot.monthly)
        rows.push(windowRow(ICON_WEEKLY, _('Monthly'), snapshot.monthly, now, theme, _));

    rows.push(...closingRows(meta, theme, _));

    // Translators: "Kimi" is a brand name, kept verbatim.
    const title = snapshot.plan ? vformat(_('Kimi %s'), snapshot.plan) : 'Kimi';
    return {title, plan: snapshot.plan, rows};
}

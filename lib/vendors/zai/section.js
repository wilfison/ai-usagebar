import {closingRows, noWindowsRow, pacedWindowRow, ICON_SESSION, ICON_WEEKLY} from '../section-common.js';

const ICON_MCP = 'starred-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    return pacedWindowRow({icon, title, pct: win.utilizationPct, resetsAt: win.resetsAt, windowMs: win.windowMs, now, theme, _});
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];

    if (snapshot.session)
        rows.push(windowRow(ICON_SESSION, _('Session (5h)'), snapshot.session, now, theme, _));
    if (snapshot.weekly)
        rows.push(windowRow(ICON_WEEKLY, _('Weekly'), snapshot.weekly, now, theme, _));
    if (snapshot.mcp)
        rows.push(windowRow(ICON_MCP, _('MCP tools (monthly)'), snapshot.mcp, now, theme, _));

    if (!snapshot.session && !snapshot.weekly && !snapshot.mcp)
        rows.push(noWindowsRow(_));

    rows.push(...closingRows(meta, theme, _));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

import {calc} from '../../pacing.js';
import {closingRows, noWindowsRow, windowRow as baseRow} from '../section-common.js';

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_MCP = 'starred-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = calc({usagePct: pct, reset: win.resetsAt, now, windowMs: win.windowMs});
    return baseRow({icon, title, pct, resetsAt: win.resetsAt, pace, now, theme, _});
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

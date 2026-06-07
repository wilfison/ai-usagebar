import {severityFor, severityColor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_MCP = 'starred-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = calc({usagePct: pct, reset: win.resetsAt, now, windowMs: win.windowMs});
    const reset = formatCountdown(win.resetsAt, now, _);
    return {
        kind: 'window',
        icon,
        title,
        pct,
        color: severityColor(severityFor(pct), theme),
        reset,
        subtitle: vformat(_('Resets in %s'), reset),
        paceGlyph: paceGlyph(pace.ratioPace),
        elapsedPct: pace.elapsedPct,
    };
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
        rows.push({kind: 'text', text: _('no usage windows reported'), tone: 'dim'});

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

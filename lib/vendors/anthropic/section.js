import {severityFor, severityColor} from '../../severity.js';
import {calc, paceGlyph} from '../../pacing.js';
import {fillColors} from '../../pace-fill.js';
import {format as formatCountdown} from '../../countdown.js';
import {vformat} from '../../format.js';
import {httpErrorRow, footerRow, wrapWords} from '../section-common.js';
import {SESSION_MS, WEEKLY_MS, fmtDollars, extraPercent} from './parser.js';

export {wrapWords};

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_SONNET = 'starred-symbolic';
const ICON_EXTRA = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, windowMs, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = windowMs === null
        ? null
        : calc({usagePct: pct, reset: win.resetsAt, now, windowMs});
    const reset = formatCountdown(win.resetsAt, now, _);
    const {base, over} = fillColors(pct, pace ? pace.elapsedPct : null, theme);
    return {
        kind: 'window',
        icon,
        title,
        pct,
        color: base,
        reset,
        subtitle: vformat(_('Resets in %s'), reset),
        paceGlyph: pace ? paceGlyph(pace.ratioPace) : '',
        ...(pace ? {elapsedPct: pace.elapsedPct, paceColor: over} : {}),
    };
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];

    rows.push(windowRow(ICON_SESSION, _('Session'), snapshot.session, SESSION_MS, now, theme, _));
    rows.push(windowRow(ICON_WEEKLY, _('Weekly'), snapshot.weekly, WEEKLY_MS, now, theme, _));
    if (snapshot.sonnet)
        rows.push(windowRow(ICON_SONNET, _('Sonnet only'), snapshot.sonnet, null, now, theme, _));

    // Model-scoped weekly caps (e.g. Fable). Same weekly window kind as above;
    // the title is the API's model display name, a brand label kept verbatim
    // (outside `_()`).
    for (const sw of snapshot.scoped ?? [])
        rows.push(windowRow(ICON_WEEKLY, sw.label, sw, WEEKLY_MS, now, theme, _));

    if (snapshot.extra) {
        const extraPct = extraPercent(snapshot.extra);
        rows.push({
            kind: 'gauge',
            icon: ICON_EXTRA,
            title: _('Extra usage'),
            pct: extraPct,
            value: fmtDollars(snapshot.extra.spentCents),
            subLine: vformat(_('Limit: %s'), fmtDollars(snapshot.extra.limitCents)),
            color: severityColor(severityFor(extraPct), theme),
        });
    }

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    // Translators: %s is the Anthropic plan name (e.g. "Max 5x") — kept verbatim.
    return {title: vformat(_('Claude %s'), snapshot.plan), plan: snapshot.plan, rows};
}

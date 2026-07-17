import {calc, paceGlyph} from '../../pacing.js';
import {fillColors} from '../../pace-fill.js';
import {format as formatCountdown} from '../../countdown.js';
import {vformat} from '../../format.js';
import {httpErrorRow, footerRow} from '../section-common.js';
import {pct, WEEKLY_MS, WINDOW_MS} from './parser.js';

const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_WINDOW = 'alarm-symbolic';

function windowRow(icon, title, block, windowMs, now, theme, _) {
    const utilizationPct = pct(block.used, block.limit);
    const pace = calc({usagePct: utilizationPct, reset: block.resetAt, now, windowMs});
    const reset = formatCountdown(block.resetAt, now, _);
    const {base, over} = fillColors(utilizationPct, pace.elapsedPct, theme);
    return {
        kind: 'window',
        icon,
        title,
        pct: utilizationPct,
        color: base,
        reset,
        subtitle: vformat(_('Resets in %s'), reset),
        paceGlyph: paceGlyph(pace.ratioPace),
        elapsedPct: pace.elapsedPct,
        paceColor: over,
    };
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];

    rows.push(windowRow(ICON_WEEKLY, _('Weekly'), snapshot.weekly, WEEKLY_MS, now, theme, _));
    if (snapshot.window.limit > 0)
        rows.push(windowRow(ICON_WINDOW, _('Window (5h)'), snapshot.window, WINDOW_MS, now, theme, _));

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    // Translators: "Kimi" is a brand name — kept verbatim.
    const title = snapshot.plan ? vformat(_('Kimi %s'), snapshot.plan) : 'Kimi';
    return {title, plan: snapshot.plan, rows};
}

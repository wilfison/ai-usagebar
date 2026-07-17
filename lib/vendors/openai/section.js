import {calc, paceGlyph} from '../../pacing.js';
import {fillColors} from '../../pace-fill.js';
import {format as formatCountdown} from '../../countdown.js';
import {vformat} from '../../format.js';
import {httpErrorRow, footerRow} from '../section-common.js';

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_CODE_REVIEW = 'system-run-symbolic';
const ICON_CREDITS = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = calc({usagePct: pct, reset: win.resetsAt, now, windowMs: win.windowMs});
    const reset = formatCountdown(win.resetsAt, now, _);
    const {base, over} = fillColors(pct, pace.elapsedPct, theme);
    return {
        kind: 'window',
        icon,
        title,
        pct,
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

    rows.push(windowRow(ICON_SESSION, _('Codex 5h'), snapshot.session, now, theme, _));
    rows.push(windowRow(ICON_WEEKLY, _('Codex weekly'), snapshot.weekly, now, theme, _));
    if (snapshot.codeReview)
        rows.push(windowRow(ICON_CODE_REVIEW, _('Code review (weekly)'), snapshot.codeReview, now, theme, _));

    const c = snapshot.credits;
    if (c) {
        rows.push({kind: 'text', icon: ICON_CREDITS, text: _('Credits'), tone: 'fg'});
        rows.push({kind: 'text', text: vformat(_('balance: %s'), c.unlimited ? _('unlimited') : c.balance), tone: 'dim'});
        if (c.approxLocalMessages)
            // Translators: %s-%s is an approximate count range (e.g. "100-200").
            rows.push({kind: 'text', text: vformat(_('~ %s-%s local messages'), c.approxLocalMessages[0], c.approxLocalMessages[1]), tone: 'dim'});
        if (c.approxCloudMessages)
            // Translators: %s-%s is an approximate count range (e.g. "30-50").
            rows.push({kind: 'text', text: vformat(_('~ %s-%s cloud messages'), c.approxCloudMessages[0], c.approxCloudMessages[1]), tone: 'dim'});
    }

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

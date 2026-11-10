import {calc} from '../../pacing.js';
import {format as formatCountdown, formatWithClock} from '../../countdown.js';
import {vformat, resetsAvailableText} from '../../format.js';
import {httpErrorRow, footerRow, groupHeading, resetCreditRows, paceFields} from '../section-common.js';

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_CODE_REVIEW = 'system-run-symbolic';
const ICON_CREDITS = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = calc({usagePct: pct, reset: win.resetsAt, now, windowMs: win.windowMs});
    return {
        kind: 'window',
        icon,
        title,
        pct,
        reset: formatCountdown(win.resetsAt, now, _),
        subtitle: formatWithClock(win.resetsAt, now, _),
        ...paceFields(pct, pace, theme, _),
    };
}

// "62500" → "62,500"; anything that is not a plain number passes through.
export function groupThousands(count) {
    const m = /^(-?)(\d+)(\.\d+)?$/u.exec(count);
    if (!m)
        return count;
    return `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}${m[3] ?? ''}`;
}

// The count rides on every usage response; the per-credit detail needs a
// second call, so a failed one leaves just the count. A null block was not
// reported at all; a stated zero is said out loud.
function resetRows(resetCredits, now, _, ngettext) {
    if (!resetCredits)
        return [];
    if (resetCredits.available === 0)
        return [groupHeading(_('Resets')), {kind: 'text', text: _('None available'), tone: 'dim'}];
    if (resetCredits.credits.length === 0)
        return [groupHeading(_('Resets')), {kind: 'text', text: resetsAvailableText(resetCredits.available, ngettext)}];
    return resetCreditRows(resetCredits.credits, now, _, _('Reset credit'));
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s, ngettext) {
    const rows = [];

    if (!snapshot.session && !snapshot.weekly) {
        rows.push({kind: 'text', text: _('no usage windows reported'), tone: 'dim'});
    } else {
        // With only one window, the other is named so its absence reads as the
        // response's, not ours.
        rows.push(snapshot.session
            ? windowRow(ICON_SESSION, _('Codex 5h'), snapshot.session, now, theme, _)
            : {kind: 'text', icon: ICON_SESSION, text: _('Codex 5h: not reported'), tone: 'dim'});
        rows.push(snapshot.weekly
            ? windowRow(ICON_WEEKLY, _('Codex weekly'), snapshot.weekly, now, theme, _)
            : {kind: 'text', icon: ICON_WEEKLY, text: _('Codex weekly: not reported'), tone: 'dim'});
    }
    if (snapshot.codeReview)
        rows.push(windowRow(ICON_CODE_REVIEW, _('Code review (weekly)'), snapshot.codeReview, now, theme, _));

    const c = snapshot.credits;
    if (c) {
        rows.push({kind: 'text', icon: ICON_CREDITS, text: _('Credits'), tone: 'fg'});
        rows.push({kind: 'text', text: vformat(_('balance: %s'), c.unlimited ? _('unlimited') : groupThousands(c.balance)), tone: 'dim'});
    }

    rows.push(...resetRows(snapshot.resetCredits, now, _, ngettext));

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

import {vformat, formatMoney} from '../../format.js';
import {format as formatCountdown, formatWithClock} from '../../countdown.js';
import {httpErrorRow, footerRow, paceFields} from '../section-common.js';
import {planLabel, windowPace} from './parser.js';

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_CREDITS = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    const pct = win.utilizationPct;
    return {
        kind: 'window',
        icon,
        title,
        pct,
        reset: formatCountdown(win.resetsAt, now, _),
        subtitle: formatWithClock(win.resetsAt, now, _),
        ...paceFields(pct, windowPace(win, now), theme, _),
    };
}

function creditRows(credits, _) {
    const rows = [
        {kind: 'text', icon: ICON_CREDITS, text: _('Credits'), tone: 'fg'},
        // Translators: "$45.00 remaining of $60.00": the monthly included credits.
        {kind: 'text', text: vformat(_('%s remaining of %s'), formatMoney(credits.balanceUsd), formatMoney(credits.allowanceUsd)), tone: 'dim'},
    ];
    if (credits.purchasedUsd !== null)
        rows.push({kind: 'text', text: vformat(_('Purchased credits: %s'), formatMoney(credits.purchasedUsd)), tone: 'dim'});
    return rows;
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];
    const windows = [
        ['session', ICON_SESSION, _('Session')],
        ['weekly', ICON_WEEKLY, _('Weekly')],
        ['monthly', ICON_WEEKLY, _('Monthly')],
    ];
    for (const [key, icon, title] of windows) {
        if (snapshot[key])
            rows.push(windowRow(icon, title, snapshot[key], now, theme, _));
    }
    if (rows.length === 0)
        rows.push({kind: 'text', text: _('no usage windows reported'), tone: 'dim'});

    if (snapshot.credits)
        rows.push(...creditRows(snapshot.credits, _));

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    // Translators: %s is the Ollama plan name from the prefs (e.g. "Pro"), kept verbatim.
    const title = snapshot.plan ? vformat(_('Ollama %s'), snapshot.plan) : planLabel(snapshot);
    return {title, plan: planLabel(snapshot), rows};
}

import {vformat, formatMoney} from '../../format.js';
import {closingRows, noWindowsRow, pacedWindowRow, ICON_SESSION, ICON_WEEKLY} from '../section-common.js';
import {planLabel} from './parser.js';

const ICON_CREDITS = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, now, theme, _) {
    return pacedWindowRow({icon, title, pct: win.utilizationPct, resetsAt: win.resetsAt, windowMs: win.windowMs, now, theme, _});
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
        rows.push(noWindowsRow(_));

    if (snapshot.credits)
        rows.push(...creditRows(snapshot.credits, _));

    rows.push(...closingRows(meta, theme, _));

    // Translators: %s is the Ollama plan name from the prefs (e.g. "Pro"), kept verbatim.
    const title = snapshot.plan ? vformat(_('Ollama %s'), snapshot.plan) : planLabel(snapshot);
    return {title, plan: planLabel(snapshot), rows};
}

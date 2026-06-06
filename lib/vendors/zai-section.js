/**
 * @file Pure Z.AI popup section-model builder. Produces, in order: the plan
 * title; a window row for each present window (session/weekly/MCP); a "no usage
 * windows reported" text row when all three are absent; an HTTP-error row; and
 * the footer.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor, severityColor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';

/** @type {string} Session window symbolic icon name. */
const ICON_SESSION = 'alarm-symbolic';
/** @type {string} Weekly window symbolic icon name. */
const ICON_WEEKLY = 'x-office-calendar-symbolic';
/** @type {string} MCP-tools window symbolic icon name. */
const ICON_MCP = 'starred-symbolic';

/**
 * Build a `window` row with severity color, countdown, and ratio pace glyph.
 * @param {string} icon
 * @param {string} title
 * @param {import('./zai-parse.js').UsageWindow} win
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @param {(s: string) => string} _ - gettext translator.
 * @returns {import('./anthropic-section.js').Row}
 */
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

/**
 * Turn a Z.AI snapshot + fetch metadata into the ordered popup section model.
 * @param {import('./zai-parse.js').ZaiSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @param {(s: string) => string} [_] - gettext translator; identity by default.
 * @returns {import('./anthropic-section.js').SectionModel}
 */
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

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
import {httpErrorRow, footerRow} from './section-common.js';

/** @type {string} Session window glyph. */
const ICON_SESSION = '󰔟';
/** @type {string} Weekly window glyph. */
const ICON_WEEKLY = '󰃰';
/** @type {string} MCP-tools window glyph. */
const ICON_MCP = '󰓹';

/**
 * Build a `window` row with severity color, countdown, and ratio pace glyph.
 * @param {string} icon
 * @param {string} title
 * @param {import('./zai-parse.js').UsageWindow} win
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {import('./anthropic-section.js').Row}
 */
function windowRow(icon, title, win, now, theme) {
    const pct = win.utilizationPct;
    const glyph = paceGlyph(calc({usagePct: pct, reset: win.resetsAt, now, windowMs: win.windowMs}).ratioPace);
    return {
        kind: 'window',
        icon,
        title,
        pct,
        color: severityColor(severityFor(pct), theme),
        reset: formatCountdown(win.resetsAt, now),
        paceGlyph: glyph,
    };
}

/**
 * Turn a Z.AI snapshot + fetch metadata into the ordered popup section model.
 * @param {import('./zai-parse.js').ZaiSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme) {
    const rows = [];

    if (snapshot.session)
        rows.push(windowRow(ICON_SESSION, 'Session (5h)', snapshot.session, now, theme));
    if (snapshot.weekly)
        rows.push(windowRow(ICON_WEEKLY, 'Weekly', snapshot.weekly, now, theme));
    if (snapshot.mcp)
        rows.push(windowRow(ICON_MCP, 'MCP tools (monthly)', snapshot.mcp, now, theme));

    if (!snapshot.session && !snapshot.weekly && !snapshot.mcp)
        rows.push({kind: 'text', text: 'no usage windows reported', tone: 'dim'});

    const err = httpErrorRow(meta, theme);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

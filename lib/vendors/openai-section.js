/**
 * @file Pure OpenAI/Codex popup section-model builder. Produces, in order: the
 * plan title; the Codex 5h + weekly window rows; a Code-review window row when
 * present; a Credits block (plain text rows, no bar) when present; an HTTP-error
 * row; and the footer.
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
/** @type {string} Code-review window glyph. */
const ICON_CODE_REVIEW = '󱦰';
/** @type {string} Credits glyph. */
const ICON_CREDITS = '󰄑';

/**
 * Build a `window` row with severity color, countdown, and ratio pace glyph.
 * @param {string} icon
 * @param {string} title
 * @param {import('./openai-parse.js').UsageWindow} win
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
 * Turn an OpenAI snapshot + fetch metadata into the ordered popup section model.
 * @param {import('./openai-parse.js').OpenAiSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme) {
    const rows = [];

    rows.push(windowRow(ICON_SESSION, 'Codex 5h', snapshot.session, now, theme));
    rows.push(windowRow(ICON_WEEKLY, 'Codex weekly', snapshot.weekly, now, theme));
    if (snapshot.codeReview)
        rows.push(windowRow(ICON_CODE_REVIEW, 'Code review (weekly)', snapshot.codeReview, now, theme));

    const c = snapshot.credits;
    if (c) {
        rows.push({kind: 'text', icon: ICON_CREDITS, text: 'Credits', tone: 'fg'});
        rows.push({kind: 'text', text: `balance: ${c.unlimited ? 'unlimited' : c.balance}`, tone: 'dim'});
        if (c.approxLocalMessages)
            rows.push({kind: 'text', text: `~ ${c.approxLocalMessages[0]}-${c.approxLocalMessages[1]} local messages`, tone: 'dim'});
        if (c.approxCloudMessages)
            rows.push({kind: 'text', text: `~ ${c.approxCloudMessages[0]}-${c.approxCloudMessages[1]} cloud messages`, tone: 'dim'});
    }

    const err = httpErrorRow(meta, theme);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta));

    return {title: snapshot.plan, plan: snapshot.plan, rows};
}

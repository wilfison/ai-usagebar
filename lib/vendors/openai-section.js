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
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';

/** @type {string} Session window symbolic icon name. */
const ICON_SESSION = 'alarm-symbolic';
/** @type {string} Weekly window symbolic icon name. */
const ICON_WEEKLY = 'x-office-calendar-symbolic';
/** @type {string} Code-review window symbolic icon name. */
const ICON_CODE_REVIEW = 'system-run-symbolic';
/** @type {string} Credits symbolic icon name. */
const ICON_CREDITS = 'utilities-system-monitor-symbolic';

/**
 * Build a `window` row with severity color, countdown, and ratio pace glyph.
 * @param {string} icon
 * @param {string} title
 * @param {import('./openai-parse.js').UsageWindow} win
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
 * Turn an OpenAI snapshot + fetch metadata into the ordered popup section model.
 * @param {import('./openai-parse.js').OpenAiSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @param {(s: string) => string} [_] - gettext translator; identity by default.
 * @returns {import('./anthropic-section.js').SectionModel}
 */
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

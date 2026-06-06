/**
 * @file Pure popup section-model builder. Turns an {@link AnthropicSnapshot} plus
 * fetch metadata into an ordered, fully-described list of rows (icons, titles,
 * pre-resolved severity colors, already-formatted countdown/pace/dollar text) so
 * the `gi://`-bound renderer can stay business-logic free. Re-exports the shared
 * greedy word-wrapper for callers/tests.
 *
 * No `gi://` imports — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor, severityColor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';
import {httpErrorRow, footerRow, wrapWords} from './section-common.js';
import {SESSION_MS, WEEKLY_MS, fmtDollars, extraPercent} from './anthropic-parse.js';

export {wrapWords};

/**
 * @typedef {object} FetchMeta
 * @property {boolean} stale - true when the served payload came from cache after
 *   a failed live fetch.
 * @property {?{code: number, body: string}} lastError - sidecar error from the
 *   last fetch, or null. `code === 0` means transport/schema and is not shown.
 * @property {?Date} fetchedAt - absolute instant the served payload was fetched,
 *   or null. Pinned to the fetch (never derived from `now`) so the footer stays
 *   fixed across live re-renders.
 */

/**
 * Vendor-neutral popup row. The `kind` selects which fields are read; the
 * renderer in `ui/vendorSection.js` maps each kind to St widgets.
 * @typedef {object} Row
 * @property {string} kind - 'window' | 'gauge' | 'text' | 'http-error' | 'footer'.
 * @property {string} [icon] - glyph (window/gauge/http-error; optional for text).
 * @property {string} [title] - row title (window/gauge).
 * @property {?number} [pct] - integer utilization driving the bar fill
 *   (window always a number; gauge draws the bar when a number, omits it when
 *   `null`).
 * @property {string} [color] - pre-resolved severity/explicit hex
 *   (window/gauge/http-error/text-with-color).
 * @property {string} [reset] - formatted countdown (window).
 * @property {string} [paceGlyph] - ratio pace glyph, '' when none (window).
 * @property {number} [elapsedPct] - integer 0–100 elapsed-position marker
 *   (window; omitted when the window has no length, e.g. Anthropic Sonnet).
 * @property {string} [value] - bold colored value line (gauge).
 * @property {string} [subLine] - optional dim line under the value (gauge).
 * @property {string} [text] - body text (text row).
 * @property {string} [tone] - 'fg' | 'dim' when no explicit `color` (text row).
 * @property {number} [code] - HTTP status code (http-error).
 * @property {string[]} [lines] - wrapped error body lines (http-error).
 * @property {string} [updated] - `HH:MM` or '—' (footer).
 */

/**
 * @typedef {object} SectionModel
 * @property {string} title - full header text rendered blue/bold (e.g.
 *   `Claude Max 5x`, `ChatGPT Plus`, `DeepSeek`).
 * @property {string} plan - plan label (retained for callers/tests).
 * @property {Row[]} rows - rows in render order.
 */

/** @type {string} Session window glyph. */
const ICON_SESSION = '󰔟';
/** @type {string} Weekly window glyph. */
const ICON_WEEKLY = '󰃰';
/** @type {string} Sonnet window glyph. */
const ICON_SONNET = '󱤔';
/** @type {string} Extra-usage glyph. */
const ICON_EXTRA = '󰄑';

/**
 * Build a `window` row (session/weekly/sonnet) with severity color, countdown,
 * and ratio pace glyph already resolved.
 * @param {string} icon
 * @param {string} title
 * @param {import('./anthropic-parse.js').UsageWindow} win
 * @param {?number} windowMs - window length for pace math, or null to skip the
 *   pace glyph (sonnet shows none).
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {Row}
 */
function windowRow(icon, title, win, windowMs, now, theme) {
    const pct = win.utilizationPct;
    const pace = windowMs === null
        ? null
        : calc({usagePct: pct, reset: win.resetsAt, now, windowMs});
    return {
        kind: 'window',
        icon,
        title,
        pct,
        color: severityColor(severityFor(pct), theme),
        reset: formatCountdown(win.resetsAt, now),
        paceGlyph: pace ? paceGlyph(pace.ratioPace) : '',
        ...(pace ? {elapsedPct: pace.elapsedPct} : {}),
    };
}

/**
 * Turn a snapshot + fetch metadata into the ordered popup section model.
 *
 * Rows appear as: Session → Weekly → Sonnet? → Extra(gauge)? → HTTP-error? →
 * Footer. Sonnet/Extra rows are emitted only when present; the HTTP-error row only when
 * `meta.lastError.code !== 0`. The footer is pinned to `meta.fetchedAt` and is
 * never derived from `now`, so it stays fixed across live re-renders.
 * @param {AnthropicSnapshot} snapshot
 * @param {FetchMeta} meta
 * @param {Date} now - current instant (countdown/pace math).
 * @param {import('../theme.js').Theme} theme
 * @returns {SectionModel}
 */
export function buildSection(snapshot, meta, now, theme) {
    const rows = [];

    rows.push(windowRow(ICON_SESSION, 'Session', snapshot.session, SESSION_MS, now, theme));
    rows.push(windowRow(ICON_WEEKLY, 'Weekly', snapshot.weekly, WEEKLY_MS, now, theme));
    if (snapshot.sonnet)
        rows.push(windowRow(ICON_SONNET, 'Sonnet only', snapshot.sonnet, null, now, theme));

    if (snapshot.extra) {
        const extraPct = extraPercent(snapshot.extra);
        rows.push({
            kind: 'gauge',
            icon: ICON_EXTRA,
            title: 'Extra usage',
            pct: extraPct,
            value: fmtDollars(snapshot.extra.spentCents),
            subLine: `󰀓  Limit: ${fmtDollars(snapshot.extra.limitCents)}`,
            color: severityColor(severityFor(extraPct), theme),
        });
    }

    const err = httpErrorRow(meta, theme);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta));

    return {title: `Claude ${snapshot.plan}`, plan: snapshot.plan, rows};
}

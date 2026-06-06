/**
 * @file Pure popup section-model builder. Turns an {@link AnthropicSnapshot} plus
 * fetch metadata into an ordered, fully-described list of rows (icons, titles,
 * pre-resolved severity colors, already-formatted countdown/pace/dollar text) so
 * the `gi://`-bound renderer can stay business-logic free. Also exports the
 * greedy word-wrapper used for HTTP-error bodies.
 *
 * No `gi://` imports — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor, severityColor} from '../severity.js';
import {calc, paceGlyph} from '../pacing.js';
import {format as formatCountdown} from '../countdown.js';
import {localTimeHm} from '../format.js';
import {SESSION_MS, WEEKLY_MS, fmtDollars, extraPercent} from './anthropic-parse.js';

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
 * @typedef {object} Row
 * @property {string} kind - 'window' | 'extra' | 'http-error' | 'footer'.
 * @property {string} [icon] - glyph for the row (window/extra/http-error).
 * @property {string} [title] - row title (window/extra).
 * @property {number} [pct] - integer utilization, drives the bar fill (window/extra).
 * @property {string} [color] - pre-resolved severity hex (window/extra/http-error).
 * @property {string} [reset] - formatted countdown (window).
 * @property {string} [paceGlyph] - ratio pace glyph, '' when none (window).
 * @property {string} [spent] - formatted dollars spent (extra).
 * @property {string} [limit] - formatted dollars cap (extra).
 * @property {number} [code] - HTTP status code (http-error).
 * @property {string[]} [lines] - wrapped error body lines (http-error).
 * @property {string} [updated] - `HH:MM` or '—' (footer).
 */

/**
 * @typedef {object} SectionModel
 * @property {string} plan - plan label for the header.
 * @property {Row[]} rows - rows in render order.
 */

/** @type {number} Column width the HTTP-error body wraps to. */
const ERROR_WRAP_COLS = 35;

/** @type {string} Session window glyph. */
const ICON_SESSION = '󰔟';
/** @type {string} Weekly window glyph. */
const ICON_WEEKLY = '󰃰';
/** @type {string} Sonnet window glyph. */
const ICON_SONNET = '󱤔';
/** @type {string} Extra-usage glyph. */
const ICON_EXTRA = '󰄑';
/** @type {string} Server-error (>= 500) glyph. */
const ICON_ERR_SERVER = '󰅚';
/** @type {string} Client-error (< 500) glyph. */
const ICON_ERR_CLIENT = '󰀪';

/**
 * Greedy word-wrap: split `text` on whitespace and pack words into lines no
 * longer than `width` columns. A single word longer than `width` occupies its
 * own (over-long) line rather than being split mid-word.
 * @param {string} text
 * @param {number} width
 * @returns {string[]} wrapped lines; `[]` for empty/whitespace-only input.
 */
export function wrapWords(text, width) {
    const words = String(text ?? '').split(/\s+/u).filter(w => w.length > 0);
    if (words.length === 0)
        return [];

    const lines = [];
    let line = '';
    for (const w of words) {
        if (line === '')
            line = w;
        else if (line.length + 1 + w.length <= width)
            line += ` ${w}`;
        else {
            lines.push(line);
            line = w;
        }
    }
    lines.push(line);
    return lines;
}

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
    const glyph = windowMs === null
        ? ''
        : paceGlyph(calc({usagePct: pct, reset: win.resetsAt, now, windowMs}).ratioPace);
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
 * Turn a snapshot + fetch metadata into the ordered popup section model.
 *
 * Rows appear as: Session → Weekly → Sonnet? → Extra? → HTTP-error? → Footer.
 * Sonnet/Extra rows are emitted only when present; the HTTP-error row only when
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
            kind: 'extra',
            icon: ICON_EXTRA,
            title: 'Extra usage',
            pct: extraPct,
            spent: fmtDollars(snapshot.extra.spentCents),
            limit: fmtDollars(snapshot.extra.limitCents),
            color: severityColor(severityFor(extraPct), theme),
        });
    }

    if (meta.lastError && meta.lastError.code !== 0) {
        const {code, body} = meta.lastError;
        const server = code >= 500;
        rows.push({
            kind: 'http-error',
            icon: server ? ICON_ERR_SERVER : ICON_ERR_CLIENT,
            color: server ? theme.red : theme.orange,
            code,
            lines: wrapWords(body, ERROR_WRAP_COLS),
        });
    }

    rows.push({
        kind: 'footer',
        updated: meta.fetchedAt ? localTimeHm(meta.fetchedAt) : '—',
    });

    return {plan: snapshot.plan, rows};
}

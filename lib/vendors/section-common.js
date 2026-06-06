/**
 * @file Shared, vendor-neutral popup-section helpers: the greedy word-wrapper
 * for HTTP-error bodies, and the `http-error` / `footer` row builders every
 * vendor's section uses identically. Pure — no `gi://` import.
 */

import {localTimeHm} from '../format.js';

/** @type {number} Column width the HTTP-error body wraps to. */
const ERROR_WRAP_COLS = 35;

/** @type {string} Server-error (>= 500) symbolic icon name. */
export const ICON_ERR_SERVER = 'dialog-error-symbolic';
/** @type {string} Client-error (< 500) symbolic icon name. */
export const ICON_ERR_CLIENT = 'dialog-warning-symbolic';
/** @type {string} Footer "updated" symbolic icon name. */
export const ICON_FOOTER = 'emblem-synchronizing-symbolic';

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
 * Build the `http-error` row from fetch metadata, or null when there is no
 * displayable error (`code === 0` means transport/schema and is not shown).
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {import('../theme.js').Theme} theme
 * @returns {?import('./anthropic-section.js').Row}
 */
export function httpErrorRow(meta, theme) {
    if (!meta.lastError || meta.lastError.code === 0)
        return null;
    const {code, body} = meta.lastError;
    const server = code >= 500;
    return {
        kind: 'http-error',
        icon: server ? ICON_ERR_SERVER : ICON_ERR_CLIENT,
        color: server ? theme.red : theme.orange,
        code,
        lines: wrapWords(body, ERROR_WRAP_COLS),
    };
}

/**
 * Build the always-present `footer` row, pinned to the served payload's fetch
 * instant (never derived from `now`, so it stays fixed across live re-renders).
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @returns {import('./anthropic-section.js').Row}
 */
export function footerRow(meta) {
    return {
        kind: 'footer',
        icon: ICON_FOOTER,
        updated: meta.fetchedAt ? localTimeHm(meta.fetchedAt) : '—',
    };
}

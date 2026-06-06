/**
 * @file Pure DeepSeek popup section-model builder. Produces, in order: the
 * `DeepSeek` title; a Balance gauge with no bar (`pct: null`) showing the colored
 * balance + a dim granted/topped-up sub-line; an availability text row; an
 * HTTP-error row; and the footer.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityColor} from '../severity.js';
import {httpErrorRow, footerRow} from './section-common.js';
import {deepseekSeverity, formatMoney} from './deepseek-parse.js';

/** @type {string} Balance glyph. */
const ICON_BALANCE = '󰢗';
/** @type {string} Availability glyph. */
const ICON_AVAIL = '󰛴';

/**
 * Turn a DeepSeek snapshot + fetch metadata into the ordered popup model.
 * @param {import('./deepseek-parse.js').DeepseekSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme) {
    const rows = [];
    const cur = snapshot.currency;

    rows.push({
        kind: 'gauge',
        icon: ICON_BALANCE,
        title: 'Balance',
        pct: null, // no bar — DeepSeek is a raw balance, not a utilization %
        value: formatMoney(snapshot.balance, cur),
        subLine: `granted ${formatMoney(snapshot.granted, cur)} · topped-up ${formatMoney(snapshot.toppedUp, cur)}`,
        color: severityColor(deepseekSeverity(snapshot), theme),
    });

    rows.push({
        kind: 'text',
        icon: ICON_AVAIL,
        text: snapshot.isAvailable ? 'API available' : 'API unavailable',
        tone: 'dim',
    });

    const err = httpErrorRow(meta, theme);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta));

    return {title: 'DeepSeek', plan: 'DeepSeek', rows};
}

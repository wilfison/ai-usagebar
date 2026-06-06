/**
 * @file Pure DeepSeek popup section-model builder. Produces, in order: the
 * `DeepSeek` title; a Balance gauge with no bar (`pct: null`) showing the colored
 * balance + a dim granted/topped-up sub-line; an availability text row; an
 * HTTP-error row; and the footer.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityColor} from '../severity.js';
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';
import {deepseekSeverity, formatMoney} from './deepseek-parse.js';

/** @type {string} Balance symbolic icon name. */
const ICON_BALANCE = 'utilities-system-monitor-symbolic';
/** @type {string} Availability symbolic icon name. */
const ICON_AVAIL = 'emblem-ok-symbolic';

/**
 * Turn a DeepSeek snapshot + fetch metadata into the ordered popup model.
 * @param {import('./deepseek-parse.js').DeepseekSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @param {(s: string) => string} [_] - gettext translator; identity by default.
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];
    const cur = snapshot.currency;

    rows.push({
        kind: 'gauge',
        icon: ICON_BALANCE,
        title: _('Balance'),
        pct: null, // no bar — DeepSeek is a raw balance, not a utilization %
        value: formatMoney(snapshot.balance, cur),
        // Translators: %s are money amounts (granted credit, topped-up credit).
        subLine: vformat(_('granted %s · topped-up %s'),
            formatMoney(snapshot.granted, cur), formatMoney(snapshot.toppedUp, cur)),
        color: severityColor(deepseekSeverity(snapshot), theme),
    });

    rows.push({
        kind: 'text',
        icon: ICON_AVAIL,
        text: snapshot.isAvailable ? _('API available') : _('API unavailable'),
        tone: 'dim',
    });

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    // DeepSeek is a brand name — kept verbatim, not wrapped for translation.
    return {title: 'DeepSeek', plan: 'DeepSeek', rows};
}

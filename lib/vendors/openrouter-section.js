/**
 * @file Pure OpenRouter popup section-model builder. Produces, in order: the
 * label title; a Balance gauge (bar on consumed-%); a Usage block; a Per-key
 * limit block when a limit is set; a tier badge; an HTTP-error row; and the
 * footer.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor, severityColor} from '../severity.js';
import {httpErrorRow, footerRow} from './section-common.js';
import {balance, consumedPct, formatMoney} from './openrouter-parse.js';

/** @type {string} Balance glyph. */
const ICON_BALANCE = '󰢗';
/** @type {string} Usage glyph. */
const ICON_USAGE = '󰸘';
/** @type {string} Per-key limit glyph. */
const ICON_LIMIT = '󱁻';
/** @type {string} Tier badge glyph. */
const ICON_TIER = '󰓹';

/**
 * Turn an OpenRouter snapshot + fetch metadata into the ordered popup model.
 * @param {import('./openrouter-parse.js').OpenRouterSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme) {
    const rows = [];
    const pct = consumedPct(snapshot);

    rows.push({
        kind: 'gauge',
        icon: ICON_BALANCE,
        title: 'Balance',
        pct,
        value: formatMoney(balance(snapshot)),
        subLine: `${formatMoney(snapshot.totalUsage)} of ${formatMoney(snapshot.totalCredits)} used (${pct}%)`,
        color: severityColor(severityFor(pct), theme),
    });

    rows.push({kind: 'text', icon: ICON_USAGE, text: 'Usage', tone: 'fg'});
    rows.push({
        kind: 'text',
        text: `today ${formatMoney(snapshot.usageDaily)} · week ${formatMoney(snapshot.usageWeekly)} · month ${formatMoney(snapshot.usageMonthly)}`,
        tone: 'dim',
    });

    if (snapshot.limit !== null) {
        const rem = snapshot.limitRemaining ?? 0;
        rows.push({kind: 'text', icon: ICON_LIMIT, text: 'Per-key limit', tone: 'fg'});
        rows.push({
            kind: 'text',
            text: `${formatMoney(rem)} of ${formatMoney(snapshot.limit)} remaining`,
            tone: 'dim',
        });
    }

    rows.push({kind: 'text', icon: ICON_TIER, text: snapshot.isFreeTier ? 'free tier' : 'paid tier', tone: 'dim'});

    const err = httpErrorRow(meta, theme);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta));

    return {title: snapshot.label, plan: snapshot.label, rows};
}

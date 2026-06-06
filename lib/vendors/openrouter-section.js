/**
 * @file Pure OpenRouter popup section-model builder. Produces, in order: the
 * label title; a Balance gauge (bar on consumed-%); a Usage block; a Per-key
 * limit block when a limit is set; a tier badge; an HTTP-error row; and the
 * footer.
 *
 * No `gi://` import — runs under plain `gjs -m`/node for unit testing.
 */

import {severityFor, severityColor} from '../severity.js';
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';
import {balance, consumedPct, formatMoney} from './openrouter-parse.js';

/** @type {string} Balance symbolic icon name. */
const ICON_BALANCE = 'utilities-system-monitor-symbolic';
/** @type {string} Usage symbolic icon name. */
const ICON_USAGE = 'utilities-system-monitor-symbolic';
/** @type {string} Per-key limit symbolic icon name. */
const ICON_LIMIT = 'security-high-symbolic';
/** @type {string} Tier badge symbolic icon name. */
const ICON_TIER = 'starred-symbolic';

/**
 * Turn an OpenRouter snapshot + fetch metadata into the ordered popup model.
 * @param {import('./openrouter-parse.js').OpenRouterSnapshot} snapshot
 * @param {import('./anthropic-section.js').FetchMeta} meta
 * @param {Date} now
 * @param {import('../theme.js').Theme} theme
 * @param {(s: string) => string} [_] - gettext translator; identity by default.
 * @returns {import('./anthropic-section.js').SectionModel}
 */
export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = [];
    const pct = consumedPct(snapshot);

    rows.push({
        kind: 'gauge',
        icon: ICON_BALANCE,
        title: _('Balance'),
        pct,
        value: formatMoney(balance(snapshot)),
        // Translators: %s are money amounts, %s%% is the consumed percentage.
        subLine: vformat(_('%s of %s used (%s%%)'),
            formatMoney(snapshot.totalUsage), formatMoney(snapshot.totalCredits), pct),
        color: severityColor(severityFor(pct), theme),
    });

    rows.push({kind: 'text', icon: ICON_USAGE, text: _('Usage'), tone: 'fg'});
    rows.push({
        kind: 'text',
        // Translators: %s are money amounts for the day, week and month to date.
        text: vformat(_('today %s · week %s · month %s'),
            formatMoney(snapshot.usageDaily), formatMoney(snapshot.usageWeekly), formatMoney(snapshot.usageMonthly)),
        tone: 'dim',
    });

    if (snapshot.limit !== null) {
        const rem = snapshot.limitRemaining ?? 0;
        rows.push({kind: 'text', icon: ICON_LIMIT, text: _('Per-key limit'), tone: 'fg'});
        rows.push({
            kind: 'text',
            // Translators: %s are money amounts (remaining of limit).
            text: vformat(_('%s of %s remaining'), formatMoney(rem), formatMoney(snapshot.limit)),
            tone: 'dim',
        });
    }

    rows.push({kind: 'text', icon: ICON_TIER, text: snapshot.isFreeTier ? _('free tier') : _('paid tier'), tone: 'dim'});

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    return {title: snapshot.label, plan: snapshot.label, rows};
}

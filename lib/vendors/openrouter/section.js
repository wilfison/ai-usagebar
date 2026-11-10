import {severityColor} from '../../severity.js';
import {vformat, formatMoney} from '../../format.js';
import {httpErrorRow, footerRow, groupHeading} from '../section-common.js';
import {balance, consumedPct, openrouterSeverity} from './parser.js';

const ICON_BALANCE = 'utilities-system-monitor-symbolic';
const ICON_USAGE = 'utilities-system-monitor-symbolic';
const ICON_LIMIT = 'security-high-symbolic';
const ICON_TIER = 'starred-symbolic';

const pluralEn = (singular, plural, n) => (n === 1 ? singular : plural);

function recentModelRows(models, _, ngettext) {
    if (!models || models.length === 0)
        return [];
    const rows = [groupHeading(_('Recent models'))];
    for (const m of models) {
        const requests = vformat(ngettext('%d request', '%d requests', m.requests), m.requests);
        // Translators: "$1.25 · 42 requests": a model's recent spend, then its request count.
        const subtitle = m.costUsd > 0 ? vformat(_('%s · %s'), formatMoney(m.costUsd), requests) : requests;
        rows.push({kind: 'text', text: m.name, subtitle});
    }
    return rows;
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s, ngettext = pluralEn) {
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
        color: severityColor(openrouterSeverity(snapshot), theme),
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
    rows.push(...recentModelRows(snapshot.recentModels, _, ngettext));

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    return {title: snapshot.label, plan: snapshot.label, rows};
}

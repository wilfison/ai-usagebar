import {severityColor} from '../severity.js';
import {vformat} from '../format.js';
import {httpErrorRow, footerRow} from './section-common.js';
import {deepseekSeverity, formatMoney} from './deepseek-parse.js';

const ICON_BALANCE = 'utilities-system-monitor-symbolic';
const ICON_AVAIL = 'emblem-ok-symbolic';

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

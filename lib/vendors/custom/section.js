import {formatWithClock} from '../../countdown.js';
import {vformat} from '../../format.js';
import {closingRows, windowRow} from '../section-common.js';
import {metricPace, figure} from './parser.js';

const ICON_METRIC = 'utilities-system-monitor-symbolic';
const ICON_TEXT = 'dialog-information-symbolic';

// "12 of 100", "$12.50 of $60.00": a used + limit metric's amount.
export function amountText(amount, _ = s => s) {
    // Translators: "12 of 100": the used amount of a limit; both may be money.
    return vformat(_('%s of %s'), figure(amount.used, amount.currency), figure(amount.limit, amount.currency));
}

function metricRow(metric, now, theme, _) {
    const pace = metricPace(metric, now);
    const footnote = metric.amount ? amountText(metric.amount, _) : '';
    const subtitle = [footnote, formatWithClock(metric.resetsAt, now, _)].filter(Boolean).join(' · ');
    return windowRow({icon: ICON_METRIC, title: metric.label, pct: metric.pct, resetsAt: metric.resetsAt, pace, now, theme, _, subtitle});
}

// Labels and values come from the user's mapping and API, already sanitized;
// they are data, so they stay outside `_()`.
export function buildSection(snapshot, meta, now, theme, _ = (s) => s) {
    const rows = snapshot.metrics.map(m => metricRow(m, now, theme, _));
    for (const t of snapshot.texts)
        rows.push({kind: 'text', icon: ICON_TEXT, text: `${t.label}: ${t.value}`, tone: 'fg'});

    rows.push(...closingRows(meta, theme, _));

    const title = snapshot.plan || snapshot.name || _('Custom provider');
    return {title, plan: snapshot.plan, rows};
}

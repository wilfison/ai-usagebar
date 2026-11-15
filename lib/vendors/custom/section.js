import {formatWithClock} from '../../countdown.js';
import {closingRows, windowRow} from '../section-common.js';
import {metricPace} from './parser.js';

const ICON_METRIC = 'utilities-system-monitor-symbolic';
const ICON_TEXT = 'dialog-information-symbolic';

function metricRow(metric, now, theme, _) {
    const pace = metricPace(metric, now);
    const subtitle = [metric.footnote, formatWithClock(metric.resetsAt, now, _)].filter(Boolean).join(' · ');
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

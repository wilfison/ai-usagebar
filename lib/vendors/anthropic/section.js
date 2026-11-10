import {severityFor, severityColor} from '../../severity.js';
import {calc} from '../../pacing.js';
import {format as formatCountdown, formatWithClock} from '../../countdown.js';
import {vformat, localTimeHms} from '../../format.js';
import {httpErrorRow, footerRow, wrapWords, resetCreditRows, paceFields, spacerRow, groupHeading, groupedUsage} from '../section-common.js';
import {SHOWN_SESSIONS} from '../../context/parser.js';
import {SESSION_MS, WEEKLY_MS, formatExtraAmount, extraPercent} from './parser.js';

export {wrapWords};

const ICON_SESSION = 'alarm-symbolic';
const ICON_WEEKLY = 'x-office-calendar-symbolic';
const ICON_SONNET = 'starred-symbolic';
const ICON_EXTRA = 'utilities-system-monitor-symbolic';

function windowRow(icon, title, win, windowMs, now, theme, _) {
    const pct = win.utilizationPct;
    const pace = windowMs === null
        ? null
        : calc({usagePct: pct, reset: win.resetsAt, now, windowMs});
    return {
        kind: 'window',
        icon,
        title,
        pct,
        reset: formatCountdown(win.resetsAt, now, _),
        subtitle: formatWithClock(win.resetsAt, now, _),
        ...paceFields(pct, pace, theme, _),
    };
}

const pluralEn = (singular, plural, n) => (n === 1 ? singular : plural);
const tokenFormat = new Intl.NumberFormat();

function formatTokens(n) {
    return tokenFormat.format(n);
}

// One grouped row per recent Claude Code session: how much of the context
// window its latest response used, coloured like a quota.
function sessionRow(session, theme, _) {
    const name = session.title ?? vformat(_('session %s'), session.sessionId.slice(0, 8));
    const label = `${session.project ?? _('unknown project')} · ${name}`;
    const model = session.model ?? _('unknown model');
    const lastActive = localTimeHms(session.lastActive);
    const u = session.usage;
    let percent = 0, valueText, detail;
    if (u.state === 'tokens' && u.percent !== null) {
        percent = Math.min(100, u.percent);
        valueText = `${percent}%`;
        // Translators: "84,000 / 200,000 tokens · claude-opus-5 · last active 14:03:12".
        detail = vformat(_('%s / %s tokens · %s · last active %s'),
            formatTokens(u.inputTokens), formatTokens(u.windowTokens), model, lastActive);
    } else if (u.state === 'tokens') {
        valueText = vformat(_('%s tokens'), formatTokens(u.inputTokens));
        detail = vformat(_('window size is not configured · %s · last active %s'), model, lastActive);
    } else if (u.state === 'compacted') {
        valueText = _('compacted');
        detail = vformat(_('compacted · waiting for the next response · %s · last active %s'), model, lastActive);
    } else {
        valueText = _('unknown');
        detail = vformat(_('context usage unavailable · %s · last active %s'), model, lastActive);
    }
    // Keyed by session id: two sessions can share a title.
    return groupedUsage({
        group: `session:${session.sessionId}`,
        label,
        percent,
        valueText,
        detail,
        severity: severityFor(percent),
    }, theme);
}

function sessionRows(scan, theme, _, ngettext) {
    if (!scan)
        return [];
    const rows = [spacerRow(), groupHeading(_('Sessions'))];
    if (scan.error) {
        rows.push({kind: 'text', text: scan.error, tone: 'dim'});
        return rows;
    }
    if (scan.sessions.length === 0) {
        rows.push({kind: 'text', text: _('no recent Claude Code sessions'), tone: 'dim'});
        return rows;
    }
    for (const session of scan.sessions.slice(0, SHOWN_SESSIONS))
        rows.push(sessionRow(session, theme, _));
    const more = scan.discovered - Math.min(scan.sessions.length, SHOWN_SESSIONS);
    if (more > 0)
        rows.push({kind: 'text', text: vformat(ngettext('… and %d more session', '… and %d more sessions', more), more), tone: 'dim'});
    return rows;
}

export function buildSection(snapshot, meta, now, theme, _ = (s) => s, ngettext = pluralEn) {
    const rows = [];

    rows.push(windowRow(ICON_SESSION, _('Session'), snapshot.session, SESSION_MS, now, theme, _));
    rows.push(windowRow(ICON_WEEKLY, _('Weekly'), snapshot.weekly, WEEKLY_MS, now, theme, _));
    if (snapshot.sonnet)
        rows.push(windowRow(ICON_SONNET, _('Sonnet only'), snapshot.sonnet, null, now, theme, _));

    // Model-scoped weekly caps (e.g. Fable). Same weekly window kind as above;
    // the title is the API's model display name, a brand label kept verbatim
    // (outside `_()`).
    for (const sw of snapshot.scoped ?? [])
        rows.push(windowRow(ICON_WEEKLY, sw.label, sw, WEEKLY_MS, now, theme, _));

    const extra = snapshot.extra;
    if (extra && extra.limitCents === null) {
        // No cap means no denominator: the spend is shown without a bar (no `pct`).
        rows.push({
            kind: 'gauge',
            icon: ICON_EXTRA,
            title: _('Extra usage'),
            value: formatExtraAmount(extra, extra.spentCents),
            subLine: _('Limit: none reported'),
            color: null,
        });
    } else if (extra) {
        const extraPct = extraPercent(extra);
        rows.push({
            kind: 'gauge',
            icon: ICON_EXTRA,
            title: _('Extra usage'),
            pct: extraPct,
            value: formatExtraAmount(extra, extra.spentCents),
            subLine: vformat(_('Limit: %s'), formatExtraAmount(extra, extra.limitCents)),
            color: severityColor(severityFor(extraPct), theme),
        });
    }

    const grants = (snapshot.resets ?? []).map(r => ({title: r.label, expiresAt: r.endsAt}));
    rows.push(...resetCreditRows(grants, now, _));

    rows.push(...sessionRows(meta.sessions, theme, _, ngettext));

    const err = httpErrorRow(meta, theme, _);
    if (err)
        rows.push(err);

    rows.push(footerRow(meta, _));

    // Translators: %s is the Anthropic plan name (e.g. "Max"), kept verbatim.
    return {title: vformat(_('Claude %s'), snapshot.plan), plan: snapshot.plan, rows};
}

import {localTimeHm, vformat, sanitizeUntrusted} from '../format.js';
import {formatBackoff, format as formatCountdown, localDateHm} from '../countdown.js';
import {severityColor, severityFor} from '../severity.js';
import {paceGlyph, PaceState, PaceVerdict} from '../pacing.js';
import {fillColors} from '../pace-fill.js';
import {RATE_LIMITED, AUTH_REJECTED, INVALID_MAPPING} from './fetch-common.js';

const ERROR_WRAP_COLS = 35;

export const ICON_ERR_SERVER = 'dialog-error-symbolic';
export const ICON_ERR_CLIENT = 'dialog-warning-symbolic';
export const ICON_FOOTER = 'emblem-synchronizing-symbolic';

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

export function rateLimitedText(retryInMs, _ = (s) => s) {
    return vformat(_('rate limited; next attempt in %s'), formatBackoff(retryInMs, _));
}

export function authRejectedText(status, _ = (s) => s) {
    return vformat(_('HTTP %d: authentication rejected; credentials may be missing, expired, or invalid'), status);
}

function isAuthStatus(code) {
    return code === 401 || code === 403;
}

// The text for an `ok:false` error result; a coded error is translated here
// because main.js has no translator.
export function errorText(res, _ = (s) => s) {
    if (res.code === RATE_LIMITED)
        return rateLimitedText(res.retryInMs, _);
    if (res.code === AUTH_REJECTED)
        return authRejectedText(res.status, _);
    if (res.code === INVALID_MAPPING)
        return _('The custom provider mapping or extra headers are not valid; fix them in the preferences.');
    return res.message;
}

export function httpErrorRow(meta, theme, _ = (s) => s) {
    if (!meta.lastError || meta.lastError.code === 0)
        return null;
    if (meta.lastError.code === RATE_LIMITED) {
        return {
            kind: 'http-error',
            icon: ICON_ERR_CLIENT,
            color: theme.orange,
            code: RATE_LIMITED,
            status: rateLimitedText(meta.lastError.retryInMs, _),
            lines: [],
        };
    }
    const {code, body} = meta.lastError;
    const server = code >= 500;
    // A 401/403 body is never shown, even one persisted by an older release.
    const auth = isAuthStatus(code);
    return {
        kind: 'http-error',
        icon: server ? ICON_ERR_SERVER : ICON_ERR_CLIENT,
        color: server ? theme.red : theme.orange,
        code,
        status: auth ? authRejectedText(code, _) : vformat(_('HTTP %s'), code),
        lines: auth ? [] : wrapWords(sanitizeUntrusted(body), ERROR_WRAP_COLS),
    };
}

export function footerRow(meta, _ = (s) => s) {
    const updated = meta.fetchedAt ? localTimeHm(meta.fetchedAt) : '-';
    return {
        kind: 'footer',
        icon: ICON_FOOTER,
        updated,
        text: vformat(_('Updated %s'), updated),
    };
}

export function spacerRow() {
    return {kind: 'spacer'};
}

export function groupHeading(label) {
    return {kind: 'group-heading', label};
}

// A null severity paints the fill muted (a breakdown share, not a quota).
export function groupedUsage({group = '', label, percent, valueText, detail = null, severity = null}, theme) {
    return {
        kind: 'grouped',
        key: `${group}\u0000${label}`,
        label,
        pct: percent,
        valueText,
        detail,
        severity,
        color: severity ? severityColor(severity, theme) : theme.dim,
        trackColor: theme.barEmpty,
    };
}

export function expiryText(expiresAt, now, _ = (s) => s) {
    if (expiresAt === null || expiresAt === undefined)
        return _('no expiry reported');
    if (expiresAt.getTime() <= now.getTime())
        return vformat(_('expired %s'), localDateHm(expiresAt));
    // Translators: "expires Oct 22 16:00 (3d 4h)": the date and time, then a countdown.
    return vformat(_('expires %s (%s)'), localDateHm(expiresAt), formatCountdown(expiresAt, now, _));
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// A credit without an expiry sorts first, as upstream does.
function byExpiry(a, b) {
    return (a.expiresAt?.getTime() ?? -Infinity) - (b.expiresAt?.getTime() ?? -Infinity);
}

// Banked resets as a Resets heading plus one row per credit, soonest first:
// the title (or `fallbackTitle`) over the expiry, or the expiry alone.
export function resetCreditRows(credits, now, _ = (s) => s, fallbackTitle = null) {
    if (!credits || credits.length === 0)
        return [];
    const rows = [groupHeading(_('Resets'))];
    for (const c of [...credits].sort(byExpiry)) {
        const expiry = capitalize(expiryText(c.expiresAt, now, _));
        const title = c.title ?? fallbackTitle;
        rows.push(title ? {kind: 'text', text: title, subtitle: expiry} : {kind: 'text', text: expiry});
    }
    return rows;
}

// The line under a paced window; the raw English labels of pacing.js never
// reach the UI.
export function paceFootnote(pacing, _ = (s) => s) {
    switch (pacing.state) {
    case PaceState.ESTIMATING:
        return _('Estimating…');
    case PaceState.LIMIT:
        return _('Limit reached');
    case PaceState.NEUTRAL:
        return '';
    }
    if (pacing.verdict === PaceVerdict.CRITICAL && pacing.runsOutAt)
        // Translators: "Limit in 1h 04m": when the window runs out at the current pace.
        return vformat(_('Limit in %s'), formatCountdown(pacing.runsOutAt, pacing.now, _));
    if (pacing.verdict === PaceVerdict.OVER || pacing.verdict === PaceVerdict.CRITICAL)
        // Translators: "~20% over pace": projected usage at the reset beyond 100%.
        return vformat(_('~%d%% over pace'), Math.round(pacing.projectedPct - 100));
    let label = _('on track');
    if (pacing.delta > 0)
        label = vformat(_('%dpts ahead'), pacing.delta);
    else if (pacing.delta < 0)
        label = vformat(_('%dpts under'), -pacing.delta);
    // Translators: "42% elapsed · 3pts ahead": how much of the window has passed, then the pace.
    return vformat(_('%d%% elapsed · %s'), pacing.elapsedPct, label);
}

// The colour and pace fields of a window row. `pace` null means the window
// is not paced at all; a marker is drawn only while pace is meaningful.
export function paceFields(pct, pace, theme, _ = (s) => s, {footnote = true} = {}) {
    if (!pace)
        return {color: severityColor(severityFor(pct), theme), paceGlyph: ''};
    const marked = pace.state === PaceState.OK || pace.state === PaceState.ESTIMATING;
    const {base, over} = fillColors(pct, pace.verdict ?? null, theme);
    const fields = {color: base, paceGlyph: paceGlyph(pace.ratioPace, pace.state)};
    if (marked) {
        fields.elapsedPct = pace.elapsedPct;
        if (over)
            fields.paceColor = over;
    }
    if (footnote)
        fields.paceFootnote = paceFootnote(pace, _);
    return fields;
}

import {localTimeHm, vformat} from '../format.js';

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

export function httpErrorRow(meta, theme, _ = (s) => s) {
    if (!meta.lastError || meta.lastError.code === 0)
        return null;
    const {code, body} = meta.lastError;
    const server = code >= 500;
    return {
        kind: 'http-error',
        icon: server ? ICON_ERR_SERVER : ICON_ERR_CLIENT,
        color: server ? theme.red : theme.orange,
        code,
        status: vformat(_('HTTP %s'), code),
        lines: wrapWords(body, ERROR_WRAP_COLS),
    };
}

export function footerRow(meta, _ = (s) => s) {
    const updated = meta.fetchedAt ? localTimeHm(meta.fetchedAt) : '—';
    return {
        kind: 'footer',
        icon: ICON_FOOTER,
        updated,
        text: vformat(_('Updated %s'), updated),
    };
}

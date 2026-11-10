const PLACEHOLDER = /\{([^{}]+)\}/gu;

const CONVERSION = /%([0-9]*)([sd%])/gu;

export function vformat(template, ...args) {
    let i = 0;
    return String(template).replace(CONVERSION, (_whole, width, spec) => {
        if (spec === '%')
            return '%';
        const v = args[i++];
        if (spec === 'd') {
            let s = String(Math.trunc(Number(v)));
            if (width)
                s = s.padStart(Number(width), width.startsWith('0') ? '0' : ' ');
            return s;
        }
        return String(v);
    });
}

export function substitute(template, values) {
    const get = values instanceof Map
        ? (k) => (values.has(k) ? values.get(k) : null)
        : (k) => (Object.hasOwn(values, k) ? values[k] : null);

    return template.replace(PLACEHOLDER, (whole, key) => {
        const v = get(key);
        return v === null || v === undefined ? whole : String(v);
    });
}

const PACE_TOKEN = /\{[a-z0-9_]*_pace(?:_indicator)?\}/u;

// The session pace arrow after the label, unless there is none to show or the
// format already places a pace token itself.
export function withPaceArrow(text, barFormat, values) {
    const arrow = values instanceof Map ? values.get('session_pace') : values?.session_pace;
    if (!arrow || PACE_TOKEN.test(barFormat ?? ''))
        return text;
    return `${text} ${arrow}`;
}

export const STALE_MARK = ' ⏸';

// The panel label text: the bar format filled in, then the optional pace
// arrow, then the stale mark.
export function panelLabel(barFormat, values, {paceArrows = false, stale = false} = {}) {
    let text = substitute(barFormat, values);
    if (paceArrows)
        text = withPaceArrow(text, barFormat, values);
    return stale ? text + STALE_MARK : text;
}

export function tooltipRows(template, values) {
    if (template === null || template === undefined || template.trim() === '')
        return [];

    const lines = substitute(template, values).split('\n');
    if (lines.length && lines[0] === '')
        lines.shift();
    if (lines.length && lines[lines.length - 1] === '')
        lines.pop();

    return lines.map(text => ({kind: 'text', text}));
}

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

export function localTimeHm(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function localTimeHms(date) {
    return `${localTimeHm(date)}:${pad2(date.getSeconds())}`;
}

const CURRENCY_SYMBOLS = Object.freeze({USD: '$', BRL: 'R$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥'});

// The one table deciding what a currency looks like; `currency` null is legacy USD.
// An unknown code trails the number instead of borrowing a wrong symbol.
export function withCurrency(sign, number, currency) {
    const symbol = currency === null ? '$' : CURRENCY_SYMBOLS[currency];
    return symbol ? `${sign}${symbol}${number}` : `${sign}${number} ${currency}`;
}

// The sign sits ahead of the symbol (-$5.71) and is decided from the rounded
// magnitude, so neither -0 nor a sub-cent debt reads as -$0.00.
export function formatMoney(amount, currency = 'USD') {
    const magnitude = Math.abs(amount).toFixed(2);
    const sign = amount < 0 && magnitude !== '0.00' ? '-' : '';
    return withCurrency(sign, magnitude, currency);
}

// Direction overrides and isolates that could reorder the surrounding layout.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/gu;
// C0 and C1 controls plus DEL, except \n (kept) and \t / \r (become spaces).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const OTHER_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

// Text from a vendor (a response body, a plan or model name) is data, not a
// terminal or layout program: strip what could restyle or reorder the popup.
export function sanitizeUntrusted(s, max = 4096) {
    const clean = String(s ?? '')
        .replace(/[\t\r]/gu, ' ')
        .replace(OTHER_CONTROLS, '')
        .replace(BIDI_CONTROLS, '');
    return Array.from(clean).slice(0, max).join('');
}

export const PARTIAL_ECHO_NOTE = "The provider's answer quoted the key, so it is not shown.";
const ECHO_WINDOW = 8;

// A provider can quote the key it was sent (Z.AI puts it in `msg`). Exact
// copies become `[key]`; if any 8 consecutive characters of it survive, the
// answer quoted it in part, so the whole text is replaced.
export function redactSecret(text, secret) {
    if (typeof text !== 'string' || !secret)
        return text;
    const redacted = text.split(secret).join('[key]');
    const chars = Array.from(secret);
    for (let i = 0; i + ECHO_WINDOW <= chars.length; i++) {
        if (redacted.includes(chars.slice(i, i + ECHO_WINDOW).join('')))
            return PARTIAL_ECHO_NOTE;
    }
    return redacted;
}

const MAX_RESET_TITLE_CHARS = 80;
const CONTROL_CHAR = /\p{Cc}/u;

// A reset grant's title is shown only when it is plausible; a long or
// control-bearing one is dropped rather than trimmed.
export function checkedResetTitle(v) {
    if (typeof v !== 'string')
        return null;
    const title = v.trim();
    if (title === '' || Array.from(title).length > MAX_RESET_TITLE_CHARS || CONTROL_CHAR.test(title))
        return null;
    return sanitizeUntrusted(title);
}

const pluralEn = (singular, plural, n) => (n === 1 ? singular : plural);

export function resetsAvailableText(n, ngettext = pluralEn) {
    return vformat(ngettext('%d reset available', '%d resets available', n), n);
}

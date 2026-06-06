/**
 * @file Tooltip/label formatting helpers — placeholder substitution and
 * "updated at" timestamps. Pure JS; no GJS imports so the tests can run
 * under plain node.
 */

const PLACEHOLDER = /\{([^{}]+)\}/gu;

/**
 * Replace `{key}` placeholders in a template. Missing/null/undefined values
 * leave the original placeholder text in place.
 * @param {string} template - text containing `{key}` placeholders.
 * @param {Map<string, *> | Record<string, *>} values - lookup of placeholder names.
 * @returns {string}
 */
export function substitute(template, values) {
    const get = values instanceof Map
        ? (k) => (values.has(k) ? values.get(k) : null)
        : (k) => (Object.hasOwn(values, k) ? values[k] : null);

    return template.replace(PLACEHOLDER, (whole, key) => {
        const v = get(key);
        return v === null || v === undefined ? whole : String(v);
    });
}

/**
 * Build additive popup `text` rows from a `tooltip-format` template. Substitutes
 * placeholders (unknown keys pass through per {@link substitute}), splits the
 * result on newlines, and drops a single leading and trailing blank line so a
 * template like `"\n{plan}\n"` yields one row. An empty/whitespace-only/null
 * template yields no rows, preserving the built-in structured layout.
 * @param {?string} template - the `tooltip-format` value (null when unset).
 * @param {Map<string, *> | Record<string, *>} values - placeholder lookup.
 * @returns {Array<{kind: 'text', text: string}>} rows in order, possibly empty.
 */
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

/**
 * Zero-pad a small non-negative integer to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format a local time as `HH:MM`.
 * @param {Date} date
 * @returns {string}
 */
export function localTimeHm(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Format a local time as `HH:MM:SS`.
 * @param {Date} date
 * @returns {string}
 */
export function localTimeHms(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * "Updated at" stamp at minute precision.
 * @param {Date} now - current instant.
 * @param {?number} cacheAgeMs - age of the cached payload in ms; null/undefined → '—'.
 * @returns {string} `HH:MM` or '—'.
 */
export function updatedAtHm(now, cacheAgeMs) {
    if (cacheAgeMs === null || cacheAgeMs === undefined)
        return '—';
    return localTimeHm(new Date(now.getTime() - cacheAgeMs));
}

/**
 * "Updated at" stamp at second precision.
 * @param {Date} now - current instant.
 * @param {?number} cacheAgeMs - age of the cached payload in ms; null/undefined → '—'.
 * @returns {string} `HH:MM:SS` or '—'.
 */
export function updatedAtHms(now, cacheAgeMs) {
    if (cacheAgeMs === null || cacheAgeMs === undefined)
        return '—';
    return localTimeHms(new Date(now.getTime() - cacheAgeMs));
}

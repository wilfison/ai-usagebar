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

const PLACEHOLDER = /\{([^{}]+)\}/gu;

export function substitute(template, values) {
    const get = values instanceof Map
        ? (k) => (values.has(k) ? values.get(k) : null)
        : (k) => (Object.hasOwn(values, k) ? values[k] : null);

    return template.replace(PLACEHOLDER, (whole, key) => {
        const v = get(key);
        return v === null || v === undefined ? whole : String(v);
    });
}

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

export function localTimeHm(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function localTimeHms(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function updatedAtHm(now, cacheAgeMs) {
    if (cacheAgeMs === null || cacheAgeMs === undefined)
        return '—';
    return localTimeHm(new Date(now.getTime() - cacheAgeMs));
}

export function updatedAtHms(now, cacheAgeMs) {
    if (cacheAgeMs === null || cacheAgeMs === undefined)
        return '—';
    return localTimeHms(new Date(now.getTime() - cacheAgeMs));
}

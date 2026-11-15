import {VENDOR_IDS} from './vendors.js';

export function emptyToNull(s) {
    return s === '' ? null : s;
}

export function resolveApiKey(vendorLabel, envName, inline, getenv) {
    if (envName) {
        const fromEnv = getenv(envName);
        if (fromEnv)
            return fromEnv;
    }
    if (inline)
        return inline;
    const where = `the inline API key for ${vendorLabel} in the extension preferences.`;
    throw new Error(envName
        ? `${vendorLabel}: no API key; export ${envName} or set ${where}`
        : `${vendorLabel}: no API key; set ${where}`);
}

// An optional key: env first, then inline, else null (never an error).
export function resolveOptionalKey(envName, inline, getenv) {
    const fromEnv = envName ? getenv(envName) : null;
    return fromEnv || inline || null;
}

export function isEnabled(snapshot, id) {
    return snapshot.vendors[id]?.enabled === true;
}

export function enabledVendors(snapshot) {
    return VENDOR_IDS.filter(id => isEnabled(snapshot, id));
}

export function normalizePrimary(snapshot) {
    if (isEnabled(snapshot, snapshot.primaryVendor))
        return snapshot.primaryVendor;
    const enabled = enabledVendors(snapshot);
    return enabled.length > 0 ? enabled[0] : 'anthropic';
}

export function normalizeActive(snapshot) {
    if (isEnabled(snapshot, snapshot.activeVendor))
        return snapshot.activeVendor;
    return normalizePrimary(snapshot);
}

export function cycleVendor(enabledIds, current, dir) {
    if (enabledIds.length === 0)
        return current;
    const idx = enabledIds.indexOf(current);
    if (idx === -1)
        return dir >= 0 ? enabledIds[0] : enabledIds[enabledIds.length - 1];
    const next = (idx + dir + enabledIds.length) % enabledIds.length;
    return enabledIds[next];
}

// The vendors pinned to the panel that are enabled, in VENDOR_IDS order.
function pinnedEnabled(snapshot) {
    const pinned = snapshot.panelVendors ?? [];
    return VENDOR_IDS.filter(id => pinned.includes(id) && isEnabled(snapshot, id));
}

export function isPinnedMode(snapshot) {
    return pinnedEnabled(snapshot).length > 0;
}

// One panel segment per id; without a pinned enabled vendor, the active one alone.
export function panelVendors(snapshot) {
    const pinned = pinnedEnabled(snapshot);
    return pinned.length > 0 ? pinned : [normalizeActive(snapshot)];
}

// What the poll tick fetches: every segment, plus the active vendor so its
// expanded popup section never opens without data.
export function pollVendors(snapshot) {
    const ids = panelVendors(snapshot);
    const active = normalizeActive(snapshot);
    return ids.includes(active) ? ids : [...ids, active];
}

export function withPinned(list, id, on) {
    return VENDOR_IDS.filter(v => (v === id ? on : list.includes(v)));
}

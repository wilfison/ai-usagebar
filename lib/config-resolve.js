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
    throw new Error(
        `${vendorLabel}: no API key — export ${envName} or set the inline ` +
        `API key for ${vendorLabel} in the extension preferences.`
    );
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

// What a GSettings change asks of the indicator. `primary-vendor` is handled
// before this: it first forces `active-vendor`, whose own change lands here.

export const Effect = Object.freeze({
    INTERVAL: 'interval',
    UPDATE_CHECK: 'update-check',
    SYNC: 'sync',
});

const EVERY_SECTION_KEYS = new Set(['tooltip-format', 'show-pace-marker']);

// SYNC re-resolves the poll set and repaints: every built section for the
// appearance keys (colors also rebuild the theme), else the active one.
export function settingsEffect(key) {
    if (key === 'refresh-interval')
        return {kind: Effect.INTERVAL};
    if (key === 'update-check-enabled')
        return {kind: Effect.UPDATE_CHECK};
    const color = key.startsWith('color-');
    return {kind: Effect.SYNC, rebuildTheme: color, allSections: color || EVERY_SECTION_KEYS.has(key)};
}

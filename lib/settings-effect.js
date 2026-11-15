// What a GSettings change asks of the indicator. `primary-vendor` is handled
// before this: it first forces `active-vendor`, whose own change lands here.

export const Effect = Object.freeze({
    INTERVAL: 'interval',
    UPDATE_CHECK: 'update-check',
    SYNC: 'sync',
});

// SYNC re-resolves the poll set and repaints the cards; colors also rebuild
// the theme.
export function settingsEffect(key) {
    if (key === 'refresh-interval')
        return {kind: Effect.INTERVAL};
    if (key === 'update-check-enabled')
        return {kind: Effect.UPDATE_CHECK};
    return {kind: Effect.SYNC, rebuildTheme: key.startsWith('color-')};
}

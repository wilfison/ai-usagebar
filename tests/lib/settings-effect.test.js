import system from 'system';

import {settingsEffect, settingsEffects, Effect} from '../../lib/settings-effect.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';

describe('settingsEffect', () => {
    it('the refresh interval only re-arms the timer', () => assertDeepEqual(settingsEffect('refresh-interval'), {kind: Effect.INTERVAL}));
    it('the update check only re-checks', () => assertDeepEqual(settingsEffect('update-check-enabled'), {kind: Effect.UPDATE_CHECK}));
    it('a color rebuilds the theme and repaints', () => {
        assertDeepEqual(settingsEffect('color-high'), {kind: Effect.SYNC, rebuildTheme: true});
    });
    for (const key of ['tooltip-format', 'show-pace-marker', 'active-vendor', 'panel-vendors', 'bar-format', 'zai-enabled', 'custom-name']) {
        it(`${key} syncs and repaints`, () => {
            assertDeepEqual(settingsEffect(key), {kind: Effect.SYNC, rebuildTheme: false});
        });
    }
    it('Effect is frozen', () => assertEqual(Object.isFrozen(Effect), true));
});

describe('settingsEffects (a batch of changed keys)', () => {
    it('nothing changed asks for nothing', () =>
        assertDeepEqual(settingsEffects([]), {interval: false, updateCheck: false, sync: false, rebuildTheme: false}));
    it('an interval change alone does not repaint', () =>
        assertDeepEqual(settingsEffects(['refresh-interval']), {interval: true, updateCheck: false, sync: false, rebuildTheme: false}));
    it('a reset of every key asks for each effect once', () => {
        const keys = ['refresh-interval', 'update-check-enabled', 'color-low', 'color-high', 'bar-format', 'zai-enabled'];
        assertDeepEqual(settingsEffects(keys), {interval: true, updateCheck: true, sync: true, rebuildTheme: true});
    });
    it('a sync key without colors keeps the theme', () =>
        assertDeepEqual(settingsEffects(['bar-format', 'update-check-enabled']), {interval: false, updateCheck: true, sync: true, rebuildTheme: false}));
});

system.exit(summary());

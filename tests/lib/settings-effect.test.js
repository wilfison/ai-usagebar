import system from 'system';

import {settingsEffect, Effect} from '../../lib/settings-effect.js';
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

system.exit(summary());

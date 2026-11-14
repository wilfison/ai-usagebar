import system from 'system';

import {FetchGuard} from '../../lib/fetch-guard.js';
import {describe, it, assertEqual, summary} from '../_assert.js';

describe('FetchGuard', () => {
    it('a lone run is current and settles without a rerun', () => {
        const g = new FetchGuard();
        const t = g.begin();
        assertEqual(g.busy, true);
        assertEqual(g.isCurrent(t), true);
        assertEqual(g.end(t), false);
        assertEqual(g.busy, false);
    });

    it('requests made while busy coalesce into one pending rerun', () => {
        const g = new FetchGuard();
        const t = g.begin();
        assertEqual(g.begin(), null);
        assertEqual(g.begin(), null);
        assertEqual(g.pending, true);
        assertEqual(g.end(t), true);
        assertEqual(g.pending, false);
        assertEqual(g.busy, false);
    });

    it('a settled token is not released twice', () => {
        const g = new FetchGuard();
        const t = g.begin();
        g.end(t);
        const next = g.begin();
        assertEqual(g.end(t), false);
        assertEqual(g.busy, true);
        assertEqual(g.end(next), false);
    });

    it('a null token is never current', () =>
        assertEqual(new FetchGuard().isCurrent(null), false));
});

system.exit(summary());

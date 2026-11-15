// Every vendor's last FetchResult and when it was fetched, and the fetch
// slot that coalesces overlapping refreshes. Pure: the fetch itself (`run`)
// and what a result triggers (`onStart`, `onResult`) are injected.
import {FetchGuard} from './fetch-guard.js';
import {loading} from './vendors/fetch-common.js';

export class VendorPoller {
    // `run(id)` answers `{res, ...}` (the rest reaches `onResult`);
    // `isPolled(id)` says whether a coalesced rerun is still wanted.
    constructor({run, isPolled, onStart = () => {}, onResult = () => {}, now = () => Date.now()}) {
        this._run = run;
        this._isPolled = isPolled;
        this._onStart = onStart;
        this._onResult = onResult;
        this._now = now;
        this._guards = new Map();       // vendorId -> FetchGuard
        this._results = new Map();      // vendorId -> FetchResult
        this._fetchedAt = new Map();    // vendorId -> Date, pinned to the real fetch instant
        this._pendingAll = new Set();   // vendorIds whose coalesced rerun came from "Refresh all"
        this._destroyed = false;
    }

    result(id) {
        return this._results.get(id);
    }

    fetchedAt(id) {
        return this._fetchedAt.get(id);
    }

    // [id, FetchResult] for every vendor with one.
    entries() {
        return [...this._results];
    }

    // A Loading… state for a vendor with nothing yet, so its card is never empty.
    seed(id) {
        if (!this._results.has(id))
            this._results.set(id, loading());
    }

    // One fetch for `id`, coalesced with any already in flight for it. `all`
    // (from "Refresh all") reruns a coalesced request even for a vendor no
    // longer polled, and reaches `onResult` so it can notify.
    async refresh(id, {all = false} = {}) {
        if (this._destroyed)
            return;
        const guard = this._guardFor(id);
        const token = guard.begin();
        if (token === null) {
            if (all)
                this._pendingAll.add(id);
            return;
        }

        this._onStart(id);
        let out;
        try {
            out = await this._run(id);
        } catch (e) {
            out = {res: {ok: false, kind: 'error', message: e?.message ?? String(e)}};
        }
        if (this._destroyed)
            return;

        const again = guard.end(token);
        this._results.set(id, out.res);
        if (out.res.ok)
            this._fetchedAt.set(id, new Date(this._now() - out.res.cacheAgeMs));
        this._onResult(id, out, {all});

        // A rerun for a vendor no longer polled could only repaint from the TTL cache.
        const rerunAll = this._pendingAll.delete(id);
        if (again && (rerunAll || this._isPolled(id)))
            await this.refresh(id, {all: rerunAll});
    }

    _guardFor(id) {
        let guard = this._guards.get(id);
        if (!guard) {
            guard = new FetchGuard();
            this._guards.set(id, guard);
        }
        return guard;
    }

    destroy() {
        this._destroyed = true;
        this._guards.clear();
        this._pendingAll.clear();
        this._results.clear();
        this._fetchedAt.clear();
    }
}

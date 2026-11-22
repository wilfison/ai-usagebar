import GLib from 'gi://GLib';

import {
    parseFakePct, parseFakeErrorVendors, parseFakeDelayMs, fakeResult, fakeHttpFailure,
    FAKE_PCT_ENV, FAKE_ERROR_ENV, FAKE_DELAY_ENV,
} from '../lib/debug.js';
import {VENDOR_IDS} from '../lib/vendors.js';
import {parseFakeIncident, fakeIncident, FAKE_INCIDENT_ENV} from '../lib/incident.js';

// Runs a vendor fetch, reshaped by the dev overrides when set:
// AI_USAGEBAR_FAKE_PCT=<0..100> answers with a synthetic snapshot,
// AI_USAGEBAR_FAKE_ERROR=<id[:stale]|*,...> fails those vendors' fetches,
// AI_USAGEBAR_FAKE_DELAY_MS=<ms> holds every fetch that long first and
// AI_USAGEBAR_FAKE_INCIDENT=<severity> answers every status page with an
// incident. Without FAKE_PCT a failed vendor's real fetch runs against an
// HTTP 503, so its own stale fallback and sidecars are exercised.
export class DevFetch {
    constructor() {
        this._fakePct = parseFakePct(GLib.getenv(FAKE_PCT_ENV));
        this._fakeErrors = parseFakeErrorVendors(GLib.getenv(FAKE_ERROR_ENV), VENDOR_IDS);
        this._fakeDelayMs = parseFakeDelayMs(GLib.getenv(FAKE_DELAY_ENV));
        this._fakeIncident = parseFakeIncident(GLib.getenv(FAKE_INCIDENT_ENV));
        this._delayIds = new Set();
        if (this._fakePct !== null)
            log(`ai-usagebar: ${FAKE_PCT_ENV}=${this._fakePct}, overriding usage fetch`);
        if (this._fakeErrors !== null)
            log(`ai-usagebar: ${FAKE_ERROR_ENV}=${[...this._fakeErrors].map(([id, f]) => `${id}:${f}`).join(',')}, failing those fetches`);
        if (this._fakeDelayMs !== null)
            log(`ai-usagebar: ${FAKE_DELAY_ENV}=${this._fakeDelayMs}, delaying every fetch`);
        if (this._fakeIncident !== null)
            log(`ai-usagebar: ${FAKE_INCIDENT_ENV}=${this._fakeIncident}, faking every status page`);
    }

    async run(adapter, ctx) {
        if (this._fakeDelayMs !== null)
            await this._delay(this._fakeDelayMs);
        const failure = this._fakeErrors?.get(adapter.id) ?? null;
        if (this._fakePct !== null && typeof adapter.fakeSnapshot === 'function')
            return fakeResult(failure, () => adapter.fakeSnapshot(this._fakePct, new Date(), ctx.config));
        if (failure !== null)
            return adapter.fetchSnapshot({...ctx, http: () => Promise.resolve(fakeHttpFailure())});
        return adapter.fetchSnapshot(ctx);
    }

    // A status page lookup, or the fake incident when set.
    incident(id, run) {
        return this._fakeIncident !== null ? Promise.resolve(fakeIncident(id, this._fakeIncident)) : run();
    }

    _delay(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._delayIds.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._delayIds.add(id);
        });
    }

    // A pending delay never resolves: its fetch was dropped with the indicator.
    destroy() {
        for (const id of this._delayIds)
            GLib.Source.remove(id);
        this._delayIds.clear();
    }
}

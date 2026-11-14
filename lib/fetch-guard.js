// One vendor's fetch slot: at most one run in flight, and a request made
// meanwhile coalesced into a single `pending` rerun.
export class FetchGuard {
    constructor() {
        this._token = 0;
        this._busy = false;
        this.pending = false;
    }

    get busy() {
        return this._busy;
    }

    // A token for the new run, or null when one is in flight (the request is
    // then remembered as `pending`, to run with the settings current at `end`).
    begin() {
        if (this._busy) {
            this.pending = true;
            return null;
        }
        this._busy = true;
        return ++this._token;
    }

    isCurrent(token) {
        return token !== null && token === this._token;
    }

    // Settle `token`'s run; true when a coalesced request should run now.
    end(token) {
        if (!this.isCurrent(token))
            return false;
        this._busy = false;
        const again = this.pending;
        this.pending = false;
        return again;
    }
}

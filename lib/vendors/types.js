/**
 * @file Vendor-neutral fetch-result types shared by every vendor orchestrator
 * and the indicator. JSDoc-only — this module declares the {@link FetchResult}
 * discriminated union once so each `lib/vendors/<vendor>.js` aligns with the same
 * shape (the `snapshot` payload is vendor-specific, hence `*`). No runtime
 * exports and no `gi://` import — pure JSDoc.
 */

/**
 * @typedef {object} FetchOk
 * @property {true} ok
 * @property {*} snapshot - the vendor's normalized snapshot.
 * @property {boolean} stale - true when served from cache after a failure.
 * @property {?{code: number, body: string}} lastError - sidecar error, if any.
 * @property {number} cacheAgeMs - age of the served payload (0 for a live fetch).
 */

/**
 * @typedef {object} FetchLoading
 * @property {false} ok
 * @property {'loading'} kind - transient failure with no usable cache.
 */

/**
 * @typedef {object} FetchError
 * @property {false} ok
 * @property {'error'} kind - credential/config/hard failure with no usable cache.
 * @property {string} message
 */

/**
 * @typedef {FetchOk | FetchLoading | FetchError} FetchResult
 */

export {};

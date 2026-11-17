---
type: Contract
title: Fetch pipeline
description: runFetch() is the shared fetch state machine; every vendor resolves to a FetchResult and never throws.
tags: [cache, errors, polling]
generated:
  by: claude/opus-5-5
  at: 2026-11-17T12:00:00Z
sources:
  - id: fetch-common
    title: lib/vendors/fetch-common.js
    resource: lib/vendors/fetch-common.js
  - id: fetch-guard
    title: lib/fetch-guard.js
    resource: lib/fetch-guard.js
  - id: vendor-poller
    title: lib/vendor-poller.js
    resource: lib/vendor-poller.js
---

# Overview

Each vendor's `fetchSnapshot` is a call to `runFetch()`.[^fetch-common] Before it, the adapter and `main.js` stop early on missing credentials (`apiKeyFetch` / `guardedFetch`, the OAuth credential read) or, for the custom provider, an invalid URL or mapping. Then `runFetch()` steps, in order:

1. **Fresh cache**: a payload under 60 s old is returned without HTTP (a corrupt one falls through).
2. **Backoff**: inside a 429 window no request is made ([snapshot cache](/architecture/cache.md)).
3. **`authorize`** hook: the OAuth refresh (`authorizeOAuth()`, shared by both OAuth vendors: an empty refresh token is never sent, a blank access token stops with a login hint; with `retiredRefreshContinues`, used by Anthropic only, a token-endpoint 4xx other than 429 clears `.last_error` and goes on with the current access token), settled by `settleRefresh()`; a refusal returns stale-or-error (stale-or-`loading` when the refresh itself hit a transport error).
4. **Request**: a transport error (network down, timeout, cancel) returns stale-or-`loading`.
5. **Non-2xx**: marks the cache stale, records the HTTP error in `.last_error`, returns stale-or-error with the vendor's `errorExtras`.
6. **Parse** (before any cache write): a parse error also marks stale and writes `.last_error` with code 0.
7. **`enrich`** hook, then **write** the projected snapshot.

Other hooks: `httpErrorBody` and `errorExtras`. "Stale-or-X" means the cached payload if usable (`staleResult`), else X. HTTP timeout is 10 s. Each fetch is also serialized per cache directory (`withMutex`); every vendor's `fetchSnapshot` is built by `vendorFetch()`, which adds the mutex and the redaction below. GETs go through `httpGet()` and the optional side requests (Kimi `/me`, OpenAI reset credits, OpenRouter `/activity`) through `optionalRequest()`, whose failure never costs the fetch. The API-key vendors and the custom provider also run inside `redactedFetch`, which keeps every secret it was handed out of the cache and the result. The OAuth vendors use `redactedRun` with the tokens read from their credentials file, plus any a refresh rotates in.

# FetchResult

An implicit discriminated union (there is no types module):

| Shape | Meaning |
| --- | --- |
| `{ok:true, snapshot, stale, lastError, cacheAgeMs}` | Data; `stale` when served from cache after a failure |
| `{ok:false, kind:'loading'}` | No result yet, or a transport failure with no usable cache |
| `{ok:false, kind:'error', message?, code?, status?, retryInMs?, ...}` | Failure; vendor `errorExtras` (e.g. `plan`) may ride along |

`code` is `rate-limited` (no `message`, carries `retryInMs`), `auth-rejected`, `invalid-mapping`, `no-access-token` or `token-refresh-failed`. The OAuth vendors add `loginCommand` to their errors, so a rejected token, a failed refresh or a signed-out file says which command signs in again. `main.js` has no translator, so the code becomes text later in `errorText()` in `section-common.js`. A network failure with an empty or expired cache therefore shows "Loading…", not an error.

# One fetch per vendor

`lib/fetch-guard.js` gives each vendor one slot: one fetch in flight, requests made meanwhile coalesced into one rerun.[^fetch-guard] `VendorPoller` in `lib/vendor-poller.js` owns those slots for the indicator, with each vendor's last result and real fetch instant; the fetch and what a result triggers are injected, so it is unit-tested.[^vendor-poller] The rerun is dropped if the vendor left the poll set and "Refresh all" did not ask for it. How results reach the screen is in [panel and popup](/architecture/panel-and-popup.md).

---
type: Component
title: Snapshot cache
description: Per-vendor cache directory holding the projected snapshot plus stale, last-error and retry-after sidecars.
tags: [cache, errors]
generated:
  by: claude/fable-5-2
  at: 2026-11-15T18:18:59Z
sources:
  - id: cache
    title: lib/cache.js
    resource: lib/cache.js
  - id: fetch-common
    title: lib/vendors/fetch-common.js
    resource: lib/vendors/fetch-common.js
---

# Layout

Under `$XDG_CACHE_HOME/ai-usagebar/` (usually `~/.cache/ai-usagebar/`), each vendor has a directory with `usage.json` plus `.stale`, `.last_error` and `.retry_after` sidecars,[^cache] and the `.notified` state of [notifications](/features/notifications.md).

# Rules

- **Fresh TTL**: a payload under 60 s old is served without HTTP.[^fetch-common]
- **Projected, not raw**: the payload is always the snapshot (`snapshotToCacheJson` / `parseCacheJson`), never a response body. Every vendor versions it through `encodeSnapshot` / `decodeSnapshot` in `snapshot-cache.js` with a `CACHE_VERSION`: bump it when the snapshot shape changes. DeepSeek's reader also rejects a non-numeric balance rather than coining a zero.
- **Stale fallback**: a failed fetch returns the cached payload as a `stale` result (`staleResult`). A payload older than 7 days, unparseable, or of another version is never served; the original error is returned instead.
- **429 backoff**: any `writeLastError(429)` arms a 5 minute window during which no request is made. A cached payload up to 7 days old is served stale with `lastError: {code:'rate-limited', retryInMs}`; without one the result is a `rate-limited` error (not the original error).

- **Async IO**: every read and write is a Gio async call, so the Shell main loop never waits on the disk. `atomicWrite()` writes a private sibling tempfile and renames it over the target (a symlink there is replaced, not followed); the credential write-backs, the update-check state and the `active_vendor` mirror use it too. A vendor directory removed while running is re-created on the next write.[^cache]

See [fetch pipeline](/architecture/fetch-pipeline.md) for where these fire.

---
type: Behavior
title: Notifications
description: lib/notify.js decide() fires each usage window once at the threshold and each banked reset 48 h before expiry, with dedupe state saved before delivery.
tags: [pure-modules, cache]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: notify
    title: lib/notify.js
    resource: lib/notify.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Rules

`decide()` in `lib/notify.js` is pure and runs only after a **fresh** fetch.[^notify] Its inputs come from the adapter's `notifyRows` (one `{key, label, percent, resetsAt}` per window) and `resetCredits` (`{title, expiresAt}`).

- A window fires once at the threshold (default 97%).[^readme]
- It re-arms when usage drops below threshold minus 7. When its reset moves more than 90 minutes later than the latest one recorded, it counts as a new window: still over the threshold, it fires again on that same fetch. The tolerance keeps jitter and a window sliding between fetches from re-firing.
- A reset credit fires once, 48 h before it expires.

# State

The dedupe state is JSON (`version: 2`) in the vendor's `.notified` sidecar in the [cache](/architecture/cache.md), saved **before** delivery. Delivery is `ui/notifier.js`. A vendor notifies only while it is polled or when "Refresh all" fetched it ([panel and popup](/architecture/panel-and-popup.md)), only with `notify-enabled` on, and only for a fresh (not stale, not cached) result.

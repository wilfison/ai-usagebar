---
type: Behavior
title: Usage trend
description: A line of recent readings under each usage window, sampled on fresh fetches into the vendor's cache and drawn once there are three.
tags: [cache, pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T12:00:00Z
sources:
  - id: trend
    title: lib/trend.js
    resource: lib/trend.js
  - id: indicator
    title: ui/indicator.js
    resource: ui/indicator.js
  - id: card
    title: ui/vendorSection.js
    resource: ui/vendorSection.js
  - id: upstream
    title: upstream src/history.rs (v1.54.0)
    resource: https://github.com/akitaonrails/ai-usagebar/blob/v1.54.0/src/history.rs
---

# Overview

With *Show usage trend* on (`usage-trend`, the default), each usage window in the popup gets a small line of its recent readings beside the [pace](/features/pace.md) footnote, scaled to their own range, in the dimmed text colour. It is drawn once a window has three samples. Beside it the footnote wraps rather than being cut short, since the popup's width is fixed.[^card]

# Sampling

Upstream samples only when its menu opens, since its extension runs a binary on demand. This port already polls in the background, so every **fresh** fetch records one sample (not a stale fallback or a TTL cache hit, the same rule as [notifications](/features/notifications.md)). A cached result only loads the file once, so the line is back right after a shell restart. Samples come from each adapter's `notifyRows()` and are matched to a window row by its title; a test keeps the two in step for every vendor.[^indicator]

The limits are upstream's:[^trend][^upstream]

- A series is one window row. Upstream also keys it by the exact reset instant, but vendors jitter that instant between fetches and rolling windows slide it, so, as [notifications](/features/notifications.md) do, only a reset moved later by more than 90 minutes starts a new series; otherwise it follows the latest reset.
- A sample within 10 s of the last one replaces it, so a burst of refreshes does not flatten the line.
- 20 points kept per series, the last 12 drawn; points older than 8 days dropped, also when the file is read, and so are points over an hour in the future. A clock stepped back by less than that keeps the history, and samples taken meanwhile are appended in order.
- Two windows with the same key (scoped windows the vendor names alike) keep separate series, paired with their rows in order.
- At most 64 series per vendor, the least recently sampled dropped first.

# Storage

The samples live in the vendor's [cache](/architecture/cache.md) directory as `.trend` (JSON, written atomically), which a payload write keeps. Reads and writes for one vendor are chained so they never interleave. A malformed, oversized or unreadable file reads as an empty history, which the next sample overwrites. With the option off nothing is read, written or drawn, and the history held in memory is dropped; the file stays until the next sample overwrites it. Turning it back on reloads the file for every card that has a result, without waiting for a fetch. Samples of `AI_USAGEBAR_FAKE_PCT` (or `AI_USAGEBAR_FAKE_PCT_<KIND>`) data start from an empty history, are drawn, and are never written.[^indicator]

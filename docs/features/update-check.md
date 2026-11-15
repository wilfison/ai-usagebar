---
type: Behavior
title: Update check
description: The poll tick asks GitHub releases/latest once a day (an hour after a failure) and shows a popup link when a newer tag exists.
tags: [distribution, http]
generated:
  by: claude/fable-5-2
  at: 2026-11-15T12:00:00Z
sources:
  - id: check
    title: lib/update-check.js
    resource: lib/update-check.js
  - id: store
    title: lib/update-store.js
    resource: lib/update-store.js
---

# Overview

`lib/update-check.js` is pure; `lib/update-store.js` does the IO.[^check] `UpdateItem.check(enabled)` in `ui/updateItem.js` runs at enable, on every poll tick and when `update-check-enabled` changes; it queries `https://api.github.com/repos/wilfison/ai-usagebar/releases/latest` only when the deadline stored in `<cacheRoot>/update_check` has passed:[^store] 24 h after a success, 1 h after a non-200 answer, an unparseable tag or a transport failure (network down, timeout), which the [HTTP layer](/architecture/http.md) reports as status 0 instead of throwing. Only an exception inside the check writes no deadline, so the next poll tick tries again. A deadline more than 24 h ahead (clock moved back) counts as due.

A tag newer than `version-name` in `metadata.json` shows a menu item below the action buttons (`ui/updateItem.js`) that opens the fixed `RELEASES_PAGE_URL`. The setting `update-check-enabled` turns it off. This is the only request the extension makes outside the vendors; see [overview](/overview.md) for distribution.

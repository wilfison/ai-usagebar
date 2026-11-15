---
type: Component
title: Extension lifecycle
description: enable() constructs the Indicator and adds it to the panel; disable() must release every resource it created.
tags: [gnome-shell]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: ext
    title: extension.js
    resource: extension.js
  - id: indicator
    title: ui/indicator.js
    resource: ui/indicator.js
---

# Overview

`extension.js` is small but owns three things:[^ext]

- the `Indicator`, built in `_place()` with the settings, an `openPreferences` callback, the extension path and `version-name`, then added to the panel at the configured box and index;
- the `toggle-menu` keybinding (`Super+U`), bound on the extension so it survives rebuilds;
- the `changed::panel-box` / `changed::panel-index` handlers. A panel item cannot change area in place, so a new position destroys and rebuilds the whole Indicator; the cache's fresh TTL keeps that from refetching ([snapshot cache](/architecture/cache.md)).

`disable()` removes the keybinding, disconnects both signals and destroys the Indicator.

# The release invariant

Everything created in `enable()` must be released in `disable()`: widgets, GLib timeout sources (`GLib.Source.remove`), signal handlers, the Soup session of the [HTTP layer](/architecture/http.md), and the Cancellable. Extension reviewers reject extensions that leak on disable.

Inside the Indicator, its `destroy()` owns that discipline,[^indicator] and so does each part it builds under `ui/`: `ActionBar` (footer buttons and tooltip), `PanelSegments`, `Notifier` and `UpdateItem`. A new part that holds a source or a signal needs its own `destroy()` wired into the indicator's.

# Settings effects

The pure `settingsEffect(key)` in `lib/settings-effect.js` maps a changed key to `INTERVAL` (re-arm the poll timer, for `refresh-interval`), `UPDATE_CHECK` (for `update-check-enabled`) or `SYNC`: re-resolve the poll set, fetch only vendors that newly joined it, and repaint; `rebuildTheme` for `color-*` keys, `allSections` (repaint every section, not just the active one) for `color-*`, `tooltip-format` and `show-pace-marker`. `primary-vendor` is handled before it: it forces `active-vendor`, whose own change then lands here. Settings themselves are covered in [configuration](/architecture/config.md).

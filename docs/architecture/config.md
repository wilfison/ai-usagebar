---
type: Component
title: Configuration
description: GSettings is the single source of truth, snapshotted by readConfig() into a plain object; active-vendor and primary-vendor are distinct keys.
tags: [pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:57:13Z
sources:
  - id: config
    title: lib/config.js
    resource: lib/config.js
  - id: schema
    title: gschema
    resource: schemas/org.gnome.shell.extensions.ai-usagebar.gschema.xml
---

# Overview

All settings live in the gschema `org.gnome.shell.extensions.ai-usagebar`.[^schema] `readConfig(settings)` in `lib/config.js`[^config] snapshots them into a plain `ConfigSnapshot` (optional `''` keys become `null`) that all pure code reads, which keeps it testable. Raw key access is limited to the gi-bound edges: the indicator reads `primary-vendor` and writes `active-vendor`, `extension.js` watches `panel-box` / `panel-index` and binds `toggle-menu`, and the prefs pages bind keys directly.

# active-vendor vs primary-vendor

- `primary-vendor` is the configured default.
- `active-vendor` is the scroll-selected or segment-clicked one whose popup section is expanded; it is mirrored to disk by `lib/active-vendor.js`, whose async writes run in call order so the newest id lands last.
- Changing `primary-vendor` forces `active := primary`.

The pure resolution helpers live in `lib/config-resolve.js`: `normalizeActive`, `enabledVendors`, `cycleVendor`, `panelVendors`, `pollVendors`, `withPinned`, `resolveApiKey`. Their use is described in [panel and popup](/architecture/panel-and-popup.md).

# API keys

An API key is taken from its environment variable when set, otherwise from the key typed in preferences; the variable names and the two OAuth credential paths are configurable (see [vendors](/vendors/)).

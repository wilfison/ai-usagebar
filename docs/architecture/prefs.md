---
type: Component
title: Preferences window
description: prefs.js runs in its own process with pure imports only and replaces the stock tabs with a sidebar split view.
tags: [gnome-shell]
generated:
  by: claude/fable-5-2
  at: 2026-11-15T18:20:33Z
sources:
  - id: prefs
    title: prefs.js
    resource: prefs.js
  - id: nav
    title: lib/prefs-nav.js
    resource: lib/prefs-nav.js
  - id: pages
    title: lib/prefs-pages.js
    resource: lib/prefs-pages.js
---

# Process boundary

`prefs.js` runs in a separate process and cannot import the gi-bound adapter registry.[^prefs] The General pages (`prefs/general.js`) use `lib/vendors.js` (`VENDOR_LABELS`) for the primary-vendor combo, and the prefs code imports only pure modules otherwise (`prefs/custom.js` takes `validateMapping` and `parseExtraHeaders` from `lib/vendors/custom/mapping.js` for its JSON editors, which keeps the response parser out of the prefs process).

# Pages

Pages live in `prefs/` (`general.js`, `custom.js`) built from `prefs/widgets.js`. Built-in vendor pages are data: `vendorPageSpec` in `lib/prefs-pages.js`[^pages] rendered by `specPage()`. `make pack` ships `prefs/` through `--extra-source`, so a new top-level directory needs one too.

# Sidebar

`prefsNav(_)` in `lib/prefs-nav.js`[^nav] lists General (Panel, Popup, Display, Behavior) and Vendors (one item per `VENDOR_IDS`). `fillPreferencesWindow` builds one `Adw.PreferencesPage` per item (a builder, else its spec) and throws on an id with neither. They go into a `Gtk.Stack` beside a `navigation-sidebar` list inside an `Adw.NavigationSplitView`, which collapses below 560sp.

The shell's `Adw.PreferencesWindow` has no sidebar, so the split view replaces its content with `window.set_content()`, called **last**, after `window.add()` of an empty page: the shell rejects a window whose `visible_page` is null.

---
type: Behavior
title: Panel and popup
description: How results render as panel segments and popup sections, and how single and pinned mode decide what is polled and what a click or scroll does.
tags: [gnome-shell, polling]
generated:
  by: claude/fable-5-2
  at: 2026-11-15T14:00:00Z
sources:
  - id: segments
    title: lib/panel-segments.js
    resource: lib/panel-segments.js
  - id: resolve
    title: lib/config-resolve.js
    resource: lib/config-resolve.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Rendering

A [FetchResult](/architecture/fetch-pipeline.md) is rendered two ways:

- **Panel segment**: `PanelSegments.rebuild()` in `ui/panelSegments.js` draws the vendor's logo (or short code); `segmentModel()`[^segments] gives the `{text, tone, severity}` beside it: `panelLabel(barFormat, adapter.placeholders(snapshot))` coloured by `adapter.severity(snapshot)`, with a trailing `⏸` when stale; `⚠` on error; `Loading…` (or `…` beside other segments) while loading.
- **Popup section**: an accordion, one expandable `VendorCard` (`ui/vendorSection.js`) per enabled vendor, with the active vendor's expanded. Its header carries the logo, the name, the plan and a refresh button for that vendor alone; its body is a rounded card repainted from `adapter.buildSection(...)` on every render. The rows follow the upstream Linux Mint tray: a window row is its title with the pace alert on the right, the bar, "N% used" against the reset, then the elapsed line. Bars use the severity palette as is; the same colours as text are brightened by `legibleOnDark()` (`lib/theme.js`) when the shell theme is dark, because the palette red is too dark to read as small type there.

The footer under the sections shows the most recent successful fetch among them, then "Refresh all" and the preferences button. A section's own "Updated" time is the tooltip of its refresh button, and is also printed inside the card after a failed refresh, when that section is older than the footer says.

# Single vs pinned mode

`panelVendors(config)`[^resolve] is the enabled ids of `panel-vendors` in `VENDOR_IDS` order, or the active vendor alone when none is pinned and enabled (**single mode**).

| | Single mode | Pinned mode |
| --- | --- | --- |
| Scroll | Cycles `active-vendor` among enabled vendors (needs at least 2) | Does nothing |
| Click / tap | Opens the popup | Opens the popup, then makes the nearest segment's vendor active |
| `Super+U` / Enter | Opens on the active vendor | Opens on the active vendor (no pointer position) |

The click is resolved after the menu opens, in `open-state-changed` (a no-op in single mode, where the only segment is the active vendor): it reads `Clutter.get_current_event()` and matches its x with `nearestSegment()`, because the shell's own click handling changed in GNOME 50 (a `ClickGesture` replaced `vfunc_event`).

# Polling

The timer polls `pollVendors(config)` = the segments plus the active vendor, in parallel, at the refresh interval (300 s, which is both the default and the schema minimum, because the endpoints rate-limit below that).[^readme] Other enabled vendors render from an in-memory results map filled lazily on scroll-cycle, their own refresh button or "Refresh all". A fresh result notifies only while its vendor is still polled (or a refresh button asked for it), so a vendor scrolled away mid-fetch stays quiet ([notifications](/features/notifications.md)).

While the popup is open, a 60 s timer repaints every segment and every built section so countdowns tick without hitting the network.

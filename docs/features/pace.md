---
type: Behavior
title: Pace
description: lib/pacing.js calc() projects a usage window to its reset and reports a state and, for ok windows, a calm/over/critical verdict.
tags: [pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T12:00:00Z
sources:
  - id: section-common
    title: lib/vendors/section-common.js
    resource: lib/vendors/section-common.js
  - id: pacing
    title: lib/pacing.js
    resource: lib/pacing.js
  - id: pace-fill
    title: lib/pace-fill.js
    resource: lib/pace-fill.js
---

# States

`calc()` in `lib/pacing.js`[^pacing] returns a `state`:

| State | When |
| --- | --- |
| `estimating` | First 1% of the window (clamped to 60 s to 1 h) while usage is above zero |
| `limit` | Usage at 100% |
| `neutral` | No reset instant |
| `ok` | Otherwise |

Only `ok` shows a pace glyph (`↑` ahead, `→` on track, `↓` under); the marker is drawn for `ok` and `estimating`.

# Verdict

An `ok` window gets a `verdict` from its **unrounded** projection at the reset:

- `critical`: over 100% with under 10 pts of quota left, or over 130% and 5 pts past the marker. Early in the window (under 15% elapsed with at least 50 pts of quota left) that second case is downgraded to `over`.
- `over`: over 110% and 3 pts past the marker.
- `calm`: otherwise.

The bar past the marker is orange for `over`, red for `critical`, plain for `calm` (`lib/pace-fill.js`),[^pace-fill] except when usage is at 100% or the base colour is already that colour or red: then the bar is one colour. The popup row carries two texts. The alert beside the title is empty while calm and otherwise reads "~20% over pace", "Limit in 1h 04m" (critical, from `runsOutAt`, set only when the projected run-out falls before the reset; otherwise "~N% over pace") or "Limit reached". The footnote under the bar reads "42% elapsed · 3pts ahead" for every `ok` window, whatever the verdict, or "Estimating…". Once a tenth of the window has passed and usage is above zero, it also gives the projection at the reset, rounded like the alert and capped at 999: "42% elapsed · 3pts ahead · on pace for 79%" (upstream's `projected_percent`, v1.54.0, which withholds it as early for the same reason: an early reading projects four-digit figures).[^section-common] A [usage trend](/features/usage-trend.md) line sits beside the footnote when there is one.

Rows get these fields (`paceAlert`, `paceFootnote`) through `paceFields()` in `windowRow()` ([vendor adapters](/architecture/vendor-adapters.md)).

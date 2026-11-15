---
type: Behavior
title: Pace
description: lib/pacing.js calc() projects a usage window to its reset and reports a state and, for ok windows, a calm/over/critical verdict.
tags: [pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
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

The bar past the marker is orange for `over`, red for `critical`, plain for `calm` (`lib/pace-fill.js`),[^pace-fill] except when usage is at 100% or the base colour is already that colour or red: then the bar is one colour. The footnote reads "42% elapsed · 3pts ahead" (calm), "~20% over pace", "Limit in 1h 04m" (critical, from `runsOutAt`, set only when the projected run-out falls before the reset; otherwise "~N% over pace"), "Estimating…" or "Limit reached".

Rows get these fields through `paceFields()` in `windowRow()` ([vendor adapters](/architecture/vendor-adapters.md)).

# Log

## 2026-11-15

- OAuth vendors (Anthropic, OpenAI) now redact their tokens from `.last_error` and the result through `redactedRun`, including tokens rotated by a refresh. Updated fetch pipeline.
- Popup sections restyled after the upstream Linux Mint tray, still as an accordion: the header carries the plan and a per-vendor refresh button, the body is one rounded card, and the footer carries the last update time. The pace text is split into an alert and a footnote. Updated panel and popup, lifecycle, pace and vendor adapters.
- Severity colours used as text in a dark popup are brightened by `legibleOnDark()` in `lib/theme.js` (the default red was too dark to read as small type); bars and a light popup keep the palette as is.
- Audit against the tracked code: the update check also waits 1 h after a transport failure (it is not retried on the next tick), `validateMapping` is used by `prefs/custom.js` rather than the General pages, and a missing parenthesis in the snapshot cache rules.

## 2026-11-14

- Bundle created from the tracked sources (code, README, CLAUDE.md history, Makefile, CI, release skill): overview, architecture, features, vendors and development areas.

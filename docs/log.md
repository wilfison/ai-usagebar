# Log

## 2026-11-15

- The Notifier and the Soup session belong to the extension, so a panel move keeps delivered notifications; both panel keys changing together rebuild the indicator once. Updated lifecycle and HTTP layer.
- Settings changes are coalesced into one idle pass (`settingsEffects`), so a reset no longer repaints once per key; the active vendor write goes through `_setActiveVendor`. Updated lifecycle.
- Cache writes (`writePayload`, sidecars, `atomicWrite`) are async Gio calls; the credential write-backs, update state and active vendor mirror await them. Updated snapshot cache.
- Every vendor `fetchSnapshot` is built by `vendorFetch()`; GETs and optional side requests share `httpGet()` and `optionalRequest()`. Updated fetch pipeline.
- `vendorAdapter()` derives `severity` from `peakUsage` by default; only OpenRouter and DeepSeek keep their own. Updated vendor adapters.
- Vendor sections build paced rows through `pacedWindowRow()` in `section-common.js`. Updated vendor adapters.
- Both OAuth vendors share `authorizeOAuth()`; Anthropic no longer POSTs an empty refresh token. Updated fetch pipeline.
- OAuth vendors (Anthropic, OpenAI) now redact their tokens from `.last_error` and the result through `redactedRun`, including tokens rotated by a refresh. Updated fetch pipeline.
- Popup sections restyled after the upstream Linux Mint tray, still as an accordion: the header carries the plan and a per-vendor refresh button, the body is one rounded card, and the footer carries the last update time. The pace text is split into an alert and a footnote. Updated panel and popup, lifecycle, pace and vendor adapters.
- Severity colours used as text in a dark popup are brightened by `legibleOnDark()` in `lib/theme.js` (the default red was too dark to read as small type); bars and a light popup keep the palette as is.
- Audit against the tracked code: the update check also waits 1 h after a transport failure (it is not retried on the next tick), `validateMapping` is used by `prefs/custom.js` rather than the General pages, and a missing parenthesis in the snapshot cache rules.

## 2026-11-14

- Bundle created from the tracked sources (code, README, CLAUDE.md history, Makefile, CI, release skill): overview, architecture, features, vendors and development areas.

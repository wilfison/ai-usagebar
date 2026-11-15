# Log

## 2026-11-15

- Tests get GSettings from `testSettings(overrides)` in the harness (checkout schema, private memory backend). Updated testing.
- The dev fetch overrides moved out of the indicator into `DevFetch` (`ui/devFetch.js`). Updated headless.
- Kimi projects its 5h, weekly and monthly blocks to the shared window shape (`utilizationPct`, `resetsAt`, `windowMs`; null when absent), cache `CACHE_VERSION` 2.
- OAuth stops carry `no-access-token` / `token-refresh-failed` codes with the login command, and the popup translates them, the key-echo redaction note and Anthropic's "minor units" amount.
- The custom provider caches a metric's raw used/limit (`CACHE_VERSION` 2) and the popup formats it with a translated "%s of %s".
- Vendors are one `VENDORS` table in `lib/vendors.js` (id, label, generic icon, user-given name); `apiKeyFetch` names a vendor by that label. Updated vendor adapters.
- The update check reads its deadline from disk once per indicator and keeps it in memory; any 2xx answer is parsed. Updated update check.
- The default User-Agent carries the extension's `version-name` (it was a fixed `ai-usagebar/0.1`), and `disposeSession()` aborts the Soup session. Updated HTTP layer.
- ESLint now enforces the module boundaries: no `gi://` in pure `lib/` modules, no adapters, `ui/` or Shell modules in the prefs. Updated conventions.
- Preference spin rows take their bounds, and the panel area combo its choices, from the gschema through `schemaRange()` / `schemaChoices()`; a test pins the primary-vendor enum order to `VENDOR_IDS`.
- Both OAuth vendors read and write their credentials through `lib/oauth/creds-file.js`; the OpenAI write-back now merges into the file as it is on disk at write time, like Anthropic's. Updated snapshot cache.
- The custom provider's configuration checks moved from its parser to `lib/vendors/custom/mapping.js`, with `authHeaderOf()` as the one Authorization fallback. Updated custom provider and preferences.
- DeepSeek and OpenRouter cache their snapshot through `encodeSnapshot` with a `CACHE_VERSION` like the other vendors; their old unversioned caches are refetched. Updated snapshot cache.
- The Indicator releases its timers, signals and cancellable in `_onDestroy()`, so a destroy from the shell side cleans up too; signals use `connectObject`. Updated lifecycle.
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

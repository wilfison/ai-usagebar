# Log

## 2026-11-25

- README rewritten for end users first, developers last. Its label placeholder reference and custom provider example moved to the bundle; vendor concepts now cite code instead of the README. Added label placeholders and custom provider setup; updated custom provider, Anthropic, OpenAI, Z.AI, OpenRouter, DeepSeek and Ollama Cloud.
- Screenshots: `make screenshots` also animates the card as usage rises (`screenshots/popup.webp`, WebP at quality 90, the README's top image); `screenshots/popup.png` stays as the static card and Open Graph cover. Updated screenshots.
- Screenshots: `make screenshots` (`tools/screenshots/`) rebuilds the README images from the headless shell. New dev overrides `AI_USAGEBAR_FAKE_ELAPSED` (share of each fake window passed), `AI_USAGEBAR_FAKE_TREND` (seeded trend line) and `AI_USAGEBAR_PREFS_PAGE` (preferences start page); `tools/headless.sh` gains `start --fake-elapsed/--fake-trend/--dark/--refresh-interval`, `prefs --page`, `shot-popup` and `shot-window`, and leaves the overview on start. `build.py --background` rebuilds the card's backdrop from a wallpaper. Added screenshots; updated headless and usage trend.
- Fake data: `AI_USAGEBAR_FAKE_PCT_<KIND>` (`SESSION`, `WEEKLY`, `MONTHLY`, `SONNET`, `SCOPED`, `MCP`, `CODE_REVIEW`, `CREDITS`) sets one window kind across vendors, falling back to `AI_USAGEBAR_FAKE_PCT`, or 0; any of them turns synthetic usage on. `tools/headless.sh start --fake-pct-<kind> N` and `make headless FAKE_PCT_<KIND>=N` pass them. Updated headless and usage trend.
- Upstream sync to v1.55.0 (#674 pace forecasts and trend sparklines; the rest of v1.54.0 and v1.55.0 is tray, macOS, Windows, Omarchy and Antigravity, which this port lacks). The pace footnote adds "on pace for N%" once a tenth of the window has passed. A new `usage-trend` setting, on by default, keeps up to 20 samples per window in the vendor's `.trend` cache file on each fresh fetch and draws the recent ones as a line under the window (`lib/trend.js`). Last synced tag is now v1.55.0; `tools/upstream-diff.sh` now also follows `src/history.rs`. Added usage trend; updated pace, cache and upstream sync.

## 2026-11-22

- Overview: the development checkout is not the installed extension; `~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison` is a separate copy and headless symlinks the checkout into its isolated HOME. Updated overview.
- Upstream sync to v1.53.0, provider status: the Claude and Codex cards take the colour of their official status page with a `▲` and the incident title while it flags one of that provider's components (`lib/incident.js`, `provider-status` setting, `AI_USAGEBAR_FAKE_INCIDENT`). Last synced tag is now v1.53.0. Added provider status; updated cache, headless, update check, Anthropic, OpenAI and upstream sync.
- Upstream sync to v1.53.0: a Codex refresh token the token endpoint retired (a 4xx other than 429) no longer stops the fetch and serves the cached reading; OpenAI now sets `retiredRefreshContinues` like Anthropic. Updated OpenAI and fetch pipeline.

## 2026-11-17

- Upstream sync to v1.52.2: an Anthropic refresh token the token endpoint retired (a 4xx other than 429) no longer stops the fetch and serves the cached weekly figure; `authorizeOAuth()` takes `retiredRefreshContinues`, set by Anthropic only, clears the token error and goes on with the current access token. Updated Anthropic and fetch pipeline.

## 2026-11-15

- Review refactor, fetch and OAuth: every vendor `fetchSnapshot` comes from `vendorFetch()` (mutex, redaction, `httpGet()`, `optionalRequest()`); both OAuth vendors share `authorizeOAuth()` and `lib/oauth/creds-file.js`, redact their tokens (`redactedRun`), never POST an empty refresh token and carry `loginCommand` on errors (`no-access-token`, `token-refresh-failed`, a rejected token). The fetch slots and results moved to the pure, tested `VendorPoller`. Updated fetch pipeline, snapshot cache, panel and popup.
- Review refactor, vendors: one `VENDORS` table in `lib/vendors.js`; `severity` defaults to the peak's; `pacedWindowRow()` builds the paced rows; every vendor caches a versioned snapshot (DeepSeek and OpenRouter 1, custom 2 with a raw `amount`, Kimi 2 in the shared window shape); the custom config checks moved to `custom/mapping.js`. Updated vendor adapters, custom provider and the vendor pages.
- Review refactor, shell lifecycle: cache and credential writes are async Gio calls (the `active_vendor` mirror in call order); the Indicator cleans up in `_onDestroy()` with `connectObject`; settings changes apply once per idle (`settingsEffects`); the Notifier and the Soup session belong to the extension, and one panel move rebuilds once; the dev overrides live in `DevFetch`; the update deadline stays in memory; the default User-Agent carries `version-name`. Updated lifecycle, HTTP layer, update check, notifications, config and headless.
- Review refactor, prefs, i18n and tooling: spin bounds and panel areas come from the gschema (`schemaRange()` / `schemaChoices()`); the per-model context windows entry is validated before saving; OAuth hints, the key-echo note, "minor units" and the custom "%s of %s" are translated; ESLint enforces the pure-module and prefs import boundaries; tests share `testSettings()`. Updated preferences, context monitor, conventions and testing.
- Popup sections restyled after the upstream Linux Mint tray, still as an accordion: the header carries the plan and a per-vendor refresh button, the body is one rounded card, and the footer carries the last update time. The pace text is split into an alert and a footnote. Updated panel and popup, lifecycle, pace and vendor adapters.
- Severity colours used as text in a dark popup are brightened by `legibleOnDark()` in `lib/theme.js` (the default red was too dark to read as small type); bars and a light popup keep the palette as is.
- Audit against the tracked code: the update check also waits 1 h after a transport failure (it is not retried on the next tick), `validateMapping` is used by `prefs/custom.js` rather than the General pages, and a missing parenthesis in the snapshot cache rules.

## 2026-11-14

- Bundle created from the tracked sources (code, README, CLAUDE.md history, Makefile, CI, release skill): overview, architecture, features, vendors and development areas.

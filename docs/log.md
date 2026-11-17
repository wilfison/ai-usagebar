# Log

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

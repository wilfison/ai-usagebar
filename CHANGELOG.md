# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Selectable panel vendors with independent usage labels, severity colors,
  error states and polling. Clicking a label selects its popup section.
- A default panel label and optional per-vendor label templates. Empty vendor
  templates inherit the default.
- Panel preferences that enable a disabled vendor when selected and preserve
  the previously active vendor on upgrade.

### Fixed

- Panel countdowns update while the popup is closed.
- Empty panel selections and all-disabled configurations have no panel fetch targets.

## [1.5.0] - 2026-10-02

### Added

- **Update check.** Once a day the extension asks GitHub for the latest
  release; when it is newer than the installed version, a link to it appears at
  the bottom of the popup. **Check for updates** under *Behavior* turns it off.

### Changed

- **Preferences** use a sidebar instead of the bottom tabs, which truncated
  their labels: **General** (Panel, Popup, Display, Behavior) and one entry per
  vendor. The sidebar collapses on a narrow window.
- The **pace** colouring is more tolerant: the bar past the marker stays plain
  while usage is roughly on pace, turns orange when the window is projected
  over 110% at its reset and red when it would run out before it.
- A paced window's footnote follows that verdict: "42% elapsed · 3pts ahead"
  when calm, "~20% over pace" when over, and "Limit in 1h 04m" when critical.
- **Show pace marker** in preferences now explains what the marker is.
- With the label in the center area, the popup opens centered on it.
- The no-value marker in the panel and the popup is now `-`.

### Removed

- GNOME Shell 45 and 46 are no longer listed as supported: the preferences
  window needs a newer libadwaita than those releases ship.

### Fixed

- A usage notification no longer repeats when a window's reset time only
  drifts between fetches; the reset has to move more than 90 minutes later to
  count as a new window.

## [1.4.0] - 2026-09-30

### Added

- A **keyboard shortcut** opens or closes the popup, `Super+U` by default;
  change or disable it under **Popup** in preferences.

### Fixed

- A long banked-reset title no longer stretches the popup: each reset shows
  its title over the expiry, the popup is capped at 440 px wide, and text rows
  wrap instead.

## [1.3.0] - 2026-09-30

### Added

- **Ollama Cloud** joins as the seventh vendor: session, weekly or monthly
  usage, the five most-used models of each window as a breakdown, and the
  reported cost, with an API key and an optional plan name in preferences.
- A **custom provider** turns any HTTPS endpoint that answers a GET with JSON
  into a vendor, with metrics and texts mapped by JSON Pointer, an optional key
  in a header of your choice, extra headers, and its own name and panel badge.
- **Banked resets**: Claude launch resets and Codex reset credits are listed
  in the popup, soonest to expire first, with `{resets}`,
  `{resets_available}`, `{oai_resets}` and `{oai_resets_available}`.
- An opt-in **context monitor** lists recent Claude Code sessions under the
  Claude section with how much of the context window each one used.
- **Vendor logos** in the panel badge, the popup headers and the preferences
  pages, recoloured for light and dark themes; **Show vendor logos** turns them
  off.
- **Panel position** in preferences: the area (left, center, right) and the
  position within it, applied immediately.
- A **pace footnote** under each paced window ("42% elapsed · 3pts ahead"),
  "Estimating…" at the start of a window and "Limit reached" at the cap.
- Reset countdowns also show the wall-clock time the window reopens.
- `{session_elapsed}`/`{weekly_elapsed}` for every vendor, `{session_pace}`/
  `{weekly_pace}` for OpenAI and Z.AI, the `{zai_*_elapsed|pace}` family,
  `{kimi_monthly_*}`, `{oll_*}` and `{custom_*}` placeholders; the README now
  lists every placeholder.
- Kimi accounts that report only the newer `usages` shape (a monthly pool) are
  read, and the plan shows Kimi's own tier name.
- Z.AI's `CREDIT_LIMIT` buckets are read.

### Changed

- `shell-version` now declares **GNOME Shell 45–51**. The extension is
  developed and tested on 50 only; on the other versions it is untested, so
  please report anything that breaks.
- The indicator now sits **right of the clock** by default instead of beside
  the system menu; the previous place is **Right** in the new Panel position
  preference.
- **Notifications** fire once per usage window when it reaches the threshold
  (now 97% by default, 1–100), as critical at 100%, and re-arm only after usage
  drops 7 points below it or the window resets. A banked reset credit is
  announced 48 hours before it expires. Only a fresh fetch notifies.
- The cache keeps only the figures the popup shows, never a raw response; a
  cache older than 7 days is no longer shown, and the original error is shown
  instead of stale history.
- After an HTTP 429 a vendor makes no request for 5 minutes, and the popup
  says when the next attempt is.
- Redirects are followed only within the same scheme, host and port.
- Switching vendors while a fetch is slow no longer waits for it or paints its
  late result.
- Money is formatted by one shared formatter that honours the currency; a
  negative OpenRouter balance is critical.
- Claude extra usage without a monthly cap shows the spend with no bar instead
  of a $0.00 limit, in the account's currency.

### Fixed

- Codex windows are classified by their length, so a weekly window sent alone
  is no longer shown as the 5-hour one, and a missing window is no longer 0%.
- A Codex token refresh that returns no new ID token no longer refreshes again
  on every poll.
- Failing to save a rotated refresh token (Claude, Codex) is reported instead
  of silently logging the user out on the next run.
- Z.AI buckets are classified by unit, and a failure answer inside an HTTP 200
  is neither cached nor shown as usage.
- A corrupt DeepSeek cache is refetched instead of reading as a zero balance.
- The pace marker is no longer drawn on a window at its cap, and no pace verdict
  is shown in the first minutes of a window.

### Security

- A 401/403 response body is never stored or shown, since it can echo a
  credential; other error bodies and all vendor text are stripped of control
  and bidi characters before display.
- The Codex account's email and ids no longer reach the on-disk cache.

## [1.2.1] - 2026-07-17

### Added

- Kimi joins as the sixth supported vendor, with its own preferences page,
  weekly and 5-hour rolling-window usage, and an API-key setting (disabled by
  default).
- The Anthropic popup now shows model-scoped weekly windows (for example a
  Fable weekly cap) as their own usage rows, each with a bar, pace marker, and
  reset countdown. Accounts without scoped limits look exactly as before.
- Popup usage bars fill the portion that overshoots the pace marker in the pace
  colour, so a glance shows when usage is running ahead of the expected pace.

### Changed

- A model-scoped weekly window nearing or hitting its cap now escalates the
  panel colour and can trigger the usage notification, instead of only the
  overall weekly limit counting.

### Fixed

- Anthropic usage requests now send the Claude Code User-Agent and
  Content-Type, avoiding the 429 rate-limit responses the endpoint returned
  without them.
- Popup usage bars now size their fill from the allocated width, fixing bars
  that rendered far shorter than the real percentage (for example 23% showing
  as roughly 6% of the track).

## [1.2.0] - 2026-06-10

### Changed

- Vendor brand logos in the panel label, the multi-vendor popup, and the
  preferences window are replaced with a generic mark and bold text badges
  (CLD/GPT/ZAI/OPR/DSK). Providers are still identified by name. This satisfies
  the extensions.gnome.org review policy on bundling trademarked logos.
- Credential and cache files on the polling path are now read asynchronously, so
  refreshing usage no longer blocks the GNOME Shell main loop.

### Fixed

- The "show pace marker" preference now takes effect: it draws a thin marker at
  the fraction of the usage window that has elapsed. Previously the toggle did
  nothing.
- The panel and popup mark now ships as a symbolic icon and recolors with the
  theme, so it is no longer invisible in dark mode.

## [1.1.0] - 2026-06-08

### Added

- Desktop notification when a vendor's peak usage crosses a configurable
  threshold (default 90%). Opt-out, enabled by default, with an enable toggle
  and threshold control in preferences.
- The threshold notification plays the standard system notification sound
  alongside the desktop banner.

### Changed

- Notifications are now debounced per vendor: a banner fires only when the peak
  percentage changes and at least 30 minutes have passed since the last alert
  for that vendor, so a steady usage level no longer re-pings every poll. A
  fresh usage window still re-arms alerting immediately.
- An expanded vendor section in the popup now blends with the popup background
  instead of showing the default inset fill and shadow.

## [1.0.1] - 2026-06-07

### Added

- Vendor brand logos in the panel label, the multi-vendor popup, and the
  preferences window.

## [1.0.0] - 2026-06-07

### Added

- Top-panel indicator showing AI plan usage for five vendors: Anthropic,
  OpenAI, Z.AI/GLM, OpenRouter, and DeepSeek.
- Per-vendor usage fetch with OAuth token refresh and on-disk caching, falling
  back to stale cache on network failure.
- Scroll-to-cycle on the panel button to switch the active vendor among the
  enabled ones.
- Collapsible multi-vendor popup with a per-vendor boxed-list section and a
  "Refresh all" action.
- Preferences window for credentials, enabled vendors, primary vendor, refresh
  interval, bar format, and severity colors.
- Internationalization (gettext) with pt_BR, es, fr, and de catalogs.

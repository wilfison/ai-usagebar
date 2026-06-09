# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

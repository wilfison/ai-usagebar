# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

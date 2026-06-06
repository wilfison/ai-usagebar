# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **GNOME Shell extension** (GJS / ES modules, `shell-version: ["50"]`) that
shows AI plan usage in the top panel for five vendors — **Anthropic, OpenAI,
Z.AI/GLM, OpenRouter, DeepSeek**. It is a port of the Rust Waybar widget
[ai-usagebar](https://github.com/akitaonrails/ai-usagebar) by akitaonrails.

The extension is fully built: panel indicator, per-vendor fetch + OAuth refresh,
scroll-to-cycle, a collapsible multi-vendor popup, and a prefs window. This repo
IS the installed extension (it lives under
`~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison`) — gnome-shell loads
the JS directly; there is no build step.

## Develop / test

The `Makefile` is the canonical dev loop — prefer these targets over raw
`gnome-extensions` / `journalctl` / `gjs`. Run `make` to list them.

```bash
make test      # gjs -m tests/run.js — pure-JS unit suite (compiles schema first)
make lint      # tools/lint.sh — trailing-newline + no imports.* + no SPDX header
make eslint    # npx eslint . — GNOME Shell flat config (needs `npm ci` first)
make validate  # tools/validate.sh — metadata.json + schema --strict
make watch     # re-run `make test` on changes under lib/ ui/ tests/ (needs inotify-tools)
make reload    # disable + enable (Wayland still needs a full relog to pick up changes)
make run       # launch a throwaway nested gnome-shell (Wayland) to test live
make logs      # journalctl -f -o cat /usr/bin/gnome-shell
make pack      # gnome-extensions pack . --force → upload zip
make info      # gnome-extensions info ai-usagebar@wilfison
```

Run a **single test file** directly: `gjs -m tests/anthropic-parse.test.js`.
Each `tests/*.test.js` is self-contained (calls `system.exit(summary())`), and
`tests/run.js` discovers them and runs each as an isolated `gjs -m` subprocess.

CI (`.github/workflows/ci.yml`) runs `make schemas`, `make test`, `tools/lint.sh`,
`npx eslint .`, and `make validate` on every PR.

## Architecture

`extension.js` is thin: `enable()` constructs the `Indicator`
(`ui/indicator.js`) with `getSettings()` + an `openPreferences` callback and adds
it to the panel; `disable()` calls `this._indicator.destroy()`. **Everything
created in `enable()` must be released in `disable()`** (widgets, GLib timeout
sources via `GLib.Source.remove`, signal handlers, the Soup session, the
Cancellable) — reviewers reject extensions that leak on disable. `Indicator`
owns this discipline in its `destroy()`.

### Vendor-adapter pattern (the core abstraction)

The indicator never branches per vendor. `lib/vendors/registry.js` maps a vendor
id → a uniform `Adapter` (`{ id, cacheId, icon, vendorShort, fetchSnapshot,
severity, placeholders, buildSection }`); the indicator calls `getAdapter(id)`
and drives it generically. Each vendor is implemented as a **module triple**:

- `lib/vendors/<vendor>.js` — fetch state machine (`fetchSnapshot`). Reads
  creds/key, maybe-refreshes the OAuth token, GETs the usage endpoint, caches,
  and falls back to stale cache on failure. Transitively imports `Gio` (via
  cache/http), so it is **not** unit-tested directly. Never throws — always
  resolves to a `FetchResult`.
- `lib/vendors/<vendor>-parse.js` — **pure**: `parseUsage(jsonBytes) → snapshot`,
  plus `severity`, `placeholders` (Map for `bar-format` substitution), `ICON`,
  `VENDOR_SHORT`. No `gi://`; fully unit-tested.
- `lib/vendors/<vendor>-section.js` — **pure**: `buildSection(snapshot, meta,
now, theme) → SectionModel` (an ordered list of typed rows). No `gi://`;
  unit-tested.

`registry.js` wires the triple together and derives the creds path / resolved API
key from config, catching resolution errors into the standard error result. To
add a vendor: write the triple, register it in `ADAPTERS`, and add its id/label
to `lib/vendors.js` (`VENDOR_IDS` / `VENDOR_LABELS`) + the gschema keys.

### Data flow

`FetchResult` (`lib/vendors/types.js`) is a discriminated union:
`{ok:true, snapshot, stale, lastError, cacheAgeMs}` |
`{ok:false, kind:'loading'}` | `{ok:false, kind:'error', message}`. The indicator
renders it three ways: the **panel label** = `substitute(barFormat,
adapter.placeholders(snapshot))` colored by `adapter.severity(snapshot)` (with a
trailing `⏸` when stale); the **popup sub-section** = `adapter.buildSection(...)`
→ `renderSection` (`ui/vendorSection.js`), which maps each pure row kind to St
widgets laid out as a libadwaita boxed-list card; loading/error states get a
single message row.

Only the **active** vendor is polled on the timer; other enabled vendors render
from an in-memory results map, populated lazily on scroll-cycle or "Refresh all".
Scrolling the panel button cycles `active-vendor` among enabled vendors. While
the popup is open a 60s timer re-renders the active section so countdowns tick
without hitting the network.

### Config & cache

GSettings is the **single source of truth**. `lib/config.js` `readConfig(settings)`
snapshots it into a plain `ConfigSnapshot` (optional `''` keys → `null`); the
rest of the code never touches raw keys. Note the **`active-vendor` vs
`primary-vendor`** split: primary is the configured default; active is the
scroll-selected one, mirrored to disk via `lib/active-vendor.js`; a
`primary-vendor` change forces `active := primary`. `lib/config-resolve.js`
holds the pure resolution helpers (`normalizeActive`, `enabledVendors`,
`cycleVendor`, `resolveApiKey`).

`lib/cache.js` is a per-vendor directory with a payload file plus `.stale` /
`.last_error` sidecars; a 60s fresh-TTL fast path skips HTTP, and a failed fetch
falls back to the cached payload as a `stale` result.

### HTTP & prefs (the other gi:// boundaries)

`lib/http.js` is the only `Soup` consumer — async libsoup3, threaded through a
shared session disposed on `destroy()`. **Never block the main loop.** Refresh
defaults to 300s because the undocumented endpoints rate-limit below that.

`prefs.js` runs in a **separate process** and cannot import the gi-bound adapter
registry — it uses `lib/vendors.js` (`VENDOR_LABELS`) for page titles and the
primary-vendor combo instead.

## Conventions

- `*.credentials.json`, `auth.json`, and `*.compiled` are gitignored; never
  commit real OAuth creds or API keys. Don't `cat` credential files — use
  `jq 'keys'`.
- **Source `*.js` files must be documented with JSDoc.** Every file under
  `lib/`, `ui/`, `tools/`, `extension.js`, `prefs.js`, and shared test utilities
  (`tests/_assert.js`, `tests/_http-server.js`, `tests/run.js`) starts with a
  `@file` block. Every exported function, class, and constant carries a JSDoc
  block with `@param` / `@returns` (and `@throws` when it throws). Use `@typedef`
  for structured shapes reused across functions (HTTP results, OAuth creds,
  vendor payloads/snapshots). **`tests/*.test.js` files do NOT need JSDoc** — the
  `describe`/`it` names already describe intent. Keep blocks tight: types and
  contract first, prose only when the WHY isn't obvious.
- Keep API usage on the GNOME 50 ESM surface — `gi://` imports and
  `resource:///org/gnome/shell/…`, no legacy `imports.*` syntax (the lint
  enforces this).

## Testing policy

**Anything that can be tested must be tested.** The boundary between testable and
not-testable is the `gi://` import line:

- **Pure JS (testable — write automated tests):** response parsers, quota /
  percentage math, formatters, severity/pacing/countdown, vendor `*-parse.js` and
  `*-section.js` adapters, `config.js` / `config-resolve.js`, OAuth/JWT helpers.
  Keep these free of `gi://` imports so they run under `gjs -m` (and node where
  possible). Put tests in `tests/*.test.js` mirroring the source path. **A new
  pure-JS module without a matching test file is incomplete.** Run `make test`
  and `make lint` before declaring a change done.
- **GJS / Shell-bound (manual — document the check):** anything touching `St`,
  `PanelMenu`, `Main.panel`, `Soup`, `GLib.timeout_add_seconds`, or
  `GObject.registerClass` (the indicator, renderers, http, vendor orchestrators).
  Reload the extension, watch `make logs` for errors, and verify the panel
  behaves as expected. In the PR / task notes, write the exact reload +
  observation steps you ran — not "tested manually". On Wayland you cannot
  hot-reload JS in-session; use `make run` (nested shell) or a full relog.
- **Packaging:** before a release-ready change, run `make pack` and `make info`
  and confirm both succeed without warnings.
- **Never fake a test result.** If something genuinely cannot be tested in the
  current environment (e.g. no live Claude/OpenRouter credentials), say so
  explicitly — do not claim "verified" based on code reading alone.

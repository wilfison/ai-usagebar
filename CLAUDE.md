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
make pot       # tools/i18n.sh pot — re-extract strings into po/<uuid>.pot
make update-po # msgmerge each po/*.po against the refreshed template
make compile-locale  # msgfmt po/*.po → locale/<lang>/LC_MESSAGES/*.mo (dev)
make i18n-check      # fail on a stale .pot or a malformed po/*.po (CI gate)
make pack      # gnome-extensions pack . --podir=po --force → upload zip (with .mo)
make info      # gnome-extensions info ai-usagebar@wilfison
```

Run a **single test file** directly: `gjs -m tests/lib/vendors/anthropic/parser.test.js`.
Each `*.test.js` is self-contained (calls `system.exit(summary())`), and
`tests/run.js` discovers them **recursively** (so tests may nest in
subdirectories that mirror the source path) and runs each as an isolated
`gjs -m` subprocess.

The runner colorizes output with ANSI codes; `tests/run.js` honors the
[`NO_COLOR`](https://no-color.org) env var, so run `NO_COLOR=1 make test` to get
plain (uncolored) output — use this when capturing logs or running non-interactively.

CI (`.github/workflows/ci.yml`) runs `make schemas`, `make test`, `tools/lint.sh`,
`npx eslint .`, `make validate`, and `make i18n-check` on every PR (the runner
installs `gettext` for the i18n tools).

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
and drives it generically. Each vendor lives in its own directory
`lib/vendors/<vendor>/` as a **module triple**:

- `lib/vendors/<vendor>/main.js` — fetch state machine (`fetchSnapshot`). Reads
  creds/key, maybe-refreshes the OAuth token, GETs the usage endpoint, caches,
  and falls back to stale cache on failure. Transitively imports `Gio` (via
  cache/http), so it is **not** unit-tested directly. Never throws — always
  resolves to a `FetchResult`.
- `lib/vendors/<vendor>/parser.js` — **pure**: `parseUsage(jsonBytes) → snapshot`,
  plus `severity`, `placeholders` (Map for `bar-format` substitution), `ICON`,
  `VENDOR_SHORT`. No `gi://`; fully unit-tested.
- `lib/vendors/<vendor>/section.js` — **pure**: `buildSection(snapshot, meta,
now, theme) → SectionModel` (an ordered list of typed rows). No `gi://`;
  unit-tested.

Shared helpers (`registry.js`, `section-common.js`) stay flat at
`lib/vendors/`. `registry.js` wires the triple together and derives the creds
path / resolved API key from config, catching resolution errors into the
standard error result. To add a vendor: create `lib/vendors/<vendor>/` with the
triple, register it in `ADAPTERS`, and add its id/label to `lib/vendors.js`
(`VENDOR_IDS` / `VENDOR_LABELS`) + the gschema keys.

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

### Internationalization (i18n / gettext)

`metadata.json` declares `"gettext-domain": "ai-usagebar@wilfison"`, so GNOME
Shell auto-initializes translations for both `extension.js` and `prefs.js`. Every
user-facing string is wrapped in `_()` (gettext) using a **plain string literal**
as the argument — never a template literal, which `xgettext` cannot extract.

- **Where `_` comes from.** gi-bound modules import the real translator:
  `ui/indicator.js` and `lib/vendors/registry.js` from
  `resource:///org/gnome/shell/extensions/extension.js`; `prefs.js` from
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`. **Pure modules
  never import gettext** (it is gi-bound) — see the injected-translator rule below.
- **Injected translator (pure modules).** `lib/countdown.js`,
  `lib/vendors/section-common.js`, and every `lib/vendors/*/section.js` take a
  trailing `_ = (s) => s` parameter defaulting to the identity function. The
  builders call `_('…')` on it; `registry.js` injects the real `gettext` when it
  wraps each adapter's `buildSection`. Tests call these with no translator (or a
  fake one) and stay 100% `gi://`-free. `xgettext` extraction is syntactic, so
  `_('Session')` is extracted regardless of where `_` is defined.
- **Interpolation.** GJS's `String.prototype.format` is absent in the prefs
  process and in bare-`gjs -m` tests, so we use the pure `vformat()` helper in
  `lib/format.js` instead: `vformat(_('Claude %s'), plan)`. The translatable text
  stays a literal inside `_()`; `vformat` substitutes `%s` / `%d` / `%02d` / `%%`.
  Use `ngettext`/`pgettext` (already in the `xgettext` keyword set) if plural or
  context ever applies.
- **What is NOT translated** (kept verbatim, outside the `_()` literal): vendor
  brand names (Claude/OpenAI/Z.AI/OpenRouter/DeepSeek — wrapped in prefs only for
  catalog completeness, with a "brand name — keep untranslated" translator
  comment), `{token}` placeholder names, `%s`/`%d` specifiers, vendor short codes,
  hex colors, money/number strings, and punctuation like the `—` em-dash marker.
- **The renderer stays string-free.** `ui/vendorSection.js` paints pre-composed,
  already-translated fields the builders produce (`row.subtitle`, `row.status`,
  `row.text`) — it owns no user-facing prose.
- **Catalogs.** `po/` holds the tracked `.pot` template + `pt_BR`/`es`/`fr`/`de`
  `.po` sources; `locale/<lang>/LC_MESSAGES/*.mo` is the gitignored compiled
  output. The dev loop:

  ```bash
  make pot            # re-extract strings into po/ai-usagebar@wilfison.pot
  make update-po      # msgmerge each po/*.po against the refreshed template
  make compile-locale # msgfmt po/*.po → locale/<lang>/LC_MESSAGES/*.mo (dev/live)
  make i18n-check     # CI gate: .pot drift (regenerate+diff) + msgfmt --check
  make pack           # zip with --podir=po so .mo files ship in the bundle
  ```

- **Adding a language** (3 commands, no source changes): copy the template and
  translate, then compile and test under that locale —
  `msginit --input=po/ai-usagebar@wilfison.pot --locale=<ll> --output=po/<ll>.po`,
  fill every `msgstr` (preserve `%`/`{token}`/brand names), then
  `make compile-locale` and verify with the recipe below. Wire the new id only by
  shipping the `.po`; `make i18n-check` keeps it honest.
- **Adding a string.** Wrap it in `_('literal')` (inject `_` if the module is
  pure), run `make pot` + `make update-po`, translate the new `msgid` in each
  `po/*.po`, then `make i18n-check`.

#### Verifying a translation (Wayland-gated)

The running session's locale is fixed, so `make reload` will **not** switch
language — you must launch a nested shell with the target locale, or do a full
relog under it:

```bash
make compile-locale
env LANG=pt_BR.UTF-8 LANGUAGE=pt_BR make run   # nested gnome-shell (Wayland)
```

In the nested shell, open the popup (and scroll-cycle a vendor), check the panel
label, the menu items, and the prefs window, then watch `make logs` for errors.
Record the exact commands + what you observed; never claim "verified" from code
reading alone. Swap the locale (`es_ES.UTF-8`, `fr_FR.UTF-8`, `de_DE.UTF-8`) to
spot-check the other catalogs.

## Conventions

- `*.credentials.json`, `auth.json`, and `*.compiled` are gitignored; never
  commit real OAuth creds or API keys. Don't `cat` credential files — use
  `jq 'keys'`.
- Keep API usage on the GNOME 50 ESM surface — `gi://` imports and
  `resource:///org/gnome/shell/…`, no legacy `imports.*` syntax (the lint
  enforces this).
- **Pure modules stay `gi://`-free, including gettext.** They never import the
  translator; they take an injected `_ = (s) => s` parameter (default identity)
  that the gi-bound caller supplies. User-facing text is always a plain string
  literal inside `_()`; interpolate with `vformat()` (see Internationalization),
  never a template literal. Wrapping the same string in two places is fine —
  `xgettext` dedupes identical `msgid`s.
- **Comments are a last resort — make the code self-explanatory first.** Don't
  restate what the code already says; add a comment only for the non-obvious
  *why* (a workaround, an invariant, a gotcha). When one is needed, keep it
  short — one line where possible.

## Testing policy

**Anything that can be tested must be tested.** The boundary between testable and
not-testable is the `gi://` import line:

- **Pure JS (testable — write automated tests):** response parsers, quota /
  percentage math, formatters, severity/pacing/countdown, vendor `parser.js` and
  `section.js` adapters, `config.js` / `config-resolve.js`, OAuth/JWT helpers.
  Keep these free of `gi://` imports so they run under `gjs -m` (and node where
  possible). Put each test in a `*.test.js` mirroring the source path — e.g.
  `lib/vendors/zai/parser.js` → `tests/lib/vendors/zai/parser.test.js` (a vendor
  `main.js` fetch state machine maps to `main.test.js`). **A new pure-JS module
  without a matching test file is incomplete.** Run `make test` and `make lint`
  before declaring a change done.
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

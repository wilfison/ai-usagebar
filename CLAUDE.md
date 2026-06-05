# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **GNOME Shell extension** (GJS / ES modules) that shows AI plan usage —
Claude, GPT, GLM/Z.AI, OpenRouter — in the top panel. It is a port of the Rust
Waybar widget `ai-usagebar` by akitaonrails; see `metadata.json` description.

**Current state:** `extension.js` is still the unmodified GNOME extension
template (a smiley `PanelMenu.Button` with a "Show Notification" item). The real
indicator, per-vendor fetching, and tooltip/popup UI have not been written yet.
Treat the Rust project as the spec, not this file.

## Architecture (GNOME extension)

A GNOME extension has a fixed shape; the whole entry point is `extension.js`:

- The default-exported class extends `Extension` and implements `enable()` /
  `disable()`. Everything created in `enable()` MUST be torn down in `disable()`
  (destroy widgets, remove timeout sources via `GLib.Source.remove`, drop refs).
  GNOME reviewers reject extensions that leak on disable.
- The panel widget is a `GObject.registerClass`'d subclass of
  `PanelMenu.Button`, added via `Main.panel.addToStatusArea(this.uuid, …)`.
- Imports use `gi://` for GObject introspection (St, GObject, GLib, Soup for
  HTTP) and `resource:///org/gnome/shell/…` for shell UI modules.
- HTTP: use `Soup` + `Gio` async (libsoup3) for fetches; never block the main
  loop. Periodic refresh uses `GLib.timeout_add_seconds` — upstream polls at
  300s because the undocumented endpoints rate-limit below that.

## Develop / test

GNOME extensions are not "built" — JS is loaded directly by gnome-shell. This
repo IS the installed extension (it lives under
`~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison`).

The `Makefile` is the canonical entry point for the dev loop — prefer these
targets over typing the raw `gnome-extensions` / `journalctl` / `gjs` commands.
Run `make` (or `make help`) to list them:

```bash
make enable    # gnome-extensions enable ai-usagebar@wilfison
make disable   # gnome-extensions disable ai-usagebar@wilfison
make reload    # disable + enable (Wayland still needs a full relog)
make logs      # journalctl -f -o cat /usr/bin/gnome-shell
make test      # gjs -m tests/run.js — pure-JS unit suite
make lint      # tools/lint.sh — trailing-newline + no-imports.* check
make pack      # gnome-extensions pack . --force → upload zip
make info      # gnome-extensions info ai-usagebar@wilfison
```

`metadata.json` declares `shell-version: ["50"]` — keep API usage on the GNOME
50 ESM API surface (no legacy `imports.*` syntax).

## Conventions

- `*.credentials.json` and `*.compiled` are gitignored; never commit real OAuth
  creds or API keys (same secret-discipline as upstream — don't `cat` credential
  files, use `jq 'keys'`).
- **Source `*.js` files must be documented with JSDoc.** Every file under
  `lib/`, `ui/`, `tools/`, `extension.js`, and shared test utilities
  (`tests/_assert.js`, `tests/_http-server.js`, `tests/run.js`) starts with a
  `@file` block describing the module's purpose. Every exported function,
  class, and constant carries a JSDoc block with `@param` / `@returns` (and
  `@throws` when the contract includes throwing). Use `@typedef` for
  structured shapes reused across functions (HTTP results, OAuth credentials,
  vendor payloads). **`tests/*.test.js` files do NOT need JSDoc** — the
  `describe`/`it` names already describe intent, and a `@file` header would
  just be noise. Keep blocks tight: types and contract first, prose only when
  the WHY isn't obvious (consistent with the "no useless comments" rule).

## Testing policy

**Anything that can be tested must be tested.** Ship no code path that has not
been exercised at least once. In this codebase the boundary between testable
and not-testable is the `gi://` import line:

- **Pure JS (testable — write automated tests):** response parsers, quota /
  percentage math, formatters (e.g. `formatTimeRemaining`, label builders),
  vendor adapters that take a JSON blob and return a normalized struct, config
  loaders. Keep these in modules with **no `gi://` imports** so they can run
  under plain `node --test` (or `gjs -m` for ESM parity). Put tests in
  `tests/*.test.js` mirroring the source path and run them with `make test`.
  Also run `make lint` (trailing newline + no `imports.*` legacy syntax) before
  declaring a change done. A new pure-JS module without a matching test file
  is incomplete.
- **GJS / Shell-bound (manual — document the check):** anything touching `St`,
  `PanelMenu`, `Main.panel`, `Soup`, `GLib.timeout_add_seconds`, or
  `GObject.registerClass`. Reload the extension (see *Develop / test* above),
  watch `journalctl -f -o cat /usr/bin/gnome-shell` for errors, and verify the
  panel widget behaves as expected. In the PR / task notes, write the exact
  reload + observation steps you ran — not "tested manually".
- **Packaging:** before declaring a release-ready change, run `make pack` and
  `make info` and confirm both succeed without warnings.
- **Never fake a test result.** If something genuinely cannot be tested in the
  current environment (e.g. no live Claude/OpenRouter credentials), say so
  explicitly in the response — do not claim "verified" based on code reading
  alone.

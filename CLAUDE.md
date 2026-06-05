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

```bash
# Reload after editing (Wayland needs a full session relog; Xorg can use Alt-F2 'r')
gnome-extensions disable ai-usagebar@wilfison && gnome-extensions enable ai-usagebar@wilfison

# Live logs — the only real debugger for shell extensions
journalctl -f -o cat /usr/bin/gnome-shell

# Validate metadata / pack
gnome-extensions info ai-usagebar@wilfison
gnome-extensions pack .            # produces the zip for upload
```

`metadata.json` declares `shell-version: ["50"]` — keep API usage on the GNOME
50 ESM API surface (no legacy `imports.*` syntax).

## Conventions

- `*.credentials.json` and `*.compiled` are gitignored; never commit real OAuth
  creds or API keys (same secret-discipline as upstream — don't `cat` credential
  files, use `jq 'keys'`).
- SPDX `GPL-2.0-or-later` header at the top of each JS file (see `extension.js`).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (GJS, ES modules, `shell-version` 47 to 51, developed on 50) that shows AI plan
usage in the top panel for Anthropic, OpenAI, Z.AI, OpenRouter, DeepSeek, Kimi, Ollama Cloud and one
user-mapped custom provider. Port of the Rust Waybar widget
[ai-usagebar](https://github.com/akitaonrails/ai-usagebar). This checkout IS the installed extension
(`~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison`); there is no build step.

## Commands

The `Makefile` is the dev loop (`make` lists targets):

```bash
make test        # all tests (NO_COLOR=1 for plain output)
gjs -m tests/lib/vendors/anthropic/parser.test.js   # one test file
make lint        # tools/lint.sh
make eslint      # needs `npm ci`
make validate    # metadata.json + gschema --strict
make i18n-check  # stale .pot / malformed .po
make headless    # isolated headless gnome-shell (tools/headless.sh)
make run         # nested gnome-shell (logs to this terminal)
make pack        # release zip
```

CI runs schemas, test, lint, eslint, validate and i18n-check. New tests mirror the source path
(`lib/x.js` → `tests/lib/x.test.js`; older ones sit flat in `tests/`); shared fixtures live in
`tests/_harness.js`.

## Architecture

- `extension.js` builds `ui/indicator.js` (and rebuilds it when the panel position changes), owns the
  `toggle-menu` keybinding, and releases all of it in `disable()`.
  Everything created must be released on disable (widgets, GLib sources, signals, Soup session).
- **Vendor adapters.** The indicator never branches per vendor. `lib/vendors/registry.js` maps an id
  to a uniform adapter. Each vendor is `lib/vendors/<vendor>/` with `adapter.js`, `main.js` (fetch via
  `runFetch()` in `fetch-common.js`, never throws), `parser.js` and `section.js` (both pure). Shared
  helpers sit flat in `lib/vendors/`. Adding a vendor also means `lib/vendors.js` (append last: gschema
  enum order), gschema keys, a prefs page (`vendorPageSpec` in `lib/prefs-pages.js`) and an icon.
- **Data flow.** `FetchResult` is `{ok:true, snapshot, stale, ...}` | `{ok:false, kind:'loading'}` |
  `{ok:false, kind:'error', message?, code?, ...}`. Rendered as panel segments (`lib/panel-segments.js`) and
  popup sections (`buildSection` → `ui/vendorSection.js`, which owns no prose).
- **Config.** GSettings is the only source of truth, read through `lib/config.js` `readConfig()`;
  resolution helpers in `lib/config-resolve.js`. `primary-vendor` is the default, `active-vendor` the
  scroll/click selected one.
- **Cache.** `lib/cache.js`: per-vendor dir with payload + `.stale` / `.last_error` / `.retry_after`.
  Payload is always the projected snapshot; bump the vendor's `CACHE_VERSION` when
  its shape changes.
- **HTTP.** `lib/http.js` is the only Soup user, async. Never block the main loop.
- **Prefs** run in a separate process: `prefs.js` + `prefs/`, pure modules only (no adapter registry).
  A new top-level dir needs `--extra-source` in `make pack`.

## Documentation (`docs/`)

`docs/` is the project knowledge base, in English, as plain markdown (Open Knowledge Format, OKF 0.2).
Start at `docs/index.md`; areas are `architecture/`, `features/`, `vendors/`, `development/`. Read the
relevant concept before changing that part of the code.

Keep it in sync by hand when a change alters documented behavior (no OKF tooling needed):

- One concept per file. Each starts with YAML frontmatter: `type` (required; reuse `Project`,
  `Component`, `Contract`, `Behavior`, `Vendor`, `Playbook`, `Convention`), `title`, `description`
  (quote it if it contains `: `), `tags` (reuse existing ones), `generated` (`by:` who wrote it, e.g.
  `human:<id>` or `claude/<model>`; `at:` ISO datetime, bump it on edit) and `sources` (`id`, `title`,
  `resource`: a repo-relative code path, or a GitHub URL for `.md` files outside `docs/`).
- Cite a claim with a footnote on the source id (`text.[^cache]`); link other concepts with absolute
  bundle paths (`[cache](/architecture/cache.md)`).
- `index.md` files have no frontmatter (except the root one, which only carries `okf_version: "0.2"`)
  and list every concept in their directory as `* [Title](file.md) - description`. Update the listing
  when adding, renaming or removing a file.
- Add a dated `## YYYY-MM-DD` entry, newest first, to `docs/log.md` saying what changed.
- Document only what is in git; capture the why and cross-module behavior, not what one file says.

## Rules

- **Pure modules stay `gi://`-free**, gettext included: they take an injected `_ = (s) => s` (and
  `ngettext`). Pure code must have tests; shell-bound code is checked live with `tools/headless.sh`
  (`start --fake-pct 40`, `probe`, `shot`, `log`; `stop` + `start` after JS changes).
  Dev env overrides: `AI_USAGEBAR_FAKE_PCT`, `AI_USAGEBAR_FAKE_ERROR`, `AI_USAGEBAR_FAKE_DELAY_MS`.
- **i18n.** Strings are `_('plain literal')`, never template literals; interpolate with `vformat()`
  from `lib/format.js`. After adding a string: `make pot`, `make update-po`, translate
  (`make i18n-todo`, `tools/i18n.sh fill`), `make i18n-check`. Brand names, `{tokens}` and `%s` stay
  untranslated. Reuse existing catalog terms.
- No legacy `imports.*` syntax (lint enforces).
- **No em dash (U+2014) anywhere**: code, strings, translations, docs, commits.
- Commits are Conventional Commits; never cite PRD stories (`US-001`). PRs follow
  `.github/pull_request_template.md`.
- Comments only for a non-obvious why; keep them short.
- Never commit or `cat` credential files (`*.credentials.json`, `auth.json`); use `jq 'keys'`.
- Never claim "verified" from code reading alone.

# AI Usage Bar

A GNOME Shell extension that shows your AI plan usage in the top panel for five
vendors — **Anthropic (Claude)**, **OpenAI (Codex)**, **Z.AI / GLM**,
**OpenRouter**, and **DeepSeek**.

## Overview

The panel shows a compact label for the **active** vendor — by default the
vendor short code, the current session usage percentage, and when that window
resets (e.g. `Claude 42% · 3h12m`). The label is colored by severity (green →
orange → red) as you approach a limit, and a trailing `⏸` marks data served from
cache after a failed refresh.

Clicking the panel button opens a popup with a **collapsible sub-section per
enabled vendor**, each showing the structured breakdown (per-window usage, reset
countdowns, credit balances, and so on) laid out as a boxed-list card. **Scroll**
the panel button to cycle through your enabled vendors; the footer has
icon-buttons to refresh the active vendor, refresh all vendors, and open
preferences.

## Supported vendors

| Vendor                 | What is shown                                    | Auth model                                                           |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| **Anthropic (Claude)** | Session + weekly usage %, reset countdowns, plan | OAuth credentials from `~/.claude/.credentials.json`, auto-refreshed |
| **OpenAI (Codex)**     | Plan usage and reset windows                     | OAuth from `~/.codex/auth.json`; optional admin key for org usage    |
| **Z.AI / GLM**         | Plan usage and reset windows                     | API key (env var or prefs entry)                                     |
| **OpenRouter**         | Credit balance and usage                         | API key (env var or prefs entry)                                     |
| **DeepSeek**           | Balance / credits                                | API key (env var or prefs entry)                                     |

Only the **active** vendor is polled on the refresh timer; other enabled vendors
render from the last fetched result and are refreshed lazily on scroll-cycle or
via the popup's "Refresh all" button.

## Install

This extension targets **GNOME Shell 50**. There is no build step — it is plain
GJS / ES modules.

### From a packed zip

1. Download `ai-usagebar@wilfison.shell-extension.zip` from the
   [latest release](https://github.com/wilfison/ai-usagebar/releases/latest),
   or build it from a checkout with `make pack`.
2. Install it:

   ```bash
   gnome-extensions install --force ai-usagebar@wilfison.shell-extension.zip
   ```

   Or unzip it manually into
   `~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison/`.

3. **Log out and back in** (on Wayland a full relog is required to load a new
   extension), then enable it:

   ```bash
   gnome-extensions enable ai-usagebar@wilfison
   ```

## Authentication

Credentials are read **locally** from disk or the environment — they are never
sent anywhere except the vendor's own usage endpoint.

- **Anthropic (Claude).** Reads OAuth credentials from
  `~/.claude/.credentials.json` (the same file the Claude CLI writes). The
  access token is refreshed automatically when it expires, and the refreshed
  token is written back to that file. The credentials path is configurable in
  preferences.
- **OpenAI (Codex).** Reads OAuth credentials from `~/.codex/auth.json`. An
  optional admin API key (default env var `OPENAI_ADMIN_KEY`) can be set for
  organization-level usage. The auth path is configurable in preferences.
- **Z.AI / GLM, OpenRouter, DeepSeek.** Use an API key. The key is resolved in
  this order:
  1. the named **environment variable** (defaults `ZAI_API_KEY`,
     `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`) if it is set;
  2. otherwise the **inline key** entered in preferences;
  3. otherwise the vendor reports a configuration error in its popup section.

## Configuration

Open preferences with `gnome-extensions prefs ai-usagebar@wilfison` (or the
gear button in the popup footer). The prefs window exposes:

- **Primary vendor** — the default active vendor on startup.
- **Refresh interval** — seconds between polls (minimum 300; the vendor
  endpoints rate-limit below that).
- **Per-vendor enable** — toggle each of the five vendors on or off; only enabled
  vendors appear in the popup and the scroll cycle.
- **Panel label format** (`bar-format`) — a template with `{token}` placeholders,
  e.g. the default `{vendor_short} {session_pct}% · {session_reset}`.
- **Tooltip / extra rows format** (`tooltip-format`) — optional additive rows
  prepended to a vendor's popup section.
- **Severity colors** — the green / orange / red / critical threshold colors.
- **Pace marker** — show an on-/off-pace indicator comparing usage against
  elapsed time in the window.
- **Per-vendor auth** — credentials path (Anthropic/OpenAI), API-key env-var name
  and inline key (Z.AI/OpenRouter/DeepSeek), and Z.AI plan tier.

## Privacy & security

- The extension reads your **local** credential files
  (`~/.claude/.credentials.json`, `~/.codex/auth.json`) and any API keys you
  configure, only to authenticate requests to each vendor's usage endpoint.
- It contacts **only** the vendor usage APIs, over HTTPS, to fetch your plan
  status.
- There is **no telemetry** and no third-party analytics. Nothing is sent
  anywhere other than the vendor whose usage you are viewing.
- Credential files such as `*.credentials.json` and `auth.json` are never copied
  or logged; refreshed Anthropic tokens are written back only to the same local
  file they came from.

## Development

There is no build step; GNOME Shell loads the JS directly.

### Dependencies

- `gjs` — runs the pure-JS unit suite (`make test`) and the extension itself.
- `glib2` — provides `glib-compile-schemas` (`make schemas`) and the
  `gnome-extensions` packing tool (`make pack`).
- `gettext` — `msgfmt` / `msgmerge` / `xgettext` for the i18n targets.
- `libsoup3` — the libsoup3 typelib, so `gi://Soup` resolves in tests.
- `mutter-dev` — to launch a nested Wayland session with `make run`

**On Ubuntu**

```bash
sudo apt install gjs libglib2.0-bin gettext gir1.2-soup-3.0 mutter-dev-bin
```

**On Arch**

```bash
sudo pacman -S gjs glib2-devel gnome-shell gettext libsoup3 mutter
```

ESLint (`make eslint`) additionally needs Node and the dev deps: `npm ci`.

The `Makefile` is the canonical dev loop — run `make` to list all targets. The
common ones:

```bash
make test      # gjs pure-JS unit suite
make lint      # hygiene lint
make eslint    # GNOME Shell flat eslint config (needs npm ci)
make validate  # metadata.json + schema --strict
make run       # launch a throwaway nested gnome-shell (Wayland) to test live
make logs      # follow the gnome-shell journal
make pack      # build the installable zip (with compiled locales)
```

Contributions and bug reports are welcome at the project repository:
<https://github.com/wilfison/ai-usagebar>.

## Credits

This extension is an independent GNOME Shell port inspired by the
[`akitaonrails/ai-usagebar`](https://github.com/akitaonrails/ai-usagebar) Waybar
widget. Vendor names (Claude, OpenAI, Z.AI/GLM, OpenRouter, DeepSeek) are used
nominatively to identify each provider; no affiliation or endorsement is implied.

## License

MIT — see [`LICENSE`](LICENSE). The MIT license is GPL-compatible, so the
extension can be freely used and redistributed alongside GPL-licensed GNOME
components.

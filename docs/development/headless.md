---
type: Playbook
title: Headless shell
description: tools/headless.sh runs an isolated headless gnome-shell with its own HOME, dconf, cache and D-Bus to check the extension live.
tags: [testing, gnome-shell]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T14:30:00Z
sources:
  - id: headless
    title: tools/headless.sh
    resource: tools/headless.sh
  - id: fake
    title: lib/debug.js
    resource: lib/debug.js
  - id: devfetch
    title: ui/devFetch.js
    resource: ui/devFetch.js
  - id: vendor-fakes
    title: lib/vendors (each parser's fakeSnapshot)
    resource: lib/vendors
---

# Overview

A gnome-shell with its own HOME, dconf, cache and D-Bus session, a virtual 1920x1080 monitor, and this checkout linked in; nothing touches the real session.[^headless] State lives in `$AI_USAGEBAR_HEADLESS_DIR` (default `/tmp/ai-usagebar-headless`). Run the script with no arguments for every subcommand.

```bash
tools/headless.sh start --fake-pct 40 --fake-pct-weekly 95   # --lang pt_BR, --fake-error zai,openai:stale, --fake-delay 3000, --fake-incident partial_outage
                                           # --fake-elapsed 62, --fake-trend, --dark, --refresh-interval 86400
tools/headless.sh gsettings set org.gnome.shell.extensions.ai-usagebar panel-vendors "['anthropic','openai']"
tools/headless.sh probe                    # active vendor, poll set, segments, results (JSON)
tools/headless.sh click 900 16; tools/headless.sh keys Super_L u
tools/headless.sh shot popup 800 0 500 640 # tmp/screenshots/popup.png, delete when done
tools/headless.sh shot-popup popup         # the open popup, cropped to its border
tools/headless.sh prefs --page popup; tools/headless.sh shot-window prefs   # preferences on a page, frame only
tools/headless.sh log 'JS ERROR|ai-usagebar'; tools/headless.sh stop
```

# Gotchas

- JS changes need `stop` + `start`: the shell loads them once.
- Read button and segment geometry from `probe` before clicking; a click outside the button hits the clock.
- `start` spends the first events of the virtual pointer, which a fresh device drops.
- `prefs` reopens preferences in a fresh process, because the prefs service keeps the `.mo` it first loaded ([i18n](/development/i18n.md)). `--page` reaches that process through the bus's activation environment (`AI_USAGEBAR_PREFS_PAGE`), since the service is D-Bus activated.
- `start` leaves the overview the session opens in, so shots show the desktop. Fake data is fetched again every `refresh-interval`, which undoes an `eval` edit of a result; `--refresh-interval 86400` holds it.
- The cursor shows in shots: `move` it off the target first.
- No settings portal runs, so the accent colour stays the default whatever `accent-color` says.
- [Screenshots](/development/screenshots.md) chains these into the README images.

# Fake data overrides

Also honoured by `make run`:[^fake]

| Variable | Effect |
| --- | --- |
| `AI_USAGEBAR_FAKE_PCT` | Every adapter returns `fakeSnapshot(pcts, now, config)`, custom provider included |
| `AI_USAGEBAR_FAKE_PCT_<KIND>` | One window kind, for every vendor that has it: `SESSION`, `WEEKLY`, `MONTHLY`, `SONNET`, `SCOPED`, `MCP`, `CODE_REVIEW`, `CREDITS`. Any of them turns synthetic usage on; an unset kind takes `AI_USAGEBAR_FAKE_PCT`, or 0 without it. `tools/headless.sh start --fake-pct-<kind> N` (`--fake-pct-code-review`) and `make headless FAKE_PCT_<KIND>=N` pass them |
| `AI_USAGEBAR_FAKE_ELAPSED` | How much of every fake window has passed (0..100, default 0), so pace, the "on pace for" projection and the pace marker have something to show. Alone it fakes nothing |
| `AI_USAGEBAR_FAKE_TREND` | `1`: each fake window's [usage trend](/features/usage-trend.md) starts from a seeded rising line ending at its percentage, instead of waiting for three fetches |
| `AI_USAGEBAR_PREFS_PAGE` | A nav id (`popup`, `anthropic`...): the preferences open on that page |
| `AI_USAGEBAR_FAKE_ERROR` | `zai,openai:stale` (`*` for all): with FAKE_PCT, `id` is an error and `id:stale` a stale snapshot with an HTTP 503 `lastError`; without it, the real fetch runs against an HTTP 503 (and writes that cache) |
| `AI_USAGEBAR_FAKE_DELAY_MS` | Every fetch waits first, to see loading states |
| `AI_USAGEBAR_FAKE_INCIDENT` | A Statuspage severity (`partial_outage`, `major_outage`, `degraded_performance`, `under_maintenance`): every [provider status](/features/provider-status.md) lookup answers with a fake incident, no request made |

Kimi's 5h window and the custom provider's paced metric read `SESSION`. `CREDITS` is the consumed share of a balance or pool: OpenRouter, DeepSeek, Ollama credits, Anthropic cloud credits and the custom provider's money metric. This lets one session test mixes such as a capped weekly with a quiet session, or a drained balance next to idle windows.[^vendor-fakes]

The parsing is pure (`lib/debug.js`, the windows in `lib/vendors/fake.js`, the seeded line in `seedTrend()` of `lib/trend.js`); `DevFetch` in `ui/devFetch.js` reads the variables once per indicator and wraps every vendor fetch with them.[^devfetch]

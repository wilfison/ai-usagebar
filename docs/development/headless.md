---
type: Playbook
title: Headless shell
description: tools/headless.sh runs an isolated headless gnome-shell with its own HOME, dconf, cache and D-Bus to check the extension live.
tags: [testing, gnome-shell]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: headless
    title: tools/headless.sh
    resource: tools/headless.sh
  - id: fake
    title: lib/debug.js
    resource: lib/debug.js
---

# Overview

A gnome-shell with its own HOME, dconf, cache and D-Bus session, a virtual 1920x1080 monitor, and this checkout linked in; nothing touches the real session.[^headless] State lives in `$AI_USAGEBAR_HEADLESS_DIR` (default `/tmp/ai-usagebar-headless`). Run the script with no arguments for every subcommand.

```bash
tools/headless.sh start --fake-pct 40      # --lang pt_BR, --fake-error zai,openai:stale, --fake-delay 3000
tools/headless.sh gsettings set org.gnome.shell.extensions.ai-usagebar panel-vendors "['anthropic','openai']"
tools/headless.sh probe                    # active vendor, poll set, segments, results (JSON)
tools/headless.sh click 900 16; tools/headless.sh keys Super_L u
tools/headless.sh shot popup 800 0 500 640 # tmp/screenshots/popup.png, delete when done
tools/headless.sh log 'JS ERROR|ai-usagebar'; tools/headless.sh stop
```

# Gotchas

- JS changes need `stop` + `start`: the shell loads them once.
- Read button and segment geometry from `probe` before clicking; a click outside the button hits the clock.
- `start` spends the first events of the virtual pointer, which a fresh device drops.
- `prefs` reopens preferences in a fresh process, because the prefs service keeps the `.mo` it first loaded ([i18n](/development/i18n.md)).

# Fake data overrides

Also honoured by `make run`:[^fake]

| Variable | Effect |
| --- | --- |
| `AI_USAGEBAR_FAKE_PCT` | Every adapter returns `fakeSnapshot(pct, now, config)`, custom provider included |
| `AI_USAGEBAR_FAKE_ERROR` | `zai,openai:stale` (`*` for all): with FAKE_PCT, `id` is an error and `id:stale` a stale snapshot with an HTTP 503 `lastError`; without it, the real fetch runs against an HTTP 503 (and writes that cache) |
| `AI_USAGEBAR_FAKE_DELAY_MS` | Every fetch waits first, to see loading states |

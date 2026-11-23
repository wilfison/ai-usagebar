---
type: Project
title: AI Usage Bar
description: GNOME Shell extension showing AI plan usage in the top panel for seven vendors plus a user-mapped custom provider.
resource: https://github.com/wilfison/ai-usagebar
tags: [gnome-shell, distribution, privacy]
generated:
  by: claude/opus-5-5
  at: 2026-11-22T21:30:00Z
sources:
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
  - id: metadata
    title: metadata.json
    resource: metadata.json
---

# Overview

A GNOME Shell extension (GJS, ES modules) that shows plan usage for Anthropic, OpenAI, Z.AI, OpenRouter, DeepSeek, Kimi and Ollama Cloud, plus one [custom provider](/features/custom-provider.md).[^readme] It supports `shell-version` 47 to 51[^metadata] and is developed and tested on 50.[^readme]

It is a GNOME port of the Rust Waybar widget [akitaonrails/ai-usagebar](https://github.com/akitaonrails/ai-usagebar); changes there are pulled in through [upstream sync](/development/upstream-sync.md).

# Shape

- The panel shows one label per vendor segment, coloured by severity; clicking opens a popup with a collapsible section per enabled vendor. See [panel and popup](/architecture/panel-and-popup.md).
- Every vendor is driven through one uniform interface, the [vendor adapter](/architecture/vendor-adapters.md).
- There is no build step: gnome-shell loads the JS directly. The development checkout is not the installed extension (`~/.local/share/gnome-shell/extensions/ai-usagebar@wilfison` is a separate copy); [headless](/development/headless.md) symlinks the checkout into its own isolated HOME instead.

# Distribution

Shipped only as a GitHub release zip, never on extensions.gnome.org.[^readme] The [release process](/development/release.md) tags a version and CI publishes the zip.

# Privacy

No telemetry. Credentials are read locally and sent only to their vendor over HTTPS (the custom provider may opt into plain HTTP, meant for a local service); a cross-origin redirect is never followed ([HTTP](/architecture/http.md)). Only the projected figures are cached under `~/.cache/ai-usagebar/` (or `$XDG_CACHE_HOME`) ([cache](/architecture/cache.md)); refreshed OAuth tokens are written back only to the file they came from.[^readme]

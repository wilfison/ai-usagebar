---
type: Playbook
title: Upstream sync
description: make upstream-diff lists the Rust upstream changes since a tag that touch code this port mirrors.
tags: [gnome-shell]
generated:
  by: claude/opus-5-5
  at: 2026-11-22T12:00:00Z
sources:
  - id: tool
    title: tools/upstream-diff.sh
    resource: tools/upstream-diff.sh
---

# Overview

`make upstream-diff FROM=<last synced tag>` clones or fast-forwards [akitaonrails/ai-usagebar](https://github.com/akitaonrails/ai-usagebar) into `tmp/ai-usagebar-rust` and prints the CHANGELOG entries since that tag, then the commits and files touching code this port mirrors (our vendors, shared pacing/format/notify logic, its `gnome-extension/`), and only counts the rest (macOS, Windows, TUI, vendors we lack).[^tool] Triage starts from that list. The last synced tag is v1.53.0. On a sync, also check that the [provider status](/features/provider-status.md) component names still exist on the live status pages.

# GNOME Shell sources

The installed shell's JS is in a gresource: `gresource extract /usr/lib/gnome-shell/libshell-*.so /org/gnome/shell/ui/panelMenu.js`. Other versions come from GitLab, e.g. `curl -sS https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/49.0/js/ui/panelMenu.js`. Behaviour that changed between 47 and 51 (the panel click, see [panel and popup](/architecture/panel-and-popup.md)) is checked live only on the installed version; cite the source for the others.

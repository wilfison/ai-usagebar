---
type: Behavior
title: Context monitor
description: Optional scan of the newest Claude Code transcripts to show each session's context window usage in the Anthropic section.
tags: [privacy]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:40:34Z
sources:
  - id: parser
    title: lib/context/parser.js
    resource: lib/context/parser.js
  - id: scan
    title: lib/context/scan.js
    resource: lib/context/scan.js
---

# Overview

`lib/context/parser.js` is the pure transcript-tail parser;[^parser] `lib/context/scan.js` (async Gio) walks `~/.claude/projects` and reads the tails of the 8 newest sessions, bounded to 10 000 walked entries and 2 MiB per tail.[^scan]

The indicator scans only while `context-enabled` is on and only for an `ok` [Anthropic](/vendors/anthropic.md) result, passing the scan to `buildSection` as `meta.sessions`. A default window size, and optional per-model sizes, turn token counts into percentages. The per-model JSON is checked in the preferences (`validateModelWindows()`), and only a valid text is saved.

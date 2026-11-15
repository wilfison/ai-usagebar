---
type: Vendor
title: OpenRouter
description: Credit balance and usage from the OpenRouter API; a management key adds recent models.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: main
    title: lib/vendors/openrouter/main.js
    resource: lib/vendors/openrouter/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Calls `/credits` and `/key` under `https://openrouter.ai/api/v1` with `OPENROUTER_API_KEY`. `/activity` answers only to a management key (`OPENROUTER_MANAGEMENT_API_KEY`), which adds the two most recently used models.[^main]

It has no usage windows, so the shared `session_` / `weekly_` placeholders hold the consumed share.[^readme]

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

---
type: Vendor
title: DeepSeek
description: Account balance from the DeepSeek balance endpoint with an API key.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:57:13Z
sources:
  - id: main
    title: lib/vendors/deepseek/main.js
    resource: lib/vendors/deepseek/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Calls `https://api.deepseek.com/user/balance` with `DEEPSEEK_API_KEY`.[^main] Balance and credits only: no usage windows, so the shared `*_pct` and `*_elapsed` placeholders are `0` and the `*_reset` ones `-`.[^readme] Snapshot `CACHE_VERSION` is 1 ([cache](/architecture/cache.md)); its reader also rejects a non-numeric balance.

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

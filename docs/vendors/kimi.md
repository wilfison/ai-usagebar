---
type: Vendor
title: Kimi
description: Weekly quota and 5h window from the Kimi coding API with an API key.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:57:13Z
sources:
  - id: main
    title: lib/vendors/kimi/main.js
    resource: lib/vendors/kimi/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
  - id: parser
    title: lib/vendors/kimi/parser.js
    resource: lib/vendors/kimi/parser.js
---

# Overview

Calls `https://api.kimi.com/coding/v1/usages` and `/coding/v1/me` with `KIMI_API_KEY`.[^main] Shows weekly quota (or the monthly pool on newer accounts), the 5h window and plan.[^readme] The parser projects each block to the shared window shape (`utilizationPct`, `resetsAt`, `windowMs`), `null` when absent; a 5h window with a zero limit counts as absent, and the monthly pool has no `windowMs`, so no pace.[^parser] Snapshot `CACHE_VERSION` is 2 ([cache](/architecture/cache.md)).

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

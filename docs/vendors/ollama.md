---
type: Vendor
title: Ollama Cloud
description: Session and weekly usage, or monthly included and purchased credits, from the Ollama balance endpoint.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T15:00:00Z
sources:
  - id: main
    title: lib/vendors/ollama/main.js
    resource: lib/vendors/ollama/main.js
  - id: parser
    title: lib/vendors/ollama/parser.js
    resource: lib/vendors/ollama/parser.js
---

# Overview

Calls `https://ollama.com/api/balance` with `OLLAMA_API_KEY`. `/api/usage` is not used: it now returns request and token history, not quota.[^main]

Shows session and weekly usage, or the monthly included credits with purchased credits on a credits plan. `{oll_cost}` is always `-`, kept so older formats still render.[^parser] Snapshot `CACHE_VERSION` is 2.

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

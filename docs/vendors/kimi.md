---
type: Vendor
title: Kimi
description: Weekly quota and 5h window from the Kimi coding API with an API key.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: main
    title: lib/vendors/kimi/main.js
    resource: lib/vendors/kimi/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Calls `https://api.kimi.com/coding/v1/usages` and `/coding/v1/me` with `KIMI_API_KEY`.[^main] Shows weekly quota, the 5h window and plan.[^readme]

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

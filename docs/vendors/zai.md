---
type: Vendor
title: Z.AI / GLM
description: Plan usage and reset windows from the Z.AI quota monitor endpoint with an API key.
tags: [api-key, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: main
    title: lib/vendors/zai/main.js
    resource: lib/vendors/zai/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Calls `https://api.z.ai/api/monitor/usage/quota/limit` with the key from `ZAI_API_KEY` or prefs.[^main] Shows session, weekly and MCP windows with resets.[^readme]

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

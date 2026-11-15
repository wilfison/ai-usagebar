---
type: Vendor
title: OpenAI (Codex)
description: 5h and weekly Codex usage from the ChatGPT backend, using the Codex CLI OAuth credentials.
tags: [oauth, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: main
    title: lib/vendors/openai/main.js
    resource: lib/vendors/openai/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Reads `~/.codex/auth.json` (OAuth) and calls `https://chatgpt.com/backend-api/wham/usage`, plus `wham/rate-limit-reset-credits` when reset credits are available (an optional detail whose failure never reaches the user); the token refresh goes to `https://auth.openai.com/oauth/token` (`lib/oauth/openai.js`, JWT helpers in `lib/oauth/jwt.js`).[^main]

Shows 5h and weekly usage, code review, credits (a count, not dollars) and banked resets.[^readme] Snapshot `CACHE_VERSION` is 3.

Wired through the [vendor adapter](/architecture/vendor-adapters.md); failures follow the [fetch pipeline](/architecture/fetch-pipeline.md).

---
type: Vendor
title: Anthropic (Claude)
description: Session and weekly usage from the Claude OAuth usage endpoint, using the Claude Code credentials with auto refresh.
tags: [oauth, vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-22T12:00:00Z
sources:
  - id: main
    title: lib/vendors/anthropic/main.js
    resource: lib/vendors/anthropic/main.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

Reads `~/.claude/.credentials.json` (OAuth) and calls `https://api.anthropic.com/api/oauth/usage?cedar_ember=1`; a token expiring within 300 s is refreshed against `https://platform.claude.com/v1/oauth/token` through the shared refresh in `lib/oauth/` and written back to the same file.[^main] A token endpoint that rejects the refresh token with a 4xx other than 429 (400 "Refresh token expired") does not stop the fetch: its error is cleared and the usage request goes out with the current access token, so the result is the live reading or that request's own error rather than the cached weekly figure. A 429 or 5xx still stops before usage.[^main]

Shows session and weekly usage (no session row on a verified Ultra plan), model-scoped caps, extra usage, cloud session credits, usage credits, banked resets and plan.[^readme] Optionally the [context monitor](/features/context-monitor.md) adds the Claude Code sessions. While `status.claude.com` flags Claude Code or the Claude API, the card carries the [provider status](/features/provider-status.md) mark.

`tools/smoke-anthropic-refresh.js` is a manual smoke for the refresh path. Snapshot `CACHE_VERSION` is 3 ([cache](/architecture/cache.md)).

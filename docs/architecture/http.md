---
type: Component
title: HTTP layer
description: "lib/http.js is the only Soup consumer: async libsoup3 on a shared session, redirects followed by hand within one origin."
tags: [http, privacy]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:27:49Z
sources:
  - id: http
    title: lib/http.js
    resource: lib/http.js
---

# Overview

`lib/http.js` is the only module that imports Soup.[^http] It is async libsoup3 on one shared session, disposed in the extension's `disable()` ([lifecycle](/architecture/lifecycle.md)). Never block the main loop. A request without its own `User-Agent` sends `ai-usagebar/<version-name>`, set by `setUserAgent()` at enable; it is applied per request rather than as the session's `user_agent`, which would override a vendor's own (Anthropic requires the CLI's).

# Redirects

Soup runs with `NO_REDIRECT`; the module follows 301/302/303/307/308 itself, at most 10 hops, and only within the same scheme, host and port. A cross-origin redirect is returned as the 3xx, so a credential can never be forwarded to another origin.

Default timeout is 10 s. Pure helpers sit in `lib/http-util.js`.

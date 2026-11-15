---
type: Component
title: HTTP layer
description: "lib/http.js is the only Soup consumer: async libsoup3 on a shared session, redirects followed by hand within one origin."
tags: [http, privacy]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: http
    title: lib/http.js
    resource: lib/http.js
---

# Overview

`lib/http.js` is the only module that imports Soup.[^http] It is async libsoup3 on one shared session, disposed on the indicator's `destroy()` ([lifecycle](/architecture/lifecycle.md)). Never block the main loop.

# Redirects

Soup runs with `NO_REDIRECT`; the module follows 301/302/303/307/308 itself, at most 10 hops, and only within the same scheme, host and port. A cross-origin redirect is returned as the 3xx, so a credential can never be forwarded to another origin.

Default timeout is 10 s. Pure helpers sit in `lib/http-util.js`.

---
type: Component
title: Custom provider
description: Turns any GET JSON endpoint into a vendor through a user mapping of RFC 6901 JSON Pointers, validated in prefs and at fetch time.
tags: [vendors, errors]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:20:33Z
sources:
  - id: parser
    title: lib/vendors/custom/parser.js
    resource: lib/vendors/custom/parser.js
  - id: mapping
    title: lib/vendors/custom/mapping.js
    resource: lib/vendors/custom/mapping.js
  - id: pointer
    title: lib/json-pointer.js
    resource: lib/json-pointer.js
  - id: readme
    title: README.md
    resource: https://github.com/wilfison/ai-usagebar/blob/main/README.md
---

# Overview

The custom provider maps a user-chosen endpoint through `lib/json-pointer.js` (RFC 6901)[^pointer] with its configuration checked in `lib/vendors/custom/mapping.js` (`validateMapping`, `urlProblem`, `parseExtraHeaders`, `authHeaderOf`)[^mapping] and the response projected in `lib/vendors/custom/parser.js` (`parseUsage`, `shortCode`).[^parser] Its display name comes from the config, so `vendorLabel(id, config)` takes an optional config.

# Mapping

The user documentation of the mapping lives in the README.[^readme] The rules that matter for code:

- A metric has either `used` + `limit` or a single `percent`; numbers may be numeric strings.
- `resetsAt` takes RFC 3339 or a Unix epoch (s or ms); `resetsAfterSeconds` the seconds left. With `windowSecs` (at least 60) and a reset, the row gets [pace](/features/pace.md).
- `currency` formats `used`/`limit` or a numeric text as money; not allowed on a `percent` metric.
- Labels are 1 to 64 characters and unique. Prefs validate on focus-out and keep the last valid mapping.
- A pointer that does not resolve fails the fetch with a schema error; the last good figures stay, marked stale ([cache](/architecture/cache.md)).
- A mapping or extra headers that fail validation when the config is read give an error with code `invalid-mapping`, with no stale fallback.
- The URL must be `https://` unless `custom-allow-http` is on (meant for a local service; any host is then accepted).

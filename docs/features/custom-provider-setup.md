---
type: Playbook
title: Custom provider setup
description: How to turn your own JSON endpoint into a vendor from the Custom preferences page, with a worked mapping example.
tags: [vendors]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T15:00:00Z
sources:
  - id: mapping
    title: lib/vendors/custom/mapping.js
    resource: lib/vendors/custom/mapping.js
  - id: parser
    title: lib/vendors/custom/parser.js
    resource: lib/vendors/custom/parser.js
  - id: page
    title: prefs/custom.js
    resource: prefs/custom.js
---

# Steps

Open preferences, go to *Vendors* → **Custom** and fill in:[^page]

1. **Name**: the provider's display name.
2. **URL**: any address that answers a `GET` with JSON. It must be `https://`, unless you allow plain HTTP (meant for a local service).[^mapping]
3. **Authentication** (optional): the key inline or the name of an environment variable holding it, plus its header and scheme. The default is `Authorization: Bearer <key>`; without a key no auth header is sent.[^page][^mapping]
4. **Extra headers** (optional): a JSON object of header names to string values, not repeating the auth header.[^page]
5. **Mapping**: which fields of the response to show, addressed by [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901).

Then switch **Enabled** on. How the code validates and parses all of this is in [custom provider](/features/custom-provider.md).

# Example

Given this response:

```json
{
  "account": {"tier": "Team"},
  "requests": {"used": 420, "limit": 1000, "resets_at": "2026-10-01T00:00:00Z"},
  "tokens": {"percent": 91.5, "seconds_left": 5400},
  "status": {"region": "sa-east-1"}
}
```

this mapping shows two usage bars and a text row:

```json
{
  "planPath": "/account/tier",
  "metrics": [
    {"label": "Requests", "used": "/requests/used", "limit": "/requests/limit",
     "resetsAt": "/requests/resets_at", "windowSecs": 86400},
    {"label": "Tokens", "percent": "/tokens/percent", "resetsAfterSeconds": "/tokens/seconds_left"}
  ],
  "texts": [
    {"label": "Region", "value": "/status/region"}
  ]
}
```

# Mapping rules

- A **metric** has either `used` + `limit` or a single `percent`. Numbers may be JSON numbers or numeric strings.[^mapping]
- `resetsAt` takes an RFC 3339 timestamp or a Unix epoch (seconds or milliseconds); `resetsAfterSeconds` takes the seconds left. With `windowSecs` (at least 60) and a reset, the row gets the [pace](/features/pace.md) marker.[^parser]
- `currency` (a three-letter code such as `"USD"` or `"EUR"`) shows a metric's `used` and `limit`, or a numeric text, as money: `$12.50 of $60.00` instead of `12.5 of 60`. It cannot be set on a `percent` metric.[^mapping]
- A **text** shows a string, number or boolean. `plan` sets a fixed title; `planPath` reads it from the response.[^mapping]
- Labels are 1 to 64 characters and unique. The mapping is checked when the editor loses focus, and the last valid one is kept.[^mapping]
- A pointer that does not resolve fails the refresh; the last good figures stay on screen, marked stale.[^parser]

Each metric also feeds the panel label as `{custom_<i>_pct}` and `{custom_<i>_reset}`, counting from 0 ([label placeholders](/features/label-placeholders.md)).

---
type: Behavior
title: Provider status
description: The Claude and Codex cards take the colour of their official status page, with a mark and the incident title, while it flags one of that provider's components.
tags: [http, cache, privacy]
generated:
  by: claude/opus-5-5
  at: 2026-11-22T12:00:00Z
sources:
  - id: incident
    title: lib/incident.js
    resource: lib/incident.js
  - id: indicator
    title: ui/indicator.js
    resource: ui/indicator.js
  - id: card
    title: ui/vendorSection.js
    resource: ui/vendorSection.js
  - id: upstream
    title: upstream src/incident.rs (v1.53.0)
    resource: https://github.com/akitaonrails/ai-usagebar/blob/v1.53.0/src/incident.rs
---

# Overview

Ported from the upstream v1.53.0 status mark.[^upstream] Only Anthropic (`status.claude.com`) and OpenAI (`status.openai.com`) have a source; every other vendor, the custom provider included, never asks.[^incident] Both are Statuspage pages read through the unauthenticated `GET /api/v2/summary.json`.

# Matching

A page lists many products, so components are named one by one and matched by exact name, also with a parenthesised host suffix (`Claude API (api.anthropic.com)` is `claude api`):[^incident] Anthropic uses `claude code` and `claude api`, OpenAI `codex in chatgpt desktop` and `login`. Trouble in a neighbour on the same page (claude.ai, Cowork, the Chat Completions API) does not mark the vendor. A page that renames a component stops marking it silently, so check the names against the live page on an upstream sync.

- An open incident applies when one of its components is the vendor's; one that names no component applies only when its title carries a vendor word as whole words (`api`, `claude code`; `codex`). `resolved`, `postmortem` and `completed` incidents are ignored.
- Severity is the worst Statuspage status among the vendor's flagged components and applicable incidents: an incident ranks by its affected components' status, falling back to its declared impact (critical, major, minor, maintenance), since a `major` incident often leaves its components degraded.
- The title is the incident name, else the flagged component with its translated status, sanitized to one line and capped at 140 characters. The link is the page constant, never a URL from the response.

# Fetch and cache

`_fetchVendor()` runs `fetchIncident()` beside the usage fetch (`Promise.all`), so the mark refreshes on the same poll and the card waits at most the status request's own 4 s timeout.[^indicator] The raw summary body is cached for 5 minutes in its own [cache](/architecture/cache.md) directory (`incidents/status.claude.com`, `incidents/status.openai.com`); a non-2xx, transport failure or non-JSON body arms that directory's retry marker for 5 minutes. A failure is never read as "no incident" and never answered with an older body: it yields no mark, which says nothing about the provider's health.[^incident]

# Rendering

While the page flags the vendor, `VendorCard.setIncident()` colours the header name and appends `▲` in every card state (data, loading, error), and a data card opens with a warning row holding the title over the status label.[^card] Colours come from the theme: yellow degraded, orange partial outage, red major outage, blue maintenance, brightened on a dark popup like other text. The panel label is unchanged.

The `provider-status` setting (on by default, *Behavior* page) turns it off; off, no status request is made and the marks clear on the next repaint.[^indicator] `AI_USAGEBAR_FAKE_INCIDENT=<severity>` (`tools/headless.sh start --fake-incident partial_outage`) answers every status page with a fake incident, see [headless](/development/headless.md).

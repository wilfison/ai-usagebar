---
type: Component
title: Vendor adapters
description: The indicator drives every vendor through one uniform Adapter; each vendor is a directory with adapter, main, parser and section modules.
tags: [vendors, pure-modules]
generated:
  by: claude/fable-5-2
  at: 2026-11-15T14:00:00Z
sources:
  - id: registry
    title: lib/vendors/registry.js
    resource: lib/vendors/registry.js
  - id: adapter-common
    title: lib/vendors/adapter-common.js
    resource: lib/vendors/adapter-common.js
  - id: vendors-js
    title: lib/vendors.js
    resource: lib/vendors.js
---

# Overview

The indicator never branches per vendor. `lib/vendors/registry.js` maps a vendor id to an `Adapter` in `ADAPTERS`,[^registry] and the indicator calls `getAdapter(id)` and drives it generically. The adapter carries `id`, `cacheId`, `icon`, `vendorShort`, `fetchSnapshot`, vendor-prefixed `severity` / `peakUsage` (e.g. `anthropicSeverity`, mapped by the adapter), `placeholders`, `notifyRows`, `resetCredits`, `buildSection`, and optionally `fakeSnapshot` and `shortCode(config)`.

# The module quad

Each vendor lives in `lib/vendors/<vendor>/`:

| Module | Role | Purity |
| --- | --- | --- |
| `adapter.js` | Wires the others with `vendorAdapter()`;[^adapter-common] `apiKeyFetch()` / `guardedFetch()` turn a credential resolution error into the standard error result (the custom adapter uses neither: its key is optional) | Imports `main.js`, no `resource://`, so the whole registry loads under `gjs -m` |
| `main.js` | `fetchSnapshot`, a call to `runFetch()` (see [fetch pipeline](/architecture/fetch-pipeline.md)) with the vendor's request, parser and hooks | Cache and HTTP injected, tested against a temp cache; gi-bound only through `lib/oauth/` (Anthropic, OpenAI) |
| `parser.js` | The response parser (`parseUsage` in most vendors, with vendor arguments; `parseEnvelope`, `parseBalance`, `parseCredits`/`parseKey`/`parseActivity` elsewhere), `severity`, `peakUsage`, `placeholders` (`ngettext` injected where plurals occur), `notifyRows`, `resetCredits`, cache (de)serialization, `ICON`, `VENDOR_SHORT` | Pure |
| `section.js` | `buildSection(snapshot, meta, now, theme, _[, ngettext])` (`ngettext` in Anthropic, OpenAI, OpenRouter) returns an ordered list of typed rows | Pure |

Shared helpers stay flat in `lib/vendors/`: `fetch-common.js`, `parse-common.js` (`SchemaError`, JSON decode, `parseInstant`, window lengths), `placeholder-common.js`, `section-common.js` (`windowRow()`, `closingRows()`, `noWindowsRow()`, `errorText()`), `snapshot-cache.js`. The OAuth refresh both CLIs share is `lib/oauth/refresh.js`.

The pure `section.js` builders produce already-translated rows; the renderer `ui/vendorSection.js` maps row kinds (`window`, `gauge`, `text`, `group-heading`, `grouped`, `spacer`, `http-error`, `footer`) to St widgets inside the vendor's card and owns no prose; the section `title` becomes the plan beside the vendor name. See [panel and popup](/architecture/panel-and-popup.md). See [i18n](/development/i18n.md).

# Adding a vendor

1. Create `lib/vendors/<vendor>/` with the quad and register the adapter in `ADAPTERS`.
2. Append its id and label to `VENDOR_IDS` / `VENDOR_LABELS` in `lib/vendors.js`:[^vendors-js] **append last**, because the gschema enum ordinal and the prefs combo index follow that order.
3. Add the gschema keys, a prefs page (a `vendorPageSpec` entry, see [preferences](/architecture/prefs.md)), and `icons/<id>-symbolic.svg` or list the id in `GENERIC_ICON_VENDORS`. `tests/lib/vendors/registry.test.js` checks the shape and the icon.

The current vendors are listed in [vendors](/vendors/).

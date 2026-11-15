# Architecture

* [Extension lifecycle](lifecycle.md) - enable() builds the indicator, disable() must release everything it created.
* [Vendor adapters](vendor-adapters.md) - The uniform per-vendor interface and the four-module layout behind it.
* [Fetch pipeline](fetch-pipeline.md) - runFetch() and the FetchResult union every vendor returns.
* [Panel and popup](panel-and-popup.md) - Segments, single vs pinned mode, polling and repaint.
* [Configuration](config.md) - GSettings as the single source of truth, read through a snapshot.
* [Snapshot cache](cache.md) - Per-vendor payload and sidecars, freshness, stale fallback and 429 backoff.
* [HTTP layer](http.md) - The only Soup consumer: async, shared session, same-origin redirects.
* [Preferences window](prefs.md) - Separate process, pure imports, sidebar split view.

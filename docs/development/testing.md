---
type: Playbook
title: Testing
description: Pure modules get gjs unit tests mirroring the source path; gi-bound code is checked live and the steps written down.
tags: [testing, pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-15T18:38:53Z
sources:
  - id: run
    title: tests/run.js
    resource: tests/run.js
  - id: harness
    title: tests/_harness.js
    resource: tests/_harness.js
  - id: ci
    title: CI workflow
    resource: .github/workflows/ci.yml
---

# The boundary

What a module imports decides how it is tested:

- **Pure JS** (parsers, quota math, formatters, severity/pacing/countdown, vendor `parser.js` and `section.js`, config resolution, OAuth/JWT helpers): automated tests. Gio/Soup code that runs under bare `gjs -m` is unit-tested too: `lib/http.js` against `tests/_http-server.js`, `lib/cache.js`, and every vendor `main.js` in `main.test.js`. A new pure module without a matching test file is incomplete.
- **Shell-bound** (`St`, `PanelMenu`, `Main.panel`, `resource:///` imports, GLib timeouts in the UI, `GObject.registerClass` widgets): checked live with the [headless shell](/development/headless.md) or `make run`, and the exact steps recorded. On Wayland JS cannot hot-reload in-session.

Never claim "verified" from code reading alone; say what could not be tested.

# Running

```bash
make test                                            # whole suite (NO_COLOR=1 for plain output)
gjs -m tests/lib/vendors/anthropic/parser.test.js    # one file
make watch                                           # rerun on change (inotify-tools)
```

New tests mirror the source path (`lib/vendors/zai/parser.js` → `tests/lib/vendors/zai/parser.test.js`); older ones sit flat in `tests/` (`tests/cache.test.js`, `tests/pacing.test.js`, ...). `tests/run.js` discovers `*.test.js` recursively and runs each as an isolated `gjs -m` subprocess;[^run] each file ends with `system.exit(summary())`. Shared fixtures (`runSync`, `httpStub`, `routeStub`, `res`, `withTempDir`, `withCacheHome`, `backdate`, `fakeJwt`, and `testSettings(overrides)` / `extensionSchema()` for GSettings on a private memory backend) are in `tests/_harness.js`.[^harness]

# CI gate

`.github/workflows/ci.yml` runs `make schemas`, `make test`, `tools/lint.sh`, `npx eslint .`, `make validate` and `make i18n-check` on every PR and every push to `main`.[^ci] The [release](/development/release.md) workflow re-runs the same gate.

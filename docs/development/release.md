---
type: Playbook
title: Release
description: A release bumps two version fields, adds a CHANGELOG entry, commits, pushes an annotated tag, and CI publishes the zip.
tags: [distribution]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: skill
    title: release skill
    resource: https://github.com/wilfison/ai-usagebar/blob/main/.claude/skills/release/SKILL.md
  - id: workflow
    title: release workflow
    resource: .github/workflows/release.yml
---

# Steps

The `.claude/skills/release/` skill drives this end to end;[^skill] the manual equivalent:

1. Preflight on a clean, synced `main`: `make test && make lint && make eslint && make validate && make i18n-check && make pack`.
2. Bump: `python3 .claude/skills/release/scripts/bump.py <major|minor|patch> [--write]`. It updates `version-name` (semver) and `version` (GNOME integer, always +1) in `metadata.json`. `package.json`'s version is unused.
3. Add `## [<version-name>] - <YYYY-MM-DD>` to `CHANGELOG.md` (Keep a Changelog: Added, Changed, Deprecated, Removed, Fixed, Security), user-facing sentences.
4. `git commit -m "chore(release): v<version-name>"` with only `metadata.json` and `CHANGELOG.md`.
5. `git tag -a v<version-name> -m "Release <version-name>"` (annotated), then push commit and tag.

# CI

The tag push triggers `.github/workflows/release.yml`:[^workflow] it re-runs the CI gate, packs the zip and publishes the GitHub release (zip plus `.sha256`) whose body is the matching CHANGELOG section followed by install steps, checksums and a diff link. It fails if the tag does not match `version-name`. GitHub is the only distribution channel ([overview](/overview.md)); installed copies learn of it through the [update check](/features/update-check.md).

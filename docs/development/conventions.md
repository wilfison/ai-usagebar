---
type: Convention
title: Conventions
description: "Repository rules that are not enforced by a compiler: imports, punctuation, comments, commits and credentials."
tags: [pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-14T12:00:00Z
sources:
  - id: lint
    title: tools/lint.sh
    resource: tools/lint.sh
  - id: pr
    title: PR template
    resource: https://github.com/wilfison/ai-usagebar/blob/main/.github/pull_request_template.md
---

# Code

- Stay on the GNOME ESM surface: `gi://` and `resource:///org/gnome/shell/…` imports, no legacy `imports.*`. `tools/lint.sh` rejects `imports.*`, missing trailing newlines and SPDX headers.[^lint]
- Pure modules stay `gi://`-free, gettext included ([i18n](/development/i18n.md), [testing](/development/testing.md)).
- Comments are a last resort: only for a non-obvious why (a workaround, an invariant, a gotcha), short.
- **No em dash (U+2014) anywhere**: code, strings, translations, docs, commits. Use a comma, colon, parentheses or a new sentence.

# Commits and PRs

- Conventional Commits (`feat(panel): …`), with a co-author line when an agent wrote them.
- Never cite PRD stories (`US-001`) or PRDs: they live in the gitignored `tasks/`. Older history does, new commits must not.
- PR descriptions follow `.github/pull_request_template.md`.[^pr]

# Credentials

`*.credentials.json` and `*.compiled` are gitignored; never commit real tokens (the Codex `auth.json` lives outside the repo, in `~/.codex/`). Do not `cat` credential files; inspect with `jq 'keys'`.

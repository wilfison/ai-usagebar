#!/usr/bin/env bash
#
# What changed in the upstream Rust widget since the tag we last synced with:
# its CHANGELOG entries, and the commits and files that touch code we port
# (our vendors, the shared pacing/format/notify logic, its GNOME extension).
# Everything else (macOS, Windows, TUI, Omarchy, KDE, vendors we lack) is only
# counted, so the triage starts from a short list.
#
#   tools/upstream-diff.sh FROM_TAG [TO_REF]     e.g. tools/upstream-diff.sh v1.50.0
#
# The clone lives in tmp/ai-usagebar-rust (gitignored); it is created on first
# use and fast-forwarded with its tags. TO_REF defaults to origin/main.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$ROOT/tmp/ai-usagebar-rust"
URL="https://github.com/akitaonrails/ai-usagebar.git"
FROM="${1:?usage: $0 FROM_TAG [TO_REF]}"
TO="${2:-origin/main}"

# Upstream paths that hold logic we port. Vendors follow lib/vendors.js.
PORTED=(
    src/anthropic src/openai src/zai src/openrouter src/deepseek src/kimi src/ollama src/custom
    src/pacing.rs src/countdown.rs src/format.rs src/display.rs src/notify.rs src/severity.rs
    src/context src/jwt.rs src/cache.rs
    gnome-extension
)

if [ ! -d "$REPO/.git" ]; then
    mkdir -p "$ROOT/tmp"
    git clone --quiet "$URL" "$REPO"
fi
git -C "$REPO" fetch --quiet --tags origin
git -C "$REPO" merge --quiet --ff-only origin/main 2>/dev/null || true
git -C "$REPO" rev-parse --verify --quiet "$FROM^{commit}" >/dev/null || { echo "upstream-diff: unknown ref $FROM" >&2; exit 1; }

g() { git -C "$REPO" "$@"; }

echo "# Upstream ${FROM}..${TO} ($(g describe --tags "$TO" 2>/dev/null || g rev-parse --short "$TO"))"
echo
echo "Tags: $(g tag --sort=v:refname --contains "$FROM" --merged "$TO" | grep -vx "$FROM" | tr '\n' ' ')"
echo "Commits (no merges): $(g rev-list --count --no-merges "$FROM..$TO"); files: $(g diff --name-only "$FROM..$TO" | wc -l)"
echo

# The CHANGELOG lines added since FROM, i.e. every entry released after it.
echo "## CHANGELOG entries"
echo
g diff "$FROM..$TO" -- CHANGELOG.md | sed -n 's/^+\([^+]\)/\1/p; s/^+$//p'
echo

existing=()
for path in "${PORTED[@]}"; do
    if g cat-file -e "$TO:$path" 2>/dev/null || g cat-file -e "$FROM:$path" 2>/dev/null; then
        existing+=("$path")
    fi
done
# With no pathspec git would report every commit as ported code.
if [ ${#existing[@]} -eq 0 ]; then
    echo "upstream-diff: none of the ported paths exist at $FROM or $TO; upstream moved its layout, update PORTED in $0" >&2
    exit 1
fi

echo "## Commits touching ported code"
echo
g log --no-merges --format='- %h %s' "$FROM..$TO" -- "${existing[@]}"
echo
echo "## Files touched in ported code"
echo
g diff --stat=100 "$FROM..$TO" -- "${existing[@]}" | sed 's/^/    /'
echo
echo "## Elsewhere (counted only)"
echo
# Exact path or directory-prefix match, the way git reads the pathspecs above.
g diff --name-only "$FROM..$TO" | awk -v ported="${existing[*]}" '
    BEGIN { n = split(ported, p, " ") }
    {
        for (i = 1; i <= n; i++)
            if ($0 == p[i] || index($0, p[i] "/") == 1)
                next
        parts = split($0, part, "/")
        print (parts == 1 ? part[1] : part[1] "/" part[2])
    }' | sort | uniq -c | sort -rn | sed 's/^/    /'

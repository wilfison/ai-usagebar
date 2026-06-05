#!/usr/bin/env bash
#
# File-hygiene checks for the JS sources:
#   1. Trailing newline at EOF
#   2. No legacy `imports.*` usage

set -u

fail=0

scan_dirs=(lib tests ui)
files=$(find "${scan_dirs[@]}" -name '*.js' 2>/dev/null | sort)

for f in $files; do
    if [ -n "$(tail -c1 "$f")" ]; then
        echo "NO TRAILING NEWLINE: $f"
        fail=1
    fi
done

if grep -RnE '(^|[^a-zA-Z_.])imports\.' lib tests ui extension.js 2>/dev/null; then
    echo "FOUND LEGACY imports.* USAGE (see above)"
    fail=1
fi

if [ "$fail" -eq 0 ]; then
    echo "lint: OK"
fi

exit $fail

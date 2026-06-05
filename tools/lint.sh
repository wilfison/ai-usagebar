#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# File-hygiene checks for the JS sources:
#   1. SPDX header on line 1
#   2. Blank line on line 2
#   3. Trailing newline at EOF
#   4. No legacy `imports.*` usage

set -u

fail=0

scan_dirs=(lib tests ui)
files=$(find "${scan_dirs[@]}" -name '*.js' 2>/dev/null | sort)

for f in $files; do
    if ! head -1 "$f" | grep -q 'SPDX-License-Identifier: GPL-2.0-or-later'; then
        echo "MISSING SPDX: $f"
        fail=1
    fi
    line2=$(sed -n '2p' "$f")
    if [ -n "$line2" ]; then
        echo "NO BLANK LINE AFTER SPDX: $f"
        fail=1
    fi
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

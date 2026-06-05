#!/usr/bin/env bash
#
# File-hygiene checks for the JS sources:
#   1. Trailing newline at EOF
#   2. No legacy `imports.*` usage
#   3. No SPDX-License-Identifier headers (dropped in 6ed078b)

set -u

fail=0

scan_dirs=(lib tests tools ui)
files=$(find "${scan_dirs[@]}" -name '*.js' 2>/dev/null | sort)

for f in $files; do
    if [ -n "$(tail -c1 "$f")" ]; then
        echo "NO TRAILING NEWLINE: $f"
        fail=1
    fi
done

if grep -RnE --include='*.js' '(^|[^a-zA-Z_.])imports\.' lib tests tools ui extension.js 2>/dev/null; then
    echo "FOUND LEGACY imports.* USAGE (see above)"
    fail=1
fi

if grep -RnE --include='*.js' 'SPDX-License-Identifier' lib tests tools ui extension.js 2>/dev/null; then
    echo "FOUND SPDX HEADER (see above)"
    fail=1
fi

if [ "$fail" -eq 0 ]; then
    echo "lint: OK"
fi

exit $fail

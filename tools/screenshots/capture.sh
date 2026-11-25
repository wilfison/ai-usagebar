#!/usr/bin/env bash
#
# Regenerates screenshots/popup.png and screenshots/preferences.png from the
# headless shell (tools/headless.sh) with fake data, then build.py.
#
#   tools/screenshots/capture.sh     (or: make screenshots SESSION=90 WEEKLY=75)
#
# SESSION, WEEKLY, SCOPED: fake usage per window kind (default 90, 75, 45);
# ELAPSED: how much of each window has passed (default 62). Stops a running
# headless shell first. Needs jq, Pillow and Chrome (see build.py).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
H="$ROOT/tools/headless.sh"
SHOTS="$ROOT/tmp/screenshots"
SCHEMA="org.gnome.shell.extensions.ai-usagebar"

"$H" stop >/dev/null
trap '"$H" stop >/dev/null' EXIT
"$H" start --dark --refresh-interval 86400 --fake-trend \
    --fake-pct "${SCOPED:-45}" --fake-pct-session "${SESSION:-90}" \
    --fake-pct-weekly "${WEEKLY:-75}" --fake-pct-scoped "${SCOPED:-45}" \
    --fake-elapsed "${ELAPSED:-62}"
"$H" gsettings set "$SCHEMA" show-pace-marker true
"$H" gsettings set "$SCHEMA" usage-trend true
sleep 1
"$H" eval "$(cat "$ROOT/tools/screenshots/showcase.js")" >/dev/null

# Click the middle of the panel button, then wait for the popup to settle.
read -r bx by bw bh < <("$H" probe | jq -r '.button | map(tostring) | join(" ")')
"$H" click $((bx + bw / 2)) $((by + bh / 2))
sleep 1
"$H" move 1900 1060
sleep 0.5
"$H" shot-popup readme-popup >/dev/null

# The panel as it was in the shot, for the card's redrawn bar.
clock="$("$H" eval 'Main.panel.statusArea.dateMenu._clockDisplay.text.replace(/\s+/g, " ").trim()')"
probe="$("$H" probe)"
pill="$(jq -r '.segments[0].text' <<<"$probe")"
color="$(jq -r '.segments[0].style | capture("(?<c>#[0-9a-fA-F]{6})").c // "#2ec27e"' <<<"$probe")"

"$H" keys Escape
"$H" prefs --page popup >/dev/null
"$H" move 1900 1060
sleep 0.5
"$H" shot-window readme-prefs >/dev/null

python3 "$ROOT/tools/screenshots/build.py" \
    --popup "$SHOTS/readme-popup.png" --prefs "$SHOTS/readme-prefs.png" \
    --clock "$clock" --pill "$pill" --pill-color "$color"
rm -f "$SHOTS/readme-popup.png" "$SHOTS/readme-prefs.png"

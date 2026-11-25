---
type: Playbook
title: Screenshots
description: make screenshots rebuilds the README images (a static card, the same card animated as WebP, the preferences) from the headless shell with fake data.
tags: [testing, gnome-shell]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T15:00:00Z
sources:
  - id: capture
    title: tools/screenshots/capture.sh
    resource: tools/screenshots/capture.sh
  - id: build
    title: tools/screenshots/build.py
    resource: tools/screenshots/build.py
  - id: frame
    title: tools/screenshots/anim-frame.js
    resource: tools/screenshots/anim-frame.js
  - id: showcase
    title: tools/screenshots/showcase.js
    resource: tools/screenshots/showcase.js
  - id: card
    title: tools/screenshots/card.html
    resource: tools/screenshots/card.html
---

# Steps

```bash
make screenshots                                   # session 90, weekly 75, scoped 45, 62% elapsed
make screenshots SESSION=40 WEEKLY=39 ELAPSED=30   # any mix; FRAMES=18 animation frames
```

It overwrites `screenshots/popup.png` (the static card, also uploaded by hand as the repository's Open Graph cover), `screenshots/popup.webp` (the README's top image) and `screenshots/preferences.png`; look at all three before committing. It takes under a minute. Needs `jq`, Pillow and Chrome (`google-chrome`, `chromium`, or `$CHROME`).[^build]

# What it does

1. Restarts the [headless shell](/development/headless.md) dark, with per-kind fake usage, `--fake-elapsed`, `--fake-trend` and a one-day refresh, then turns on the pace marker and the usage trend.[^capture]
2. Trims the fake Anthropic snapshot through `eval`: plan "Max 5x", no Sonnet window, credits or resets, so no "(fake)" label shows.[^showcase]
3. Opens the popup from the button geometry in `probe` and takes `shot-popup`; reads the clock and the panel label and its colour for the card's redrawn bar.
4. Animates: each frame sets the three windows a step further from under a tenth of their targets to the targets and appends that reading to the trend line (`anim-frame.js`), then takes `shot-popup` and the panel label and colour of that frame.[^frame]
5. Opens the preferences on the Popup page and takes `shot-window`.
6. `build.py` renders `card.html` (copy, vendor icons from `icons/`, the blurred `bg.png`, the popup at its own size, shrunk only when too tall for 640 px) in headless Chrome into the 1280x640 card, and gives the window rounded corners and a drop shadow on transparency, reduced to 256 colours. Each frame becomes a card too, joined into an animated WebP at quality 90 (1.2 s on the first frame, 0.22 s per step, 2.5 s on the last, looping): full colour, unlike a GIF, whose 256-colour palette bands the blurred backdrop and drops the few pixels of red text.[^build][^card]

# Gotchas

- The accent colour is the default orange: the headless shell runs no settings portal.
- Social sites neither animate nor always accept WebP, hence the static PNG for the Open Graph cover.
- The card's copy, chips and background are static; edit `card.html` (and the vendor line) when vendors change.
- `bg.png` is a wallpaper scaled to 1280 px wide and blurred: `python3 tools/screenshots/build.py --background WALLPAPER.jpg` replaces it.

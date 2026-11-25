#!/usr/bin/env python3
"""Builds the README images from the headless shots (see capture.sh).

  build.py --popup P.png --prefs W.png --clock "Nov 25 11:07" \
           --pill "90% · 1h 53m" --pill-color "#e01b24" --out screenshots

popup.png is card.html rendered by headless Chrome around the popup shot;
preferences.png is the window shot with rounded corners and a drop shadow on
transparency, reduced to 256 colors. Needs Pillow and google-chrome (or
chromium, or $CHROME).

With --frames DIR (popup shots plus a frames.tsv of name, label and colour
per line) it also renders one card per frame into popup.webp, animated.

  build.py --background WALLPAPER.jpg

replaces bg.png, the card's backdrop, with the wallpaper scaled and blurred.
"""
import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CARD_SIZE = (1280, 640)
# The bar plus the gap above the popup, and the margin kept below it.
POPUP_TOP, POPUP_BOTTOM = 48, 24
WINDOW_RADIUS = 14
SHADOW_PAD, SHADOW_BLUR, SHADOW_ALPHA = 21, 8, 110
BG_WIDTH, BG_BLUR = 1280, 5
# Hold the first frame, step through the rest, rest on the last.
FIRST_MS, STEP_MS, LAST_MS = 1200, 220, 2500
WEBP_QUALITY = 90


def chrome():
    for name in (os.environ.get('CHROME'), 'google-chrome', 'chromium', 'chromium-browser'):
        if name and shutil.which(name):
            return name
    raise SystemExit('build.py: no Chrome found (set CHROME)')


def card(args, out):
    popup = Image.open(args.popup)
    # Never upscaled; shrunk when a tall popup would leave the card.
    scale = min(1.0, (CARD_SIZE[1] - POPUP_TOP - POPUP_BOTTOM) / popup.height)
    date, _, time = args.clock.rpartition(' ')
    html = (HERE / 'card.html').read_text()
    for token, value in {
        'HERE': HERE.as_uri(),
        'ICONS': (ROOT / 'icons').as_uri(),
        'POPUP': Path(args.popup).resolve().as_uri(),
        'POPUP_W': str(popup.width),
        'POPUP_H': str(popup.height),
        'POPUP_SCALE': f'{scale:.4f}',
        'CLOCK_DATE': date.strip() or args.clock,
        'CLOCK_TIME': time if date.strip() else '',
        'PILL_TEXT': args.pill,
        'PILL_COLOR': args.pill_color,
    }.items():
        html = html.replace('{{' + token + '}}', value)
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / 'card.html'
        page.write_text(html)
        subprocess.run([
            chrome(), '--headless=new', '--disable-gpu', '--hide-scrollbars',
            '--force-device-scale-factor=1', f'--window-size={CARD_SIZE[0]},{CARD_SIZE[1]}',
            f'--screenshot={out}', page.as_uri(),
        ], check=True, capture_output=True)
    im = Image.open(out)
    assert im.size == CARD_SIZE, im.size
    im.convert('RGB').save(out, optimize=True)


def window(args, out):
    win = Image.open(args.prefs).convert('RGBA')
    mask = Image.new('L', win.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, win.width - 1, win.height - 1), WINDOW_RADIUS, fill=255)
    win.putalpha(mask)
    size = (win.width + 2 * SHADOW_PAD, win.height + 2 * SHADOW_PAD)
    ox, oy = SHADOW_PAD, SHADOW_PAD - 1
    shadow = Image.new('L', size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        (ox, oy + 2, ox + win.width - 1, oy + win.height + 1), WINDOW_RADIUS, fill=SHADOW_ALPHA)
    im = Image.new('RGBA', size, (0, 0, 0, 0))
    im.putalpha(shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR)))
    im.alpha_composite(win, (ox, oy))
    im.quantize(256, method=Image.Quantize.FASTOCTREE).save(out, optimize=True)


def animation(args, out):
    frames_dir = Path(args.frames)
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for line in (frames_dir / 'frames.tsv').read_text().splitlines():
            name, pill, color = line.split('\t')
            card_png = Path(tmp) / name
            card(argparse.Namespace(popup=str(frames_dir / name), clock=args.clock, pill=pill, pill_color=color), card_png)
            frames.append(Image.open(card_png).convert('RGB'))
    if len(frames) < 2:
        raise SystemExit('build.py: an animation needs two frames or more')
    durations = [FIRST_MS] + [STEP_MS] * (len(frames) - 2) + [LAST_MS]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, quality=WEBP_QUALITY, method=6)


def background(src):
    im = Image.open(src).convert('RGB')
    im = im.resize((BG_WIDTH, round(im.height * BG_WIDTH / im.width)), Image.Resampling.LANCZOS)
    im.filter(ImageFilter.GaussianBlur(BG_BLUR)).save(HERE / 'bg.png', optimize=True)
    print(HERE / 'bg.png', im.size)


def main():
    p = argparse.ArgumentParser(description=__doc__.replace('%', '%%'), formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--background', help='a wallpaper to rebuild bg.png from, then exit')
    p.add_argument('--popup')
    p.add_argument('--prefs')
    p.add_argument('--clock', help='the panel clock, e.g. "Nov 25 11:07"')
    p.add_argument('--pill', help='the panel label, e.g. "90%% · 1h 53m"')
    p.add_argument('--pill-color', default='#2ec27e')
    p.add_argument('--frames', help='a dir of animation frames, for popup.webp')
    p.add_argument('--out', default=str(ROOT / 'screenshots'))
    args = p.parse_args()
    if args.background:
        background(args.background)
        return
    if not (args.popup and args.prefs and args.clock and args.pill):
        p.error('--popup, --prefs, --clock and --pill are required')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    card(args, out / 'popup.png')
    window(args, out / 'preferences.png')
    names = ['popup.png', 'preferences.png']
    if args.frames:
        animation(args, out / 'popup.webp')
        names.append('popup.webp')
    for name in names:
        im = Image.open(out / name)
        print(out / name, im.size, im.mode, getattr(im, "n_frames", 1), "frames", round((out / name).stat().st_size / 1024), "KB")


if __name__ == '__main__':
    main()

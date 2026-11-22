#!/usr/bin/env bash
#
# A throwaway headless GNOME Shell for checking the extension live without a
# screen and without touching the real session: its own HOME, dconf, cache and
# D-Bus session bus, a virtual 1920x1080 monitor, and this checkout linked in
# as the extension. A helper extension turns on unsafe mode so Eval works.
#
#   start [--lang LL] [--fake-pct N] [--fake-error ID[:stale],...] [--fake-delay MS] [--fake-incident SEVERITY]
#                         launch it (rebuilds the state dir; LL e.g. pt_BR)
#   stop                  stop the shell and its prefs process
#   status                running or not, plus the JS error count
#   eval CODE             run JS in the shell; prints the value (JSON unless a string)
#   gsettings ARGS...     gsettings on the isolated dconf, extension schema included
#   probe                 the indicator's state as JSON
#   click X Y | tap X Y | scroll X Y up|down | move X Y
#   keys KEY...           press and release in order, e.g. keys Super_L u
#   prefs                 (re)open the preferences window, fresh translations
#   shot NAME [X Y W H]   screenshot into tmp/screenshots/NAME.png
#   log [PATTERN]         the shell log, or its lines matching PATTERN
#
# The state dir is $AI_USAGEBAR_HEADLESS_DIR (default /tmp/ai-usagebar-headless).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="ai-usagebar@wilfison"
SCHEMA="org.gnome.shell.extensions.ai-usagebar"
STATE="${AI_USAGEBAR_HEADLESS_DIR:-/tmp/ai-usagebar-headless}"
HOME_DIR="$STATE/home"
DISPLAY_NAME="ai-usagebar-headless"
HELPER="ai-usagebar-headless-helper@local"

die() {
    echo "headless: $*" >&2
    exit 1
}

bus() {
    [ -s "$STATE/bus" ] || die "not running (run: $0 start)"
    cat "$STATE/bus"
}

# Pids of this instance's processes, matched by environment so nothing from the
# real session is ever touched.
own_pids() {
    local var="$1" value="$2" pid
    for pid in $(pgrep -u "$(id -u)" -f "$3" || true); do
        if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "${var}=${value}"; then
            echo "$pid"
        fi
    done
}

running() {
    [ -n "$(own_pids HOME "$HOME_DIR" 'gnome-shell --headless')" ]
}

# Run JS in the shell and print the result. Eval is the point of this test
# harness (the helper extension enables it only inside this throwaway session).
# The code travels through a file because gdbus unescapes \n and \" in its
# arguments, and the value comes back through a file because gdbus prints
# GVariant escapes.
js() {
    local in="$STATE/eval.js" out="$STATE/eval.out" reply
    printf '%s' "$1" >"$in"
    rm -f "$out"
    reply="$(DBUS_SESSION_BUS_ADDRESS="$(bus)" gdbus call --session --dest org.gnome.Shell \
        --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
        "(() => { const GLib = imports.gi.GLib; let text;
            try {
                const r = eval(new TextDecoder().decode(GLib.file_get_contents('$in')[1]));
                text = r === undefined ? '' : typeof r === 'string' ? r : JSON.stringify(r);
            } catch (e) {
                text = ['ERROR: ' + e, e.stack ?? ''].join(String.fromCharCode(10));
            }
            GLib.file_set_contents('$out', text);
            return true; })()" 2>&1)" || die "eval failed: $reply"
    [ -f "$out" ] || die "eval refused: $reply (unsafe mode off?)"
    cat "$out"
    echo
    ! grep -q '^ERROR: ' "$out"
}

# Virtual input devices, created once per shell and reused.
INPUT_PRELUDE='const Clutter = imports.gi.Clutter; const GLib = imports.gi.GLib;
globalThis.__aiubInput ??= (() => {
    const seat = Clutter.get_default_backend().get_default_seat();
    const make = type => seat.create_virtual_device(type);
    return {
        pointer: make(Clutter.InputDeviceType.POINTER_DEVICE),
        keyboard: make(Clutter.InputDeviceType.KEYBOARD_DEVICE),
        touch: make(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE),
        now: () => GLib.get_monotonic_time(),
    };
})();
const I = globalThis.__aiubInput;'

PROBE='(() => {
    const i = Main.panel.statusArea["'"$UUID"'"];
    if (!i)
        return {loaded: false};
    const geometry = actor => {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return [x, y, width, height].map(Math.round);
    };
    return {
        loaded: true,
        active: i._activeId,
        poll: i._pollIds,
        menuOpen: i.menu.isOpen,
        expanded: [...i._vendorItems].filter(([, card]) => card.item.menu.isOpen).map(([id]) => id),
        button: geometry(i),
        segments: [...i._segments.entries()].map(([id, {box, label}]) => ({id, text: label.text, style: label.get_style(), geometry: geometry(box)})),
        results: Object.fromEntries(i._poller.entries().map(([id, r]) => [id, r.ok ? (r.stale ? "stale" : "ok") : r.kind])),
    };
})()'

start() {
    local lang="" fake_pct="" fake_error="" fake_delay="" fake_incident=""
    while [ $# -gt 0 ]; do
        case "$1" in
        --lang) lang="$2"; shift 2 ;;
        --fake-pct) fake_pct="$2"; shift 2 ;;
        --fake-error) fake_error="$2"; shift 2 ;;
        --fake-delay) fake_delay="$2"; shift 2 ;;
        --fake-incident) fake_incident="$2"; shift 2 ;;
        *) die "unknown option: $1" ;;
        esac
    done
    running && die "already running (run: $0 stop)"

    rm -rf "$STATE"
    mkdir -p "$HOME_DIR/.local/share/gnome-shell/extensions/$HELPER" "$STATE/run"
    chmod 700 "$STATE/run"
    ln -s "$ROOT" "$HOME_DIR/.local/share/gnome-shell/extensions/$UUID"
    cat >"$HOME_DIR/.local/share/gnome-shell/extensions/$HELPER/metadata.json" <<EOF
{"uuid": "$HELPER", "name": "ai-usagebar headless helper", "description": "Turns on unsafe mode for Eval; test sessions only.", "shell-version": ["47", "48", "49", "50", "51"]}
EOF
    cat >"$HOME_DIR/.local/share/gnome-shell/extensions/$HELPER/extension.js" <<'EOF'
export default class {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {}
}
EOF
    glib-compile-schemas "$ROOT/schemas"

    local locale="en_US.UTF-8"
    if [ -n "$lang" ]; then
        # Not grep -q: an early exit would SIGPIPE locale(1) and fail the pipeline.
        locale -a | grep -ix "${lang}.utf8" >/dev/null || die "locale ${lang}.UTF-8 is not installed (locale -a)"
        (cd "$ROOT" && ./tools/i18n.sh compile-locale >/dev/null)
        locale="${lang}.UTF-8"
    fi

    cat >"$STATE/session.sh" <<EOF
#!/usr/bin/env bash
# Inside dbus-run-session: seed the isolated dconf, then exec the shell.
echo "\$DBUS_SESSION_BUS_ADDRESS" >"$STATE/bus"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$HELPER', '$UUID']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings --schemadir "$ROOT/schemas" set $SCHEMA update-check-enabled false
gsettings --schemadir "$ROOT/schemas" set $SCHEMA notify-enabled false
exec gnome-shell --headless --virtual-monitor 1920x1080 --wayland-display $DISPLAY_NAME --no-x11
EOF
    chmod +x "$STATE/session.sh"

    setsid env -i PATH=/usr/bin:/bin \
        HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" XDG_DATA_HOME="$HOME_DIR/.local/share" \
        XDG_CACHE_HOME="$HOME_DIR/.cache" XDG_RUNTIME_DIR="$STATE/run" \
        LANG="$locale" LANGUAGE="${lang:-en_US}" \
        ${fake_pct:+AI_USAGEBAR_FAKE_PCT="$fake_pct"} \
        ${fake_error:+AI_USAGEBAR_FAKE_ERROR="$fake_error"} \
        ${fake_delay:+AI_USAGEBAR_FAKE_DELAY_MS="$fake_delay"} \
        ${fake_incident:+AI_USAGEBAR_FAKE_INCIDENT="$fake_incident"} \
        dbus-run-session -- "$STATE/session.sh" >"$STATE/shell.log" 2>&1 </dev/null &

    # Probes run in a subshell: js dies while the shell is not on the bus yet,
    # and that must end the probe, not the script.
    local tries=0
    until [ -s "$STATE/bus" ] && (js '1') >/dev/null 2>&1; do
        tries=$((tries + 1))
        [ $tries -le 60 ] || die "the shell did not answer within 60s (see $STATE/shell.log)"
        running || [ $tries -lt 5 ] || die "the shell exited (see $STATE/shell.log)"
        sleep 1
    done
    local tries2=0
    until [ "$( (js "String(Boolean(Main.panel.statusArea['$UUID']))") 2>/dev/null)" = "true" ]; do
        tries2=$((tries2 + 1))
        [ $tries2 -le 20 ] || die "the extension did not load (see: $0 log 'JS ERROR|$UUID')"
        sleep 0.5
    done
    # A fresh virtual device drops its first events, so they are spent here on a
    # harmless move rather than on the caller's first click.
    js "$INPUT_PRELUDE I.pointer.notify_absolute_motion(I.now(), 960, 700);" >/dev/null
    sleep 0.5
    echo "headless: running (locale $locale${fake_pct:+, fake pct $fake_pct}${fake_error:+, fake error $fake_error}${fake_delay:+, fake delay ${fake_delay}ms}${fake_incident:+, fake incident $fake_incident}); state in $STATE"
}

stop() {
    local pids
    pids="$(own_pids WAYLAND_DISPLAY "$DISPLAY_NAME" 'org.gnome.Shell.Extensions') $(own_pids HOME "$HOME_DIR" 'gnome-shell --headless')"
    if [ -z "${pids// /}" ]; then
        echo "headless: not running"
    else
        # shellcheck disable=SC2086  # one pid per word.
        kill $pids 2>/dev/null || true
        for _ in $(seq 20); do
            running || break
            sleep 0.25
        done
        echo "headless: stopped"
    fi
    rm -f "$STATE/bus"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
start) start "$@" ;;
stop) stop ;;
status)
    if running; then
        echo "headless: running; JS errors in log: $(grep -c 'JS ERROR' "$STATE/shell.log" || true)"
    else
        echo "headless: not running"
    fi
    ;;
eval) js "${1:?usage: $0 eval CODE}" ;;
gsettings)
    DBUS_SESSION_BUS_ADDRESS="$(bus)" HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
        gsettings --schemadir "$ROOT/schemas" "$@"
    ;;
probe) js "$PROBE" ;;
move) js "$INPUT_PRELUDE I.pointer.notify_absolute_motion(I.now(), ${1:?x}, ${2:?y});" >/dev/null ;;
click)
    js "$INPUT_PRELUDE I.pointer.notify_absolute_motion(I.now(), ${1:?x}, ${2:?y});
        I.pointer.notify_button(I.now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        I.pointer.notify_button(I.now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);" >/dev/null
    ;;
tap)
    js "$INPUT_PRELUDE I.touch.notify_touch_down(I.now(), 0, ${1:?x}, ${2:?y}); I.touch.notify_touch_up(I.now(), 0);" >/dev/null
    ;;
scroll)
    case "${3:-}" in
    up) dir=UP ;;
    down) dir=DOWN ;;
    *) die "usage: $0 scroll X Y up|down" ;;
    esac
    js "$INPUT_PRELUDE I.pointer.notify_absolute_motion(I.now(), $1, $2);
        I.pointer.notify_discrete_scroll(I.now(), Clutter.ScrollDirection.$dir, Clutter.ScrollSource.WHEEL);" >/dev/null
    ;;
keys)
    [ $# -gt 0 ] || die "usage: $0 keys KEY... (Clutter names without KEY_, e.g. Super_L u)"
    list="$(printf "'%s'," "$@")"
    js "$INPUT_PRELUDE const keys = [${list%,}].map(k => Clutter['KEY_' + k]);
        if (keys.some(k => k === undefined)) throw new Error('unknown key name');
        for (const k of keys) I.keyboard.notify_keyval(I.now(), k, Clutter.KeyState.PRESSED);
        for (const k of [...keys].reverse()) I.keyboard.notify_keyval(I.now(), k, Clutter.KeyState.RELEASED);" >/dev/null
    ;;
prefs)
    # The prefs service outlives its window and keeps the .mo it loaded, so a
    # fresh process is the only way to see new translations.
    for pid in $(own_pids WAYLAND_DISPLAY "$DISPLAY_NAME" 'org.gnome.Shell.Extensions'); do
        kill "$pid" 2>/dev/null || true
    done
    sleep 1
    # Until the service is activated gdbus cannot introspect the signature, so
    # the dict is typed explicitly and the call retried.
    for _ in 1 2 3 4 5; do
        if DBUS_SESSION_BUS_ADDRESS="$(bus)" gdbus call --session --dest org.gnome.Shell.Extensions \
            --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.OpenExtensionPrefs \
            "$UUID" '' '@a{sv} {}' >/dev/null 2>&1; then
            sleep 3
            js 'global.get_window_actors().map(a => { const r = a.meta_window.get_frame_rect(); return {title: a.meta_window.get_title(), geometry: [r.x, r.y, r.width, r.height]}; })'
            exit 0
        fi
        sleep 1
    done
    die "could not open the preferences"
    ;;
shot)
    name="${1:?usage: $0 shot NAME [X Y W H]}"
    mkdir -p "$ROOT/tmp/screenshots"
    file="$ROOT/tmp/screenshots/${name}.png"
    DBUS_SESSION_BUS_ADDRESS="$(bus)" gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.ScreenshotArea \
        "${2:-0}" "${3:-0}" "${4:-1920}" "${5:-1080}" false "$file" >/dev/null
    echo "$file"
    ;;
log)
    if [ -n "${1:-}" ]; then
        grep -E "$1" "$STATE/shell.log" || true
    else
        cat "$STATE/shell.log"
    fi
    ;;
*)
    sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
    [ -z "$cmd" ] || exit 2
    ;;
esac

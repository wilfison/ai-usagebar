#!/usr/bin/env bash
#
# Gettext i18n helpers for ai-usagebar. One subcommand per i18n task so the
# Makefile targets stay thin:
#   pot             extract every marked string into po/<uuid>.pot
#   update-po       msgmerge each po/*.po against the refreshed template
#   compile-locale  msgfmt each po/*.po into locale/<lang>/LC_MESSAGES/*.mo
#   check           fail on a stale .pot (regenerate + diff) or a malformed .po
#   todo            list each catalog's untranslated and fuzzy msgids
#   fill FILE.json  set msgstrs from FILE.json ({msgid: {lang: text}}), clear
#                   their fuzzy flag, and rewrap every catalog with msgcat
#
# String scanning covers the runtime sources only (extension.js, prefs.js,
# ui/, lib/); tests/ and tools/ and node_modules/ are excluded by construction.

set -eu
shopt -s nullglob

UUID="ai-usagebar@wilfison"
POT="po/${UUID}.pot"

# Echo the runtime *.js sources xgettext should scan (one per line, sorted).
sources() {
    find extension.js prefs.js ui lib -name '*.js' | sort
}

# Extract all marked strings into the .pot-format file named by $1.
extract() {
    # shellcheck disable=SC2046  # word-splitting of the file list is intended.
    xgettext \
        --from-code=UTF-8 \
        --language=JavaScript \
        --add-comments=Translators \
        --add-location=file \
        --keyword=_ --keyword=ngettext:1,2 --keyword=pgettext:1c,2 \
        --package-name="${UUID}" \
        --copyright-holder="ai-usagebar contributors" \
        --msgid-bugs-address="https://github.com/wilfison/ai-usagebar/issues" \
        -o "$1" $(sources)
}

cmd="${1:-}"
case "$cmd" in
pot)
    mkdir -p po
    extract "$POT"
    echo "i18n: wrote ${POT}"
    ;;
update-po)
    for po in po/*.po; do
        msgmerge --update --backup=none "$po" "$POT"
    done
    echo "i18n: merged $(ls po/*.po 2>/dev/null | wc -l) catalog(s) against ${POT}"
    ;;
compile-locale)
    for po in po/*.po; do
        lang="$(basename "$po" .po)"
        dest="locale/${lang}/LC_MESSAGES"
        mkdir -p "$dest"
        msgfmt -o "${dest}/${UUID}.mo" "$po"
    done
    echo "i18n: compiled .mo files into locale/"
    ;;
check)
    tmp="$(mktemp)"
    extract "$tmp"
    # The POT-Creation-Date header changes on every run; ignore it when diffing.
    if ! diff -u \
        <(grep -v '^"POT-Creation-Date:' "$POT") \
        <(grep -v '^"POT-Creation-Date:' "$tmp"); then
        echo "i18n-check: ${POT} is stale: run 'make pot' and commit the result"
        rm -f "$tmp"
        exit 1
    fi
    rm -f "$tmp"
    for po in po/*.po; do
        msgfmt --check --check-format -o /dev/null "$po"
    done
    echo "i18n-check: OK"
    ;;
todo)
    # Print one catalog's msgids selected by a msgattrib flag, one per line. A
    # msgid spanning several lines (an embedded \n) is joined, and the header
    # (the empty msgid) is skipped.
    pending() {
        msgattrib "$1" --no-obsolete --no-location "$2" | msgcat --no-wrap - | awk '
            /^msgid "/ { inid = 1; id = substr($0, 8, length($0) - 8); next }
            inid && /^"/ { id = id substr($0, 2, length($0) - 2); next }
            /^msgstr/ { if (inid && id != "") print "  " id; inid = 0 }'
    }
    for po in po/*.po; do
        untranslated="$(pending --untranslated "$po")"
        fuzzy="$(pending --only-fuzzy "$po")"
        echo "== ${po}: $(grep -c . <<<"$untranslated" || true) untranslated, $(grep -c . <<<"$fuzzy" || true) fuzzy"
        if [ -n "$untranslated" ]; then echo "$untranslated"; fi
        if [ -n "$fuzzy" ]; then echo "$fuzzy"; fi
    done
    ;;
fill)
    table="${2:?usage: $0 fill TRANSLATIONS.json}"
    python3 -I "$(dirname "$0")/po-fill.py" "$table" po/*.po
    for po in po/*.po; do
        msgcat "$po" -o "${po}.tmp" && mv "${po}.tmp" "$po"
    done
    ;;
*)
    echo "usage: $0 {pot|update-po|compile-locale|check|todo|fill FILE.json}" >&2
    exit 2
    ;;
esac

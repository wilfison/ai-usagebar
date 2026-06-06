#!/usr/bin/env bash
#
# Gettext i18n helpers for ai-usagebar. One subcommand per i18n task so the
# Makefile targets stay thin:
#   pot             extract every marked string into po/<uuid>.pot
#   update-po       msgmerge each po/*.po against the refreshed template
#   compile-locale  msgfmt each po/*.po into locale/<lang>/LC_MESSAGES/*.mo
#   check           fail on a stale .pot (regenerate + diff) or a malformed .po
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
        echo "i18n-check: ${POT} is stale — run 'make pot' and commit the result"
        rm -f "$tmp"
        exit 1
    fi
    rm -f "$tmp"
    for po in po/*.po; do
        msgfmt --check --check-format -o /dev/null "$po"
    done
    echo "i18n-check: OK"
    ;;
*)
    echo "usage: $0 {pot|update-po|compile-locale|check}" >&2
    exit 2
    ;;
esac

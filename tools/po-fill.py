#!/usr/bin/env python3
"""Fill po/*.po msgstrs from a JSON file and clear their fuzzy flag.

The JSON maps each msgid to its translations by catalog name:
    {"Vendors on the panel": {"pt_BR": "Fornecedores no painel", "de": "..."}}
Only plain (non-plural, no msgctxt) entries are handled. Run `msgcat` on the
result (tools/i18n.sh fill does) so long strings wrap like msgmerge's.
"""
import json
import re
import sys

STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')


def unescape(text):
    return text.encode('utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8')


def escape(text):
    return text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def joined(lines):
    return unescape(''.join(STRING.findall('\n'.join(lines))))


def fill(path, table):
    lang = path.rsplit('/', 1)[-1][:-3]
    blocks = open(path, encoding='utf-8').read().split('\n\n')
    filled = 0
    out = []
    for block in blocks:
        lines = block.split('\n')
        start = next((i for i, l in enumerate(lines) if l.startswith('msgid ')), None)
        end = next((i for i, l in enumerate(lines) if l.startswith('msgstr ')), None)
        if start is not None and end is not None and not any(l.startswith(('msgctxt', 'msgid_plural')) for l in lines):
            msgid = joined(lines[start:end])
            text = table.get(msgid, {}).get(lang)
            if msgid and text:
                header = []
                for line in lines[:start]:
                    if line.startswith('#| '):
                        continue
                    if line.startswith('#,'):
                        flags = [f.strip() for f in line[2:].split(',') if f.strip() != 'fuzzy']
                        if not flags:
                            continue
                        line = '#, ' + ', '.join(flags)
                    header.append(line)
                lines = header + lines[start:end] + [f'msgstr "{escape(text)}"']
                filled += 1
        out.append('\n'.join(lines))
    open(path, 'w', encoding='utf-8').write('\n\n'.join(out))
    print(f'i18n: filled {filled} entr{"y" if filled == 1 else "ies"} in {path}')


def main():
    if len(sys.argv) < 3:
        sys.exit('usage: po-fill.py TRANSLATIONS.json po/<lang>.po...')
    with open(sys.argv[1], encoding='utf-8') as f:
        table = json.load(f)
    for path in sys.argv[2:]:
        fill(path, table)


if __name__ == '__main__':
    main()

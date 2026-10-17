#!/usr/bin/env python3
"""Regenerate resources/symbols.ini from the original FictionBook Editor file.

The upstream FBE/symbols.ini is a Windows INI file in a legacy 8-bit code page
(windows-1251 for the Russian strings). This script detects the encoding
(UTF-8 first, then windows-1251), converts to UTF-8/LF, strips trailing
whitespace, keeps the [symbols] section verbatim otherwise and prepends a
provenance header. Every "symN" value is validated as a decimal code point and
its Unicode name is printed so the English labels can be eyeballed.

Feature 003 (Ukrainian interface): a Ukrainian label `symN_34` (34 = Windows
LANG_UKRAINIAN) is added after every Russian one from the UK_LABELS table
below - the original had no Ukrainian symbol names; these are translated from
the Russian labels with the usual Ukrainian typographic terms. A symbol without
a table entry is reported (the core then falls back to the English label).

Usage: python3 tools/resources-import/import_symbols.py [--ref FBE/symbols.ini] [--out symbols.ini]
"""
import argparse
import re
import sys
import unicodedata
from pathlib import Path

HEADER = """\
; Maxima Fiction Book Editor - "Insert symbol" menu / hotkey table.
;
; Converted to UTF-8 (LF) from symbols.ini of the original FictionBook
; Editor 2.7; source encoding detected as {encoding}. Structure unchanged:
;   symN     = decimal Unicode code point of the N-th symbol (N = 1..99)
;   symN_9   = English label   (9  = Windows LANG_ENGLISH)
;   symN_25  = Russian label   (25 = Windows LANG_RUSSIAN)
;   symN_34  = Ukrainian label (34 = Windows LANG_UKRAINIAN; added by this
;              project, translated from the Russian labels - the original had
;              no Ukrainian symbol names)
; Labels are kept verbatim; known upstream oddities: sym1_9 misspells
; "acute", and sym2 (8226 = U+2022 BULLET) is labelled "Quotation mark"
; (the Ukrainian label names the bullet as what it is).
; Regenerate with: python3 tools/resources-import/import_symbols.py
"""

# Ukrainian labels by symbol number (symN_34), translated from the Russian
# labels of the original (symN_25) with the standard Ukrainian typographic
# terms (тире, лапки, нерозривний пробіл, ...).
UK_LABELS = {
    1: "Комбінований знак наголосу",
    2: "Маркер списку",
    3: "Знак градуса",
    4: "Надрядкова одиниця",
    5: "Надрядкова двійка",
    6: "Надрядкова трійка",
    7: "Знак множення",
    8: "Знак ділення",
    9: "Одинарна ліва лапка",
    10: "Одинарна права лапка",
    11: "Подвійні ліві лапки «ялинкою»",
    12: "Подвійні праві лапки «ялинкою»",
    13: "Три крапки",
    14: "Коротке тире",
    15: "Довге тире",
    16: "Нерозривний пробіл",
    17: "Подвійні лапки верхні ліві",
    18: "Подвійні лапки верхні праві",
    19: "Подвійні лапки нижні початкові",
}

LANG_UKRAINIAN = 34


def detect(data):
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp1251"), "windows-1251"


def main():
    here = Path(__file__).resolve().parents[2] / "resources"  # <repo>/resources
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="/root/maxfbeditor/reference/fictionbookeditor/FBE/symbols.ini")
    ap.add_argument("--out", default=str(here / "symbols.ini"))
    args = ap.parse_args()

    data = Path(args.ref).read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    text, encoding = detect(data)
    print(f"source encoding: {encoding}; CRLF: {b'\\r\\n' in data}")

    lines = [l.rstrip() for l in text.replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()

    values, labels = {}, {}
    for l in lines:
        m = re.fullmatch(r"sym(\d+)\s*=\s*(\d+)", l)
        if m:
            values[int(m.group(1))] = int(m.group(2))
            continue
        m = re.fullmatch(r"sym(\d+)_(\d+)\s*=\s*(.*)", l)
        if m:
            labels[(int(m.group(1)), int(m.group(2)))] = m.group(3)
    for n in sorted(values):
        cp = values[n]
        name = unicodedata.name(chr(cp), "<unnamed>")
        en = labels.get((n, 9), "<no EN label>")
        ru = labels.get((n, 25), "<no RU label>")
        uk = UK_LABELS.get(n, "<no UK label>")
        flag = "" if name.lower().replace("-", " ") == en.lower().replace("-", " ") else "   <-- label differs from Unicode name"
        print(f"sym{n:<3} U+{cp:04X} {name:<40} EN={en!r} RU={ru!r} UK={uk!r}{flag}")
        if not re.search(r"[\u0400-\u04FF]", ru):
            print(f"  WARNING: sym{n}_25 has no Cyrillic letters - encoding problem?")
        if n not in UK_LABELS:
            print(f"  WARNING: sym{n} has no Ukrainian label in UK_LABELS - English label will be used")
    for n in sorted(set(UK_LABELS) - set(values)):
        print(f"WARNING: UK_LABELS has sym{n}, which the upstream file does not define - stale entry")

    # The Ukrainian label follows the Russian one of each symbol.
    out_lines = []
    for l in lines:
        out_lines.append(l)
        m = re.fullmatch(r"sym(\d+)_(\d+)\s*=\s*(.*)", l)
        if m and int(m.group(2)) == 25 and int(m.group(1)) in UK_LABELS:
            n = int(m.group(1))
            out_lines.append(f"sym{n}_{LANG_UKRAINIAN} = {UK_LABELS[n]}")

    out = HEADER.format(encoding=encoding) + "\n".join(out_lines) + "\n"
    Path(args.out).write_text(out, encoding="utf-8", newline="\n")
    print(f"wrote {args.out}: {len(values)} symbols, {len(labels)} upstream labels, "
          f"{len(set(values) & set(UK_LABELS))} Ukrainian labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())

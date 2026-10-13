#!/usr/bin/env python3
"""Regenerate resources/symbols.ini from the original FictionBook Editor file.

The upstream FBE/symbols.ini is a Windows INI file in a legacy 8-bit code page
(windows-1251 for the Russian strings). This script detects the encoding
(UTF-8 first, then windows-1251), converts to UTF-8/LF, strips trailing
whitespace, keeps the [symbols] section verbatim otherwise and prepends a
provenance header. Every "symN" value is validated as a decimal code point and
its Unicode name is printed so the English labels can be eyeballed.

Usage: python3 tools/import_symbols.py [--ref FBE/symbols.ini] [--out symbols.ini]
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
; Labels are kept verbatim; known upstream oddities: sym1_9 misspells
; "acute", and sym2 (8226 = U+2022 BULLET) is labelled "Quotation mark".
; Regenerate with: python3 resources/tools/import_symbols.py
"""


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
        flag = "" if name.lower().replace("-", " ") == en.lower().replace("-", " ") else "   <-- label differs from Unicode name"
        print(f"sym{n:<3} U+{cp:04X} {name:<40} EN={en!r} RU={ru!r}{flag}")
        if not re.search(r"[\u0400-\u04FF]", ru):
            print(f"  WARNING: sym{n}_25 has no Cyrillic letters - encoding problem?")

    out = HEADER.format(encoding=encoding) + "\n".join(lines) + "\n"
    Path(args.out).write_text(out, encoding="utf-8", newline="\n")
    print(f"wrote {args.out}: {len(values)} symbols, {len(labels)} labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())

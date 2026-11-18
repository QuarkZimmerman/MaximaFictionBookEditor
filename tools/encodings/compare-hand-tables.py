#!/usr/bin/env python3
"""Feature 017 (T012, DP-3): compares the seven hand-made tables of core/src/xml/encodings.cpp with
the tables generated from the WHATWG index files (core/src/text/single_byte_tables.inc) and lists
every byte whose character differs. Exit 0 when they are equal, 1 otherwise."""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HAND = REPO / "core" / "src" / "xml" / "encodings.cpp"
GENERATED = REPO / "core" / "src" / "text" / "single_byte_tables.inc"
PAIRS = {"kWindows1251": "windows-1251", "kWindows1252": "windows-1252", "kIso88592": "iso-8859-2",
         "kIso88595": "iso-8859-5", "kIso885915": "iso-8859-15", "kKoi8R": "koi8-r"}


def hand_tables() -> dict[str, list[int]]:
    text = HAND.read_text(encoding="utf-8")
    out = {}
    for var, name in PAIRS.items():
        m = re.search(rf"constexpr Table {var} = \{{(.*?)\}};", text, re.S)
        values = [int(v, 16) for v in re.findall(r"0x[0-9A-Fa-f]+", m.group(1))]
        out[name] = values
    out["iso-8859-1"] = list(range(0x80, 0x100))  # make_latin1()
    return out


def generated_tables() -> dict[str, list[int]]:
    text = GENERATED.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'\{"([a-z0-9-]+)",\s*\{(.*?)\}\}', text, re.S):
        out[m.group(1)] = [int(v, 16) for v in re.findall(r"0x[0-9A-Fa-f]+", m.group(2))]
    return out


def main() -> int:
    hand, gen = hand_tables(), generated_tables()
    differences = 0
    for name, values in hand.items():
        if len(values) != 128:
            print(f"{name}: hand table has {len(values)} entries")
            differences += 1
            continue
        for k in range(128):
            if values[k] != gen[name][k]:
                differences += 1
                print(f"{name} byte 0x{0x80 + k:02X}: hand U+{values[k]:04X}  WHATWG U+{gen[name][k]:04X}")
    print(f"compare-hand-tables: {differences} difference(s)")
    return 0 if differences == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

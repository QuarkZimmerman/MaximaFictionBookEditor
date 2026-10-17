#!/usr/bin/env python3
"""Generate the Hunspell dictionary fixtures of feature 003, User Story 4 (T004).

Writes every `.aff`/`.dic` file of this folder from the tables below, each in the encoding its
`SET` line declares: the Polish pair is written as ISO-8859-2 bytes (one byte per Polish
letter), which an editor set to UTF-8 would silently re-encode - hence this script instead of
hand-edited files. Deterministic output: LF line endings, no BOM, the first line of a `.dic`
is the exact word count. README.md explains what each file is for.

Usage: gen-dictionaries.py [--out DIR]   (default: the folder of this script)
"""

from __future__ import annotations

import argparse
import pathlib
import sys

# tag -> (file encoding, .aff lines, .dic words or None for a deliberately missing partner)
FIXTURES: dict[str, tuple[str, list[str], list[str] | None]] = {
    # Usable German pair: UTF-8, umlauts and sharp s in the words and in TRY, no affix rules.
    "de_DE": (
        "utf-8",
        [
            "SET UTF-8",
            "TRY esianrtolcdugmphbyfvkwzäöüßESIANRTOLCDUGMPHBYFVKWZÄÖÜ",
        ],
        ["Haus", "Straße", "Bücher", "schön", "Mädchen"],
    ),
    # Broken pair: the .aff exists, the .dic partner is missing on purpose.
    "cs_CZ": (
        "utf-8",
        [
            "SET UTF-8",
            "TRY aeoinstlrvkdmpuzjcbhyáíéěšžčřůúýgfňťďóxwqAEOINSTLRVKDMPUZJCBHYÁÍÉĚŠŽČŘŮÚÝ",
        ],
        None,
    ),
    # Usable Polish pair in a legacy 8-bit encoding: both files are ISO-8859-2 bytes.
    "pl_PL": (
        "iso-8859-2",
        [
            "SET ISO8859-2",
            "TRY aioenrzswctkdpmuljłybgęhążśóćńfźvqxAIOENRZSWCTKDPMULJŁYBGĘHĄŻŚÓĆŃFŹ",
        ],
        ["książka", "łódź", "źdźbło", "żółw", "ćma"],
    ),
    # Unsupported encoding: a SET value no converter of the core knows.
    "xx_XX": (
        "ascii",
        [
            "SET X-UNKNOWN",
            "TRY esianrtolcdugmphbyfvkwzxjq",
        ],
        ["lorem", "ipsum"],
    ),
    # Shadowing pair: same tag as the bundled Russian dictionary; one word the bundled one
    # does not know, so a check tells which of the two is in effect.
    "ru_RU": (
        "utf-8",
        [
            "SET UTF-8",
            "TRY иаоентрвсйлпкыьямдушзбгчщюжцхфэъёИАОЕНТРВСЙЛПКЫЬЯМДУШЗБГЧЩЮЖЦХФЭЪЁ",
        ],
        ["фикстура"],
    ),
}


def write_lines(path: pathlib.Path, lines: list[str], encoding: str) -> int:
    data = ("\n".join(lines) + "\n").encode(encoding)  # strict: an unmappable letter fails loudly
    path.write_bytes(data)
    return len(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent,
        help="folder to write the fixtures into (default: the folder of this script)",
    )
    args = parser.parse_args()
    out: pathlib.Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    for tag, (encoding, aff_lines, words) in FIXTURES.items():
        size = write_lines(out / f"{tag}.aff", aff_lines, encoding)
        print(f"{tag}.aff\t{size} bytes\t{encoding}")
        if words is None:
            print(f"{tag}.dic\t(deliberately absent)")
            continue
        size = write_lines(out / f"{tag}.dic", [str(len(words)), *words], encoding)
        print(f"{tag}.dic\t{size} bytes\t{encoding}\t{len(words)} words")
    return 0


if __name__ == "__main__":
    sys.exit(main())

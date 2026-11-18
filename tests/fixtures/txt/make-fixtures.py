#!/usr/bin/env python3
"""Feature 017 (T005): text files for the TXT import's tests.

  make-fixtures.py                      the five foreign layouts of SC-005 from the fixture books into
                                        tests/fixtures/txt/layouts/ (<book>.<layout>.txt + .expected.json)
  make-fixtures.py --sample LIST --out DIR
                                        the same for the books of a corpus list (local corpus gate runs)
  make-fixtures.py --hyphenated         wrapped files breaking words at line ends, with expectations
  make-fixtures.py --hostile DIR        SC-013's hostile set, generated at run time (large files)

Layouts: per-line (CR LF), per-line-blank, per-line-indent, wrapped-blank and wrapped-indent (72
columns, words never broken). The expectation is the list of the book's paragraphs in order.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import textwrap
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BOOKS = REPO / "tests" / "fixtures" / "books"
SOURCES = ["reference-all-elements.fb2", "modern-utf8.fb2", "german-book.fb2", "nested-sections.fb2",
           "many-sections.fb2"]
FB2 = "{http://www.gribuser.ru/xml/fictionbook/2.0}"
BLOCKS = {"p", "v", "subtitle", "text-author"}
LAYOUTS = ["per-line", "per-line-blank", "per-line-indent", "wrapped-blank", "wrapped-indent"]


def paragraphs(path: Path) -> list[str]:
    """The text blocks of the book's main body in order, spaces collapsed, empty ones left out."""
    root = ET.parse(path).getroot()
    body = root.find(f"{FB2}body")
    if body is None:
        return []
    out = []
    for element in body.iter():
        if element.tag.replace(FB2, "") in BLOCKS:
            text = re.sub(r"\s+", " ", "".join(element.itertext())).strip()
            if text:
                out.append(text)
    return out


def wrap(paragraph: str, indent: str = "") -> list[str]:
    return textwrap.wrap(paragraph, width=72, initial_indent=indent, subsequent_indent="",
                         break_long_words=False, break_on_hyphens=False) or [indent]


def layout(paras: list[str], kind: str) -> str:
    if kind == "per-line":
        return "\r\n".join(paras) + "\r\n"
    if kind == "per-line-blank":
        return "\n\n".join(paras) + "\n"
    if kind == "per-line-indent":
        return "\n".join("    " + p for p in paras) + "\n"
    if kind == "wrapped-blank":
        return "\n\n".join("\n".join(wrap(p)) for p in paras) + "\n"
    if kind == "wrapped-indent":
        return "\n".join("\n".join(wrap(p, "    ")) for p in paras) + "\n"
    raise ValueError(kind)


def write_layouts(books: list[Path], out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for book in books:
        paras = paragraphs(book)
        if not paras:
            continue
        stem = book.stem
        for kind in LAYOUTS:
            (out / f"{stem}.{kind}.txt").write_bytes(layout(paras, kind).encode("utf-8"))
            count += 1
        (out / f"{stem}.expected.json").write_text(
            json.dumps({"book": book.name, "paragraphs": paras}, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
    return count


# Words the shipped dictionaries know, broken at a line's end; and compounds whose hyphen stays.
KNOWN = ["information", "government", "государство", "литература", "університет"]
COMPOUNDS = ["north-east", "кто-нибудь", "сорок-п'ятий"]


def write_hyphenated(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    lines, expected = [], []
    for word in KNOWN:
        cut = len(word) // 2
        lines += [f"The word {word[:cut]}-", f"{word[cut:]} is joined.", ""]
        expected.append(f"The word {word} is joined.")
    for word in COMPOUNDS:
        head, tail = word.split("-", 1)
        lines += [f"The compound {head}-", f"{tail} keeps its hyphen.", ""]
        expected.append(f"The compound {word} keeps its hyphen.")
    (out / "hyphenated.wrapped-blank.txt").write_text("\n".join(lines), encoding="utf-8")
    (out / "hyphenated.expected.json").write_text(
        json.dumps({"paragraphs": expected}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def write_hostile(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "nul-bytes.txt").write_bytes(b"Text\x00with\x00NUL\x00bytes\n" * 100)
    (out / "mixed-invalid-utf8.txt").write_bytes("Начало текста\n".encode() + b"\xff\xfe\xc3\x28 broken\n"
                                                 + "конец\n".encode())
    (out / "controls.txt").write_bytes(b"Line one\x01\x02\x07 with controls\n\x0bLine two\x1b\n")
    with open(out / "long-line.txt", "wb") as f:
        f.write(b"word " * (20 * 1024 * 1024 // 5))
    (out / "blank-lines.txt").write_text("First\n" + "\n" * 10000 + "Last\n", encoding="utf-8")
    (out / "empty.txt").write_bytes(b"")
    (out / "whitespace-only.txt").write_bytes(b" \n\t\n \n")
    with open(out / "too-large.txt", "wb") as f:
        f.truncate(128 * 1024 * 1024 + 1)
    shutil.copyfile(BOOKS / "modern-utf8.fb2", out / "fb2-renamed.txt")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sample", help="a corpus list (one FB2 path or id per line)")
    parser.add_argument("--out", help="output folder (default tests/fixtures/txt/layouts)")
    parser.add_argument("--hyphenated", action="store_true")
    parser.add_argument("--hostile", metavar="DIR")
    args = parser.parse_args()
    if args.hostile:
        write_hostile(Path(args.hostile))
        print(f"make-fixtures: hostile set in {args.hostile}")
        return 0
    if args.hyphenated:
        write_hyphenated(HERE / "hyphenated")
        print("make-fixtures: hyphenated files written")
        return 0
    if args.sample:
        books = [Path(line.strip()) for line in Path(args.sample).read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.startswith("#")]
        books = [b for b in books if b.suffix == ".fb2" and b.is_file()]
    else:
        books = [BOOKS / name for name in SOURCES]
    count = write_layouts(books, Path(args.out) if args.out else HERE / "layouts")
    print(f"make-fixtures: {count} layout files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

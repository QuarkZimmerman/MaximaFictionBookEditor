#!/usr/bin/env python3
"""Generate the books of the script benchmark (feature 002, User Story 7, SC-008).

Deterministic (seeded) Russian prose whose paragraphs carry what the bundled clean-up scripts
change: double spaces, straight quotes, hyphens between spaces, spaces before punctuation and
non-breaking spaces. Writes `clean-1mb.fb2` (about 1 MB, 5,000 paragraphs) and
`clean-10mb.fb2` (about 10 MB, 50,000 paragraphs) into tests/bench/books/ (git-ignored).
Existing files are kept unless --force is given.

Usage: gen-text-book.py [--out-dir DIR] [--seed 1] [--only 1mb|10mb] [--force]
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

# name -> (paragraphs, paragraphs per section)
BOOKS = {
    "1mb": (5_000, 50),
    "10mb": (50_000, 50),
}

WORDS = (
    "книга глава страница слово текст история день ночь город дорога человек время рука окно"
    " дверь свет тень голос письмо море небо земля сердце мысль утро вечер поле лес река дом"
    " улица площадь мост берег ветер дождь снег солнце луна звезда сад двор школа работа друг"
    " брат сестра отец мать сын дочь старик девушка путь письмо разговор тишина память надежда"
).split()
VERBS = (
    "шёл смотрел говорил думал ждал искал видел слушал писал читал помнил знал молчал стоял"
).split()

NBSP = " "


def sentence(rng: random.Random) -> str:
    words = [rng.choice(WORDS) for _ in range(rng.randint(7, 14))]
    words.insert(rng.randint(1, len(words) - 1), rng.choice(VERBS))
    text = " ".join(words)
    return text[0].upper() + text[1:]


def paragraph(rng: random.Random) -> str:
    parts = []
    for _ in range(rng.randint(1, 2)):
        s = sentence(rng)
        roll = rng.random()
        if roll < 0.25:
            s = s.replace(" ", "  ", 1)  # double space
        elif roll < 0.45:
            words = s.split(" ")
            i = rng.randint(1, len(words) - 2)
            words[i] = f'"{words[i]}'
            words[i + 1] = f'{words[i + 1]}"'
            s = " ".join(words)  # straight quotes
        elif roll < 0.60:
            words = s.split(" ")
            words.insert(rng.randint(1, len(words) - 1), "-")
            s = " ".join(words)  # hyphen between spaces
        elif roll < 0.75:
            words = s.split(" ")
            i = rng.randint(1, len(words) - 2)
            words[i] = words[i] + " ,"
            s = " ".join(words)  # space before a comma
        elif roll < 0.90:
            s = s + f" {rng.randint(2, 99)}{NBSP}км"  # non-breaking space
        parts.append(s + (" ." if rng.random() < 0.1 else "."))
    return " ".join(parts)


def book(paragraphs: int, per_section: int, rng: random.Random, name: str) -> str:
    out = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"'
        ' xmlns:l="http://www.w3.org/1999/xlink">',
        "\t<description>",
        "\t\t<title-info>",
        "\t\t\t<genre>prose_classic</genre>",
        "\t\t\t<author><first-name>Bench</first-name><last-name>Fixture</last-name></author>",
        f"\t\t\t<book-title>Script benchmark {name}</book-title>",
        "\t\t\t<lang>ru</lang>",
        "\t\t</title-info>",
        "\t\t<document-info>",
        "\t\t\t<author><nickname>gen-text-book</nickname></author>",
        "\t\t\t<program-used>gen-text-book.py</program-used>",
        '\t\t\t<date value="2026-01-01">2026</date>',
        f"\t\t\t<id>bench-clean-{name}</id>",
        "\t\t\t<version>1.0</version>",
        "\t\t</document-info>",
        "\t</description>",
        "\t<body>",
    ]
    for start in range(0, paragraphs, per_section):
        out.append("\t\t<section>")
        out.append(f"\t\t\t<title><p>Глава {start // per_section + 1}</p></title>")
        for _ in range(min(per_section, paragraphs - start)):
            out.append(f"\t\t\t<p>{paragraph(rng)}</p>")
        out.append("\t\t</section>")
    out += ["\t</body>", "</FictionBook>", ""]
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out-dir", type=Path, default=HERE / "books")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", choices=sorted(BOOKS))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, (paragraphs, per_section) in BOOKS.items():
        if args.only and name != args.only:
            continue
        path = args.out_dir / f"clean-{name}.fb2"
        if path.exists() and not args.force:
            print(json.dumps({"path": str(path), "kept": True}))
            continue
        data = book(paragraphs, per_section, random.Random(f"{args.seed}-{name}"), name)
        path.write_bytes(data.encode("utf-8"))
        print(json.dumps({"path": str(path), "bytes": path.stat().st_size,
                          "paragraphs": paragraphs}))


if __name__ == "__main__":
    main()

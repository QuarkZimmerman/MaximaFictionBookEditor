#!/usr/bin/env python3
"""Generate a valid FB2 book with many nested sections for the Document Tree journey (T082).

Deterministic (seeded) structure: `--sections` sections in total (default 300, counting every
nesting level), spread over top-level "parts" whose chapters may hold nested sub-sections
(up to depth 4). Every section has a title; some carry an epigraph, an annotation, a poem, a
cite or a table so the tree shows every leaf kind. Titles embed the section number
(`Part 3`, `Chapter 3.2`, `Scene 3.2.1`) and each section carries `id="s<N>"` so tests can
address sections by number. Text is Russian/English pseudo-prose. Prints a JSON line with the
path and the counts.

Usage: gen-sections.py --out /tmp/sections.fb2 [--sections 300] [--seed 1] [--lang ru]
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

WORDS_RU = (
    "книга глава страница слово текст редактор история день ночь город дорога человек"
    " время рука окно дверь свет тень голос письмо море небо земля сердце мысль"
).split()
WORDS_EN = (
    "book chapter page word text editor story day night city road person time hand"
    " window door light shadow voice letter sea sky earth heart thought quiet long"
).split()

HEADER = """<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
\t<description>
\t\t<title-info>
\t\t\t<genre>prose_contemporary</genre>
\t\t\t<author><first-name>Tree</first-name><last-name>Fixture</last-name></author>
\t\t\t<book-title>Many sections</book-title>
\t\t\t<annotation><p>A generated book with {total} sections for the Document Tree tests.</p></annotation>
\t\t\t<lang>{lang}</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>gen-sections</nickname></author>
\t\t\t<program-used>gen-sections.py</program-used>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>gen-sections-{total}</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<title><p>Many sections</p></title>
"""

FOOTER = "\t</body>\n\t<body name=\"notes\">\n\t\t<section id=\"n_1\"><title><p>1</p></title><p>A note.</p></section>\n\t</body>\n</FictionBook>\n"


def sentence(rng: random.Random, words: list[str]) -> str:
    count = rng.randint(5, 12)
    text = " ".join(rng.choice(words) for _ in range(count))
    return text[0].upper() + text[1:] + rng.choice([".", ".", "!", "?"])


def paragraph(rng: random.Random, indent: str) -> str:
    words = WORDS_RU if rng.random() < 0.7 else WORDS_EN
    return f"{indent}<p>{' '.join(sentence(rng, words) for _ in range(rng.randint(1, 3)))}</p>\n"


class Generator:
    def __init__(self, total: int, seed: int) -> None:
        self.total = total
        self.rng = random.Random(seed)
        self.count = 0
        self.max_depth = 0
        self.leaf_kinds = {"epigraph": 0, "annotation": 0, "poem": 0, "cite": 0, "table": 0}

    def remaining(self) -> int:
        return self.total - self.count

    def section(self, number: str, depth: int, out: list[str]) -> None:
        self.count += 1
        self.max_depth = max(self.max_depth, depth)
        indent = "\t" * (depth + 1)
        inner = indent + "\t"
        kind = ("Part", "Chapter", "Scene", "Fragment")[min(depth - 1, 3)]
        out.append(f'{indent}<section id="s{self.count}">\n')
        out.append(f"{inner}<title><p>{kind} {number}</p></title>\n")
        rng = self.rng
        if rng.random() < 0.15:
            self.leaf_kinds["epigraph"] += 1
            out.append(f"{inner}<epigraph><p>{sentence(rng, WORDS_RU)}</p><text-author>Author</text-author></epigraph>\n")
        if rng.random() < 0.1:
            self.leaf_kinds["annotation"] += 1
            out.append(f"{inner}<annotation><p>{sentence(rng, WORDS_EN)}</p></annotation>\n")

        # Decide the children: nested sections (while the budget allows) or text blocks.
        want_children = depth < 4 and self.remaining() > 1 and rng.random() < (0.9 if depth == 1 else 0.35)
        if want_children:
            children = min(self.remaining(), rng.randint(2, 3))
            for i in range(1, children + 1):
                if self.remaining() <= 0:
                    break
                self.section(f"{number}.{i}", depth + 1, out)
        else:
            for _ in range(rng.randint(1, 3)):
                out.append(paragraph(rng, inner))
            extra = rng.random()
            if extra < 0.12:
                self.leaf_kinds["poem"] += 1
                out.append(
                    f"{inner}<poem><title><p>Poem {number}</p></title><stanza><v>{sentence(rng, WORDS_RU)}</v>"
                    f"<v>{sentence(rng, WORDS_RU)}</v></stanza></poem>\n"
                )
            elif extra < 0.2:
                self.leaf_kinds["cite"] += 1
                out.append(f"{inner}<cite><p>{sentence(rng, WORDS_EN)}</p><text-author>Someone</text-author></cite>\n")
            elif extra < 0.26:
                self.leaf_kinds["table"] += 1
                out.append(f"{inner}<table><tr><th>Key</th><th>Value</th></tr><tr><td>{number}</td><td>{self.count}</td></tr></table>\n")
            out.append(paragraph(rng, inner))
        out.append(f"{indent}</section>\n")

    def book(self, lang: str) -> str:
        out: list[str] = []
        part = 0
        while self.remaining() > 0:
            part += 1
            self.section(str(part), 1, out)
        return HEADER.format(total=self.total, lang=lang) + "".join(out) + FOOTER


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="output .fb2 path")
    parser.add_argument("--sections", type=int, default=300, help="total number of sections (all levels)")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--lang", default="ru")
    args = parser.parse_args()

    generator = Generator(args.sections, args.seed)
    text = generator.book(args.lang)
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "path": str(path),
                "sections": generator.count,
                "maxDepth": generator.max_depth,
                "leaves": generator.leaf_kinds,
                "bytes": len(text.encode("utf-8")),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

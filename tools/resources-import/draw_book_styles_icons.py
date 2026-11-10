#!/usr/bin/env python3
"""Draws the toolbar icons of View -> Show Book Styles (feature 012, US4, D35): a page with a folded
corner whose lines are styled - a dark heading, an orange line, grey text - in the style of the
neighbouring FBE icons (8-bit RGBA, dark grey outline, white page), at 24 and 16 pixels. Standard
library only and deterministic; the PNG writer and the shapes' distance functions are
draw_ai_icons.py's.

    python3 tools/resources-import/draw_book_styles_icons.py            # writes the two files
    python3 tools/resources-import/draw_book_styles_icons.py --check    # compares with the committed ones
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from draw_ai_icons import (  # noqa: E402  (the sibling script is the one PNG writer)
    FILL,
    ICONS,
    OUTLINE,
    REPO,
    SPARK,
    SUPERSAMPLE,
    png_bytes,
    preview,
    sd_polygon,
)

Point = tuple[float, float]
Colour = tuple[int, int, int]
LINE = (150, 150, 150)


class Page:
    """A page with a folded top-right corner and coloured text lines."""

    def __init__(self, size: int, page: list[Point], fold: list[Point],
                 lines: list[tuple[list[Point], Colour]], stroke: float):
        self.size = size
        self.page = page
        self.fold = fold
        self.lines = lines
        self.stroke = stroke

    def sample(self, x: float, y: float) -> tuple[int, int, int, int] | None:
        d = sd_polygon(x, y, self.fold)
        if d <= 0.0:
            return (*OUTLINE, 255) if d > -self.stroke else (*FILL, 255)
        d = sd_polygon(x, y, self.page)
        if d > 0.0:
            return None
        if d > -self.stroke:
            return (*OUTLINE, 255)
        for line, colour in self.lines:
            if sd_polygon(x, y, line) <= 0.0:
                return (*colour, 255)
        return (*FILL, 255)

    def render(self) -> list[list[tuple[int, int, int, int]]]:
        n = SUPERSAMPLE
        step = 1.0 / n
        rows = []
        for py in range(self.size):
            row = []
            for px in range(self.size):
                r = g = b = a = 0
                for sy in range(n):
                    y = py + (sy + 0.5) * step
                    for sx in range(n):
                        colour = self.sample(px + (sx + 0.5) * step, y)
                        if colour is None:
                            continue
                        r += colour[0]
                        g += colour[1]
                        b += colour[2]
                        a += 1
                if a == 0:
                    row.append((0, 0, 0, 0))
                else:
                    row.append((round(r / a), round(g / a), round(b / a), round(255 * a / (n * n))))
            rows.append(row)
        return rows


def bar(x0: float, x1: float, y: float, height: float) -> list[Point]:
    """A text line from x0 to x1 at y."""
    return [(x0, y), (x1, y), (x1, y + height), (x0, y + height)]


PAGE24 = Page(
    24,
    page=[(4.0, 1.5), (15.0, 1.5), (20.0, 6.5), (20.0, 22.5), (4.0, 22.5)],
    fold=[(15.0, 1.5), (15.0, 6.5), (20.0, 6.5)],
    lines=[(bar(6.5, 13.5, 8.5, 2.0), OUTLINE), (bar(6.5, 17.5, 12.5, 2.0), SPARK),
           (bar(6.5, 17.5, 16.0, 1.0), LINE), (bar(6.5, 14.5, 19.0, 1.0), LINE)],
    stroke=1.0,
)
PAGE16 = Page(
    16,
    page=[(2.5, 0.5), (10.0, 0.5), (13.5, 4.0), (13.5, 15.5), (2.5, 15.5)],
    fold=[(10.0, 0.5), (10.0, 4.0), (13.5, 4.0)],
    lines=[(bar(4.5, 9.0, 5.5, 1.5), OUTLINE), (bar(4.5, 11.5, 8.5, 1.5), SPARK),
           (bar(4.5, 10.0, 11.5, 1.0), LINE)],
    stroke=1.0,
)
OUTPUTS = {
    ICONS / "toolbar24" / "book-styles.png": PAGE24,
    ICONS / "toolbar16" / "book-styles.png": PAGE16,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="compare with the committed files instead of writing")
    parser.add_argument("--preview", action="store_true", help="print an ASCII preview of each icon")
    args = parser.parse_args()
    differences = 0
    for path, icon in OUTPUTS.items():
        rows = icon.render()
        data = png_bytes(rows)
        if args.preview:
            print(path.relative_to(REPO))
            print(preview(rows))
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                print(f"{path.relative_to(REPO)}: differs from the generated image", file=sys.stderr)
                differences += 1
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"{path.relative_to(REPO)}: {icon.size}x{icon.size} RGBA, {len(data)} bytes")
    return 1 if differences else 0


if __name__ == "__main__":
    sys.exit(main())

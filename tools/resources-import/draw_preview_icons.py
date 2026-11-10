#!/usr/bin/env python3
"""Draws the toolbar icons of View -> Preview (feature 011, US10): an open book with an orange
bookmark, in the style of the neighbouring FBE icons (8-bit RGBA, dark grey outline, white pages),
at 24 and 16 pixels. Standard library only and deterministic; the PNG writer and the shapes'
distance functions are draw_ai_icons.py's.

    python3 tools/resources-import/draw_preview_icons.py            # writes the two files
    python3 tools/resources-import/draw_preview_icons.py --check    # compares with the committed ones
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
LINE = (150, 150, 150)


class Book:
    """An open book: two pages meeting at the spine, text lines, a bookmark."""

    def __init__(self, size: int, pages: list[list[Point]], lines: list[list[Point]],
                 mark: list[Point], stroke: float):
        self.size = size
        self.pages = pages
        self.lines = lines
        self.mark = mark
        self.stroke = stroke

    def sample(self, x: float, y: float) -> tuple[int, int, int, int] | None:
        if sd_polygon(x, y, self.mark) <= 0.0:
            return (*SPARK, 255)
        for page in self.pages:
            d = sd_polygon(x, y, page)
            if d <= 0.0:
                if d > -self.stroke:
                    return (*OUTLINE, 255)
                for line in self.lines:
                    if sd_polygon(x, y, line) <= 0.0:
                        return (*LINE, 255)
                return (*FILL, 255)
        return None

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


def bar(x0: float, x1: float, y: float, height: float, slope: float) -> list[Point]:
    """A text line from x0 to x1 at y, following the page's slope."""
    return [(x0, y + slope * (x0 - x0)), (x1, y + slope * (x1 - x0)),
            (x1, y + slope * (x1 - x0) + height), (x0, y + height)]


BOOK24 = Book(
    24,
    pages=[[(1.0, 5.0), (12.0, 7.0), (12.0, 21.0), (1.0, 19.0)],
           [(12.0, 7.0), (23.0, 5.0), (23.0, 19.0), (12.0, 21.0)]],
    lines=[bar(3.5, 9.5, 10.0, 1.0, 0.18), bar(3.5, 9.5, 13.0, 1.0, 0.18),
           bar(3.5, 8.0, 16.0, 1.0, 0.18), bar(14.5, 20.5, 13.0, 1.0, -0.18),
           bar(14.5, 20.5, 16.0, 1.0, -0.18)],
    mark=[(16.0, 5.0), (19.0, 4.5), (19.0, 11.5), (17.5, 10.0), (16.0, 11.5)],
    stroke=1.0,
)
BOOK16 = Book(
    16,
    pages=[[(0.5, 3.5), (8.0, 5.0), (8.0, 14.5), (0.5, 13.0)],
           [(8.0, 5.0), (15.5, 3.5), (15.5, 13.0), (8.0, 14.5)]],
    lines=[bar(2.5, 6.0, 7.5, 1.0, 0.2), bar(2.5, 6.0, 10.0, 1.0, 0.2)],
    mark=[(10.5, 3.5), (13.0, 3.0), (13.0, 8.0), (11.75, 7.0), (10.5, 8.0)],
    stroke=1.0,
)
OUTPUTS = {
    ICONS / "toolbar24" / "preview.png": BOOK24,
    ICONS / "toolbar16" / "preview.png": BOOK16,
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

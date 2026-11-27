#!/usr/bin/env python3
"""Draws the toolbar icons of File -> New Package (feature 022, FR-002): a blank page with a folded
corner matching id_file_new plus a warm archive-box badge with zipper teeth in the lower-right, at
24 and 16 pixels. Standard library only and deterministic, reusing the PNG writer and SDF helpers
of draw_ai_icons.py.

    python3 tools/resources-import/draw_package_icon.py            # writes the two files
    python3 tools/resources-import/draw_package_icon.py --check    # compares with the committed ones
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from draw_ai_icons import (  # noqa: E402
    FILL,
    ICONS,
    OUTLINE,
    REPO,
    SUPERSAMPLE,
    png_bytes,
    sd_polygon,
)

Point = tuple[float, float]
Colour = tuple[int, int, int]

BOX_FILL: Colour = (232, 188, 96)
BOX_LID: Colour = (244, 212, 134)
BOX_OUTLINE: Colour = (128, 86, 28)
ZIP_TOOTH: Colour = (96, 64, 20)


class PackagePageIcon:
    """A blank document page overlaid with a small archive box badge."""

    def __init__(
        self,
        size: int,
        page: list[Point],
        fold: list[Point],
        box: list[Point],
        lid: list[Point],
        teeth: list[list[Point]],
        stroke: float,
    ):
        self.size = size
        self.page = page
        self.fold = fold
        self.box = box
        self.lid = lid
        self.teeth = teeth
        self.stroke = stroke

    def sample(self, x: float, y: float) -> tuple[int, int, int, int] | None:
        # Archive badge sits in front of the page in the lower-right corner.
        d_box = sd_polygon(x, y, self.box)
        if d_box <= 0.0:
            if d_box > -self.stroke:
                return (*BOX_OUTLINE, 255)
            for tooth in self.teeth:
                if sd_polygon(x, y, tooth) <= 0.0:
                    return (*ZIP_TOOTH, 255)
            if sd_polygon(x, y, self.lid) <= 0.0:
                return (*BOX_LID, 255)
            return (*BOX_FILL, 255)

        d_fold = sd_polygon(x, y, self.fold)
        if d_fold <= 0.0:
            return (*OUTLINE, 255) if d_fold > -self.stroke else (*FILL, 255)

        d_page = sd_polygon(x, y, self.page)
        if d_page <= 0.0:
            return (*OUTLINE, 255) if d_page > -self.stroke else (*FILL, 255)

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
                    row.append(
                        (
                            round(r / a),
                            round(g / a),
                            round(b / a),
                            round(255 * a / (n * n)),
                        )
                    )
            rows.append(row)
        return rows


def rect(x0: float, y0: float, x1: float, y1: float) -> list[Point]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


ICON24 = PackagePageIcon(
    24,
    page=[(3.0, 1.5), (13.5, 1.5), (18.5, 6.5), (18.5, 20.5), (3.0, 20.5)],
    fold=[(13.5, 1.5), (13.5, 6.5), (18.5, 6.5)],
    box=rect(10.0, 11.5, 22.5, 22.5),
    lid=rect(11.0, 12.5, 21.5, 15.0),
    teeth=[
        rect(15.2, 12.5, 16.4, 14.0),
        rect(16.4, 14.2, 17.6, 15.7),
        rect(15.2, 15.9, 16.4, 17.4),
        rect(16.4, 17.6, 17.6, 19.1),
        rect(15.2, 19.3, 17.6, 21.2),
    ],
    stroke=1.0,
)

ICON16 = PackagePageIcon(
    16,
    page=[(1.5, 1.0), (8.5, 1.0), (12.0, 4.5), (12.0, 13.5), (1.5, 13.5)],
    fold=[(8.5, 1.0), (8.5, 4.5), (12.0, 4.5)],
    box=rect(6.5, 7.5, 15.0, 15.0),
    lid=rect(7.3, 8.3, 14.2, 10.0),
    teeth=[
        rect(10.0, 8.4, 11.0, 9.6),
        rect(11.0, 9.8, 12.0, 11.0),
        rect(10.0, 11.2, 11.0, 12.4),
        rect(10.2, 12.6, 11.8, 14.0),
    ],
    stroke=0.85,
)

TARGETS = [
    (ICONS / "toolbar24" / "id_file_new_package.png", ICON24),
    (ICONS / "toolbar16" / "id_file_new_package.png", ICON16),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed PNGs match the deterministic generator output.",
    )
    args = parser.parse_args()

    drift = False
    for path, spec in TARGETS:
        data = png_bytes(spec.render())
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                print(f"mismatch: {path.relative_to(REPO)}", file=sys.stderr)
                drift = True
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            print(f"wrote {path.relative_to(REPO)} ({len(data)} bytes)")
    return 1 if drift else 0


if __name__ == "__main__":
    raise SystemExit(main())

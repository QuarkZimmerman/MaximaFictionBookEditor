#!/usr/bin/env python3
"""Draws the AI assistant toolbar icon pair (feature 005, T007): a speech bubble with a spark.

The icons are the project's own artwork (project licence) - the original FictionBook Editor had
no such button - drawn in the style of the converted FBE toolbar bitmaps next to them: 8-bit RGBA
PNG, dark grey outlines, white fill, one orange accent, anti-aliased edges. Developer tooling,
never shipped; Python 3 standard library only, deterministic output.

    python3 tools/resources-import/draw_ai_icons.py            # writes both files
    python3 tools/resources-import/draw_ai_icons.py --check    # exits 1 when a file differs

Output: ui/public/icons/toolbar24/ai-assistant.png (24x24) and
ui/public/icons/toolbar16/ai-assistant.png (16x16).
"""
from __future__ import annotations

import argparse
import math
import pathlib
import struct
import sys
import zlib

REPO = pathlib.Path(__file__).resolve().parents[2]
ICONS = REPO / "ui" / "public" / "icons"
SUPERSAMPLE = 16  # samples per pixel edge

OUTLINE = (64, 64, 64)  # the dark grey of the FBE glyph outlines
FILL = (255, 255, 255)
SPARK = (252, 137, 10)  # the orange of id_view_body.png
SPARK_EDGE = (176, 84, 0)

Point = tuple[float, float]


# ---------------------------------------------------------------- signed distance functions --
def sd_rounded_rect(
    px: float, py: float, cx: float, cy: float, hw: float, hh: float, r: float
) -> float:
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return outside + min(max(qx, qy), 0.0) - r


def sd_polygon(px: float, py: float, vertices: list[Point]) -> float:
    """Exact signed distance to a simple polygon (negative inside)."""
    n = len(vertices)
    d = (px - vertices[0][0]) ** 2 + (py - vertices[0][1]) ** 2
    s = 1.0
    j = n - 1
    for i in range(n):
        vix, viy = vertices[i]
        vjx, vjy = vertices[j]
        ex, ey = vjx - vix, vjy - viy
        wx, wy = px - vix, py - viy
        t = max(0.0, min(1.0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
        bx, by = wx - ex * t, wy - ey * t
        d = min(d, bx * bx + by * by)
        c1 = py >= viy
        c2 = py < vjy
        c3 = ex * wy > ey * wx
        if (c1 and c2 and c3) or (not c1 and not c2 and not c3):
            s = -s
        j = i
    return s * math.sqrt(d)


def star(cx: float, cy: float, outer: float, inner: float, points: int = 4) -> list[Point]:
    vertices: list[Point] = []
    for k in range(points * 2):
        angle = -math.pi / 2 + k * math.pi / points
        radius = outer if k % 2 == 0 else inner
        vertices.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return vertices


# ------------------------------------------------------------------------------- the artwork --
class Icon:
    """Geometry of one icon size in pixel coordinates (origin top-left, y down)."""

    def __init__(
        self,
        size: int,
        bubble: tuple[float, float, float, float, float],
        tail: list[Point],
        stroke: float,
        sparks: list[tuple[float, float, float, float]],
        spark_stroke: float,
    ):
        self.size = size
        self.bubble = bubble  # cx, cy, half width, half height, corner radius
        self.tail = tail  # triangle, clockwise or counter-clockwise
        self.stroke = stroke
        self.sparks = [star(cx, cy, outer, inner) for cx, cy, outer, inner in sparks]
        self.spark_stroke = spark_stroke

    def sample(self, x: float, y: float) -> tuple[int, int, int, int] | None:
        for polygon in self.sparks:
            d = sd_polygon(x, y, polygon)
            if d <= 0.0:
                edge = self.spark_stroke > 0.0 and d > -self.spark_stroke
                return (*SPARK_EDGE, 255) if edge else (*SPARK, 255)
        cx, cy, hw, hh, r = self.bubble
        d_rect = sd_rounded_rect(x, y, cx, cy, hw, hh, r)
        d_tail = sd_polygon(x, y, self.tail)
        if d_rect <= 0.0 or d_tail <= 0.0:
            interior = d_rect < -self.stroke or d_tail < -self.stroke
            return (*FILL, 255) if interior else (*OUTLINE, 255)
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


ICON24 = Icon(
    24,
    bubble=(9.5, 10.5, 8.5, 6.5, 3.5),  # edges on x = 1 / 18, y = 4 / 17: crisp 1 px outline
    tail=[(4.0, 14.0), (4.0, 21.0), (12.0, 14.0)],
    stroke=1.0,
    sparks=[(17.5, 6.0, 5.0, 1.9), (11.0, 12.0, 2.3, 0.85)],
    spark_stroke=0.0,
)
ICON16 = Icon(
    16,
    bubble=(6.5, 7.0, 5.5, 4.0, 2.25),  # edges on x = 1 / 12, y = 3 / 11
    tail=[(3.0, 9.0), (3.0, 14.0), (8.0, 9.0)],
    stroke=1.0,
    sparks=[(11.5, 4.0, 3.6, 1.35)],
    spark_stroke=0.0,
)
OUTPUTS = {
    ICONS / "toolbar24" / "ai-assistant.png": ICON24,
    ICONS / "toolbar16" / "ai-assistant.png": ICON16,
}


# ----------------------------------------------------------------------------------- PNG out --
def chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def png_bytes(rows: list[list[tuple[int, int, int, int]]]) -> bytes:
    """8-bit RGBA, no ancillary chunks (no timestamps), like the imported FBE icons."""
    height = len(rows)
    width = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: none
        for pixel in row:
            raw.extend(pixel)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def preview(rows: list[list[tuple[int, int, int, int]]]) -> str:
    lines = []
    for row in rows:
        line = ""
        for r, g, b, a in row:
            if a < 40:
                line += ".."
            else:
                lum = (r * 299 + g * 587 + b * 114) // 1000
                line += ("##" if lum < 80 else "oo" if lum < 160 else "++" if lum < 230 else "WW")
        lines.append(line)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--check", action="store_true", help="compare with the committed files instead of writing"
    )
    parser.add_argument(
        "--preview", action="store_true", help="print an ASCII preview of each icon"
    )
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
                print(
                    f"{path.relative_to(REPO)}: differs from the generated image", file=sys.stderr
                )
                differences += 1
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"{path.relative_to(REPO)}: {icon.size}x{icon.size} RGBA, {len(data)} bytes")
    return 1 if differences else 0


if __name__ == "__main__":
    sys.exit(main())

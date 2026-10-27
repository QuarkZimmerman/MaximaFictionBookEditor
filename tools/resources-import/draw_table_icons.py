#!/usr/bin/env python3
"""Draws the toolbar icons of the table commands (feature 006, T022; contracts/resource-formats.md
section 19): `insert.table` and the 24 `table.*` commands, 25 pairs of icons.

The icons are the project's own artwork (project licence): one flat family after the original's
table picture (`ui/public/icons/toolbar16/id_insert_table.png`, the tree's `struct-30`), drawn
like the AI assistant's icon - a dark grey outline, white cells, grey grid lines and the original's
blue header band as a gradient. The part a command acts on is soft orange, header cells take the
Body view's header cyan (`--mfbe-fb-th-bg`, `ui/src/app/layout.css`), and a corner sign on a white
halo names the action: a green plus (insert, duplicate), a red cross (delete), a blue arrow
(move), orange arrowheads inward (merge) or outward (split), a gold check (repair); a dashed
accent-blue frame marks *Select table* and a dark grey pilcrow the paragraph commands. The icons
are not recoloured for the dark theme. Developer tooling, never shipped; Python 3 standard library
only, deterministic output. The signed-distance rasteriser (16 x 16 samples per pixel) and the
PNG writer are a copy of those of `draw_ai_icons.py`, which stays untouched (no shared module).

    python3 tools/resources-import/draw_table_icons.py            # writes the 50 files
    python3 tools/resources-import/draw_table_icons.py --check    # exits 1 when a file differs
    python3 tools/resources-import/draw_table_icons.py --preview  # prints an ASCII rendering

Output: ui/public/icons/toolbar24/<base>.png (24x24) and ui/public/icons/toolbar16/<base>.png
(16x16), 8-bit RGBA with the chunks IHDR, IDAT and IEND only, for the base names of BASE_NAMES
(`table-` plus the command's name in kebab case; `insert.table` takes `table-insert`).
"""
from __future__ import annotations

import argparse
import math
import pathlib
import struct
import sys
import zlib
from typing import Callable

REPO = pathlib.Path(__file__).resolve().parents[2]
ICONS = REPO / "ui" / "public" / "icons"
SUPERSAMPLE = 16  # samples per pixel edge

Colour = tuple[int, int, int]
RGBA = tuple[int, int, int, int]
Point = tuple[float, float]

OUTLINE = (64, 64, 64)  # the dark grey of the FBE glyph outlines (as the AI icon)
CELL = (255, 255, 255)
GRID = (150, 150, 150)
BAND_FROM = (36, 52, 160)  # the original's blue header band, left
BAND_TO = (150, 168, 238)  # ... right
TARGET = (255, 214, 150)  # the part a command acts on
HEADER = (117, 255, 255)  # --mfbe-fb-th-bg, the Body view's header cells (light theme)
HALO = (255, 255, 255)
PLUS = (30, 150, 50)
CROSS = (205, 40, 30)
ARROW = (0, 120, 212)  # --mfbe-color-accent
ARROWHEADS = (252, 137, 10)  # the orange of id_view_body.png (the AI icon's spark)
CHECK = (200, 155, 0)  # --mfbe-color-warning's gold
FRAME = (0, 120, 212)  # --mfbe-color-accent
PILCROW = (64, 64, 64)

# The 25 base names, in the order of the commands (contracts/resource-formats.md section 19).
BASE_NAMES = (
    "table-insert",
    "table-insert-row-above",
    "table-insert-row-below",
    "table-delete-row",
    "table-insert-column-left",
    "table-insert-column-right",
    "table-delete-column",
    "table-merge-cells",
    "table-split-cell",
    "table-toggle-header-cell",
    "table-make-header-cells",
    "table-make-normal-cells",
    "table-toggle-header-row",
    "table-toggle-header-column",
    "table-repair",
    "table-select",
    "table-delete",
    "table-move-row-up",
    "table-move-row-down",
    "table-move-column-left",
    "table-move-column-right",
    "table-duplicate-row",
    "table-duplicate-column",
    "table-paragraph-before",
    "table-paragraph-after",
)


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


def sd_box(px: float, py: float, x0: float, y0: float, x1: float, y1: float) -> float:
    """A sharp axis-aligned rectangle [x0, x1] x [y0, y1]."""
    return sd_rounded_rect(px, py, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0.0)


def sd_circle(px: float, py: float, cx: float, cy: float, r: float) -> float:
    return math.hypot(px - cx, py - cy) - r


def sd_segment(px: float, py: float, a: Point, b: Point, r: float) -> float:
    """A stroke of half-width r from a to b, with round ends."""
    ex, ey = b[0] - a[0], b[1] - a[1]
    wx, wy = px - a[0], py - a[1]
    t = max(0.0, min(1.0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    return math.hypot(wx - ex * t, wy - ey * t) - r


# ------------------------------------------------------------------------------- the layers --
class Table:
    """A table on pixel boundaries. `vx` are the x of the vertical lines (1 px each: the left
    outline, the lines between the columns, the right outline), `hy` the y of the horizontal ones
    (the top outline, the line under the header band, the lines between the body rows, the bottom
    outline); the header band has no vertical lines, as in the original. Body cells are
    addressed (row, column) from 0."""

    def __init__(
        self,
        vx: list[int],
        hy: list[int],
        fills: dict[tuple[int, int], Colour] | None = None,
        merge: tuple[int, int, int] | None = None,
        split: bool = False,
        hole: bool = False,
    ):
        self.vx = vx
        self.hy = hy
        self.fills = dict(fills or {})
        self.merge = merge  # (row, first column, last column): one cell over those columns
        self.split = split  # the merged cell shows an orange split line
        self.hole = hole  # the last row lacks its last cell (a short row)

    @staticmethod
    def locate(lines: list[int], v: float) -> tuple[str, int]:
        """('line', i) on the i-th line, or ('gap', i) between line i and line i + 1."""
        for i, edge in enumerate(lines):
            if edge <= v < edge + 1:
                return "line", i
            if i + 1 < len(lines) and edge + 1 <= v < lines[i + 1]:
                return "gap", i
        raise ValueError(v)

    def merged(self, row: int, column: int) -> bool:
        return self.merge is not None and row == self.merge[0] and (
            self.merge[1] <= column <= self.merge[2]
        )

    def sample(self, x: float, y: float) -> Colour | None:
        vx, hy = self.vx, self.hy
        if not (vx[0] <= x < vx[-1] + 1 and hy[0] <= y < hy[-1] + 1):
            return None
        if self.hole and x >= vx[-2] and y >= hy[-2]:
            if x >= vx[-2] + 1 and y >= hy[-2] + 1:
                return None  # the missing cell and the outline around it
            return OUTLINE  # the short row's end and the line above the hole are the border now
        kx, ix = self.locate(vx, x)
        ky, iy = self.locate(hy, y)
        if (kx == "line" and ix in (0, len(vx) - 1)) or (ky == "line" and iy in (0, len(hy) - 1)):
            return OUTLINE
        if ky == "gap" and iy == 0:  # the header band, a gradient from left to right
            t = max(0.0, min(1.0, (x - vx[0] - 1) / (vx[-1] - vx[0] - 1)))
            return tuple(round(a + (b - a) * t) for a, b in zip(BAND_FROM, BAND_TO))  # type: ignore[return-value]
        if ky == "line" and iy == 1:
            return GRID  # the line under the band
        if ky == "gap" and kx == "gap":
            return self.fills.get((iy - 1, ix), CELL)
        if ky == "gap" and kx == "line":  # a vertical line inside a body row
            row = iy - 1
            if self.merged(row, ix - 1) and self.merged(row, ix):
                return ARROWHEADS if self.split else self.fills.get((row, ix), CELL)
            return GRID
        return GRID  # a horizontal line between body rows, or a crossing


class Ring:
    """A rectangular ring [x0, x1) x [y0, y1) of the given width, optionally dashed (`dash` px
    on, `dash` px off along each side)."""

    def __init__(
        self, x0: int, y0: int, x1: int, y1: int, colour: Colour, width: int = 1, dash: int = 0
    ):
        self.box = (x0, y0, x1, y1)
        self.colour = colour
        self.width = width
        self.dash = dash

    def sample(self, x: float, y: float) -> Colour | None:
        x0, y0, x1, y1 = self.box
        w = self.width
        if not (x0 <= x < x1 and y0 <= y < y1):
            return None
        if x0 + w <= x < x1 - w and y0 + w <= y < y1 - w:
            return None
        if self.dash:
            along = x - x0 if (y < y0 + w or y >= y1 - w) else y - y0
            if int(along) // self.dash % 2:
                return None
        return self.colour


class Sign:
    """A filled shape (union of signed distances) on a white halo, inside its bounding box."""

    def __init__(
        self,
        parts: list[Callable[[float, float], float]],
        colour: Colour,
        box: tuple[float, float, float, float],
        halo: float = 1.0,
    ):
        self.parts = parts
        self.colour = colour
        self.halo = halo
        x0, y0, x1, y1 = box
        self.box = (x0 - halo - 1, y0 - halo - 1, x1 + halo + 1, y1 + halo + 1)

    def sample(self, x: float, y: float) -> Colour | None:
        x0, y0, x1, y1 = self.box
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return None
        d = min(part(x, y) for part in self.parts)
        if d <= 0.0:
            return self.colour
        if d <= self.halo:
            return HALO
        return None


class Glyph:
    """One icon: layers sampled top first."""

    def __init__(self, size: int, layers: list):
        self.size = size
        self.layers = layers

    def sample(self, x: float, y: float) -> RGBA | None:
        for layer in self.layers:
            colour = layer.sample(x, y)
            if colour is not None:
                return (*colour, 255)
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


# ---------------------------------------------------------------------------- the geometry --
class Geometry:
    """The pixel layout of one size: the family's table, the small table of the select and
    paragraph icons, and the corner sign's place."""

    def __init__(self, size: int):
        self.size = size
        # The frame's sides are 2 modulo 4 pixels long, so that its 2 px dashes start and end
        # on its corners.
        if size == 24:
            self.vx, self.hy = [1, 8, 15, 22], [2, 6, 11, 16, 21]  # 22 x 20, cells 6 x 4
            self.small_vx = [4, 9, 14, 19]  # 16 wide, cells 4 px
            self.select_vx, self.select_hy = self.small_vx, [6, 9, 13, 17]  # 16 x 12
            self.frame = (1, 3, 23, 21)  # 22 x 18, two pixels from the table
            self.before_hy, self.after_hy = [12, 15, 19, 23], [0, 3, 7, 11]
            self.pilcrow_x, self.pilcrow_before_y, self.pilcrow_after_y = 8, 1, 13
            self.pilcrow_h, self.bowl, self.stem = 10, 2.5, 2
            self.c, self.arm, self.bar = 18.5, 4.5, 1.5  # the corner sign's centre and sizes
            self.check_c, self.check_arm = 19.25, 3.75  # the check stands in the short row's gap
        elif size == 16:
            self.vx, self.hy = [0, 5, 10, 15], [2, 5, 8, 11, 14]  # 16 x 13, as the original
            self.small_vx = [2, 6, 9, 13]  # 12 wide
            self.select_vx, self.select_hy = [3, 6, 9, 12], [3, 6, 9, 12]  # 10 x 10
            self.frame = (1, 1, 15, 15)  # 14 x 14, one pixel from the table
            self.before_hy, self.after_hy = [7, 9, 12, 15], [0, 2, 5, 8]
            self.pilcrow_x, self.pilcrow_before_y, self.pilcrow_after_y = 5, 0, 10
            self.pilcrow_h, self.bowl, self.stem = 6, 1.5, 1
            self.c, self.arm, self.bar = 12.0, 3.0, 1.0
            self.check_c, self.check_arm = 12.5, 2.75
        else:
            raise ValueError(size)

    # --- corner signs, centred on (c, c) -----------------------------------------------------
    def box(self) -> tuple[float, float, float, float]:
        c, arm = self.c, self.arm
        return (c - arm - 0.5, c - arm - 0.5, c + arm + 0.5, c + arm + 0.5)

    def plus(self) -> Sign:
        c, arm, bar = self.c, self.arm, self.bar
        return Sign(
            [
                lambda x, y: sd_box(x, y, c - arm, c - bar, c + arm, c + bar),
                lambda x, y: sd_box(x, y, c - bar, c - arm, c + bar, c + arm),
            ],
            PLUS,
            self.box(),
        )

    def cross(self) -> Sign:
        c, d, r = self.c, self.arm * 0.78, self.bar * 0.9
        return Sign(
            [
                lambda x, y: sd_segment(x, y, (c - d, c - d), (c + d, c + d), r),
                lambda x, y: sd_segment(x, y, (c + d, c - d), (c - d, c + d), r),
            ],
            CROSS,
            self.box(),
        )

    def arrow(self, direction: str) -> Sign:
        """An arrow pointing up, down, left or right: a head and a shaft as one polygon."""
        c, arm, bar = self.c, self.arm, self.bar * 0.85
        head = arm * 0.95  # half-width of the head
        depth = arm * 0.95  # height of the head
        up = [
            (0.0, -arm),
            (head, -arm + depth),
            (bar, -arm + depth),
            (bar, arm),
            (-bar, arm),
            (-bar, -arm + depth),
            (-head, -arm + depth),
        ]
        turn = {
            "up": lambda u, v: (u, v),
            "down": lambda u, v: (u, -v),
            "left": lambda u, v: (v, u),
            "right": lambda u, v: (-v, u),
        }[direction]
        vertices = [(c + p[0], c + p[1]) for p in (turn(u, v) for u, v in up)]
        if direction in ("down", "right"):
            vertices.reverse()  # keep the winding of the "up" polygon
        return Sign([lambda x, y: sd_polygon(x, y, vertices)], ARROW, self.box())

    def arrowheads(self, inward: bool) -> Sign:
        """Two arrowheads on a horizontal line: pointing at each other (merge) or apart (split)."""
        c, arm = self.c, self.arm
        gap = 0.5
        half = arm * 0.85  # half the height of a head
        depth = arm - gap
        if inward:  # |> <|
            left = [(c - arm, c - half), (c - gap, c), (c - arm, c + half)]
            right = [(c + arm, c - half), (c + arm, c + half), (c + gap, c)]
        else:  # <| |>
            left = [(c - gap, c - half), (c - gap, c + half), (c - gap - depth, c)]
            right = [(c + gap, c - half), (c + gap + depth, c), (c + gap, c + half)]
        return Sign(
            [lambda x, y: sd_polygon(x, y, left), lambda x, y: sd_polygon(x, y, right)],
            ARROWHEADS,
            self.box(),
        )

    def check(self) -> Sign:
        c, arm, r = self.check_c, self.check_arm, self.bar * 0.85
        a = (c - arm + r, c)
        b = (c - arm * 0.3, c + arm - r)
        e = (c + arm - r, c - arm * 0.75)
        return Sign(
            [lambda x, y: sd_segment(x, y, a, b, r), lambda x, y: sd_segment(x, y, b, e, r)],
            CHECK,
            (c - arm, c - arm, c + arm, c + arm),
        )

    def pilcrow(self, y0: int) -> Sign:
        """A pilcrow: a round bowl at the top left, two stems, a bar over them."""
        x0, h, bowl, stem = self.pilcrow_x, self.pilcrow_h, self.bowl, self.stem
        left = x0 + 2 * bowl - stem  # the left stem's x, against the bowl's flat side
        right = left + stem + 1  # one pixel between the stems
        parts = [
            lambda x, y: sd_circle(x, y, x0 + bowl, y0 + bowl, bowl),
            lambda x, y: sd_box(x, y, x0 + bowl, y0, left + stem, y0 + 2 * bowl),
            lambda x, y: sd_box(x, y, left, y0, left + stem, y0 + h),
            lambda x, y: sd_box(x, y, right, y0, right + stem, y0 + h),
            lambda x, y: sd_box(x, y, x0 + bowl, y0, right + stem, y0 + max(1, stem)),
        ]
        return Sign(parts, PILCROW, (x0, y0, right + stem, y0 + h))

    # --- tables -------------------------------------------------------------------------------
    def table(self, **options) -> Table:
        return Table(self.vx, self.hy, **options)

    def row(self, *rows: int, colour: Colour = TARGET) -> dict[tuple[int, int], Colour]:
        return {(r, c): colour for r in rows for c in range(len(self.vx) - 1)}

    def column(self, *columns: int, colour: Colour = TARGET) -> dict[tuple[int, int], Colour]:
        return {(r, c): colour for r in range(len(self.hy) - 2) for c in columns}

    def block(self, rows: range, columns: range, colour: Colour) -> dict[tuple[int, int], Colour]:
        return {(r, c): colour for r in rows for c in columns}

    def block_ring(self, rows: range, columns: range) -> Ring:
        """A cyan ring just inside the outline of a block of body cells."""
        x0 = self.vx[columns.start] + 1
        x1 = self.vx[columns.stop]
        y0 = self.hy[rows.start + 1] + 1
        y1 = self.hy[rows.stop + 1]
        return Ring(x0, y0, x1, y1, HEADER)


def glyph(base: str, size: int) -> Glyph:
    g = Geometry(size)
    t = g.table
    block = (range(1, 3), range(1, 3))  # the 2 x 2 block of the block commands
    layers: dict[str, list] = {
        "table-insert": [t()],
        "table-insert-row-above": [g.plus(), t(fills=g.row(0))],
        "table-insert-row-below": [g.plus(), t(fills=g.row(2))],
        "table-delete-row": [g.cross(), t(fills=g.row(1))],
        "table-insert-column-left": [g.plus(), t(fills=g.column(0))],
        "table-insert-column-right": [g.plus(), t(fills=g.column(2))],
        "table-delete-column": [g.cross(), t(fills=g.column(1))],
        "table-merge-cells": [
            g.arrowheads(inward=True),
            t(fills=g.block(range(1, 2), range(0, 2), TARGET), merge=(1, 0, 1)),
        ],
        "table-split-cell": [
            g.arrowheads(inward=False),
            t(fills=g.block(range(1, 2), range(0, 2), TARGET), merge=(1, 0, 1), split=True),
        ],
        "table-toggle-header-cell": [t(fills={(1, 1): HEADER})],
        "table-make-header-cells": [t(fills=g.block(*block, HEADER))],
        "table-make-normal-cells": [g.block_ring(*block), t()],
        "table-toggle-header-row": [t(fills=g.row(0, colour=HEADER))],
        "table-toggle-header-column": [t(fills=g.column(0, colour=HEADER))],
        "table-repair": [g.check(), t(fills={(2, 0): TARGET, (2, 1): TARGET}, hole=True)],
        "table-select": [Ring(*g.frame, FRAME, dash=2), Table(g.select_vx, g.select_hy)],
        "table-delete": [g.cross(), t()],
        "table-move-row-up": [g.arrow("up"), t(fills=g.row(1))],
        "table-move-row-down": [g.arrow("down"), t(fills=g.row(1))],
        "table-move-column-left": [g.arrow("left"), t(fills=g.column(1))],
        "table-move-column-right": [g.arrow("right"), t(fills=g.column(1))],
        "table-duplicate-row": [g.plus(), t(fills=g.row(1, 2))],
        "table-duplicate-column": [g.plus(), t(fills=g.column(1, 2))],
        "table-paragraph-before": [
            g.pilcrow(g.pilcrow_before_y),
            Table(g.small_vx, g.before_hy),
        ],
        "table-paragraph-after": [
            g.pilcrow(g.pilcrow_after_y),
            Table(g.small_vx, g.after_hy),
        ],
    }
    return Glyph(size, layers[base])


def outputs() -> dict[pathlib.Path, tuple[str, int]]:
    files: dict[pathlib.Path, tuple[str, int]] = {}
    for base in BASE_NAMES:
        files[ICONS / "toolbar24" / f"{base}.png"] = (base, 24)
        files[ICONS / "toolbar16" / f"{base}.png"] = (base, 16)
    return files


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


PREVIEW_PALETTE = (
    (OUTLINE, "##"),
    (CELL, "  "),
    (GRID, "::"),
    (BAND_FROM, "bb"),
    (BAND_TO, "BB"),
    (TARGET, "oo"),
    (HEADER, "cc"),
    (PLUS, "++"),
    (CROSS, "xx"),
    (ARROW, "^^"),
    (ARROWHEADS, "<>"),
    (CHECK, "vv"),
)


def preview(rows: list[list[tuple[int, int, int, int]]]) -> str:
    """Two characters per pixel: '..' transparent, else the nearest colour of the family."""
    lines = []
    for row in rows:
        line = ""
        for r, g, b, a in row:
            if a < 96:
                line += ".."
                continue
            nearest = min(
                PREVIEW_PALETTE,
                key=lambda entry: sum((p - q) ** 2 for p, q in zip(entry[0], (r, g, b))),
            )
            line += nearest[1]
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
    for path, (base, size) in outputs().items():
        rows = glyph(base, size).render()
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
        if args.preview:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"{path.relative_to(REPO)}: {size}x{size} RGBA, {len(data)} bytes")
    return 1 if differences else 0


if __name__ == "__main__":
    sys.exit(main())

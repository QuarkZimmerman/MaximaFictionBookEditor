#!/usr/bin/env python3
"""Generate large FB2 books for the performance journeys (T069, T150 / SC-002; feature 006
perf-tables / SC-005).

Two shapes, both deterministic (seeded):

* **text-only** (default): pseudo-prose sections of `--paragraphs` paragraphs each, every
  paragraph a few sentences long, until the file reaches about `--size-mb` megabytes of UTF-8
  text (Russian and English words so the file exercises multi-byte text).
* **image-heavy** (`--images N`): N sections, each with a title, a block image and a few
  paragraphs, plus N large `<binary>` objects (PNG and baseline JPEG, alternating per
  `--image-mix`, base64 wrapped at 76 columns) sized so the whole file reaches `--size-mb`.
  The images are written by the pure-Python encoders below (no Pillow needed): noise images
  are incompressible, so the size per binary is predictable and the decoder has to do real
  work when the Body view asks for previews.

Tables (`--table RxC[@SECTION][:merges]`, repeatable, text-only books; an error with
`--images`): a table of R rows x C columns right after the title of section SECTION (from 1,
default 1, the first section, which the Body view mounts first), its first row header cells
(`th`) and every other cell a `td`, each cell holding `r<row>c<column>`; `merges` (default 0)
merged cells, each a 2 x 2 block in the body rows placed from the seed without touching
another, so the table stays regular. The tables draw from a generator of their own, seeded from
`--seed`, and do not count towards `--size-mb`, so the prose equals that of the same book
without them; without `--table` the output is byte-identical to that of the generator before
the option existed.

Prints the path and the number of sections/paragraphs/binaries (and tables) written.

Usage:
  gen-large-book.py --out /tmp/large.fb2 [--size-mb 10] [--seed 1] [--table RxC[@SECTION][:merges] ...]
  gen-large-book.py --out /tmp/images.fb2 --size-mb 150 --images 300 [--image-mix 2:1]
  gen-large-book.py --out /tmp/tables.fb2 --size-mb 10 --table 300x10@1:4 --table 1000x20@3:8 \\
      --table 628x4@4:2 --table 298x14@5:4
      (the SC-005 book of perf-tables: the 10 MB book with a 300 x 10 table in section 1, a
      1000 x 20 table in section 3 and the census's largest real shapes, 628 x 4 in section 4
      and 298 x 14 in section 5)
"""

from __future__ import annotations

import argparse
import base64
import random
import re
import struct
import sys
import zlib
from collections.abc import Sequence
from dataclasses import dataclass
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
\t\t\t<author><first-name>Perf</first-name><last-name>Fixture</last-name></author>
\t\t\t<book-title>Large generated book</book-title>
{coverpage}\t\t\t<lang>ru</lang>
\t\t</title-info>
\t\t<document-info>
\t\t\t<author><nickname>gen-large-book</nickname></author>
\t\t\t<program-used>gen-large-book.py</program-used>
\t\t\t<date value="2026-01-01">2026</date>
\t\t\t<id>perf-large-book</id>
\t\t\t<version>1.0</version>
\t\t</document-info>
\t</description>
\t<body>
\t\t<title><p>Large generated book</p></title>
"""

BODY_FOOTER = "\t</body>\n"
FOOTER = "</FictionBook>\n"


def sentence(rng: random.Random, words: list[str]) -> str:
    count = rng.randint(6, 16)
    text = " ".join(rng.choice(words) for _ in range(count))
    return text[0].upper() + text[1:] + rng.choice([".", ".", ".", "!", "?"])


def paragraph(rng: random.Random, index: int) -> str:
    words = WORDS_RU if index % 3 else WORDS_EN
    sentences = " ".join(sentence(rng, words) for _ in range(rng.randint(2, 6)))
    if index % 17 == 0:
        sentences = sentences.replace(" ", "\u00a0", 1)  # a non-breaking space now and then
    if index % 11 == 0:
        head, _, tail = sentences.partition(" ")
        sentences = f"<strong>{head}</strong> {tail}"
    elif index % 13 == 0:
        head, _, tail = sentences.partition(" ")
        sentences = f"<emphasis>{head}</emphasis> {tail}"
    return f"\t\t\t<p>{sentences}</p>\n"


# --------------------------------------------------------------------------------------------
# Image encoders (pure Python, deterministic)
# --------------------------------------------------------------------------------------------


def png_bytes(width: int, height: int, rng: random.Random) -> bytes:
    """8-bit RGB PNG filled with noise (incompressible: size ~ width * height * 3)."""
    rows = bytearray()
    row_len = width * 3
    for _ in range(height):
        rows.append(0)  # filter type: none
        rows += rng.randbytes(row_len)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 1))
        + chunk(b"IEND", b"")
    )


# Standard Huffman tables (ITU-T T.81 Annex K.3).
_DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
_DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
_DC_VALUES = list(range(12))
_AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7D]
_AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
_AC_LUMA_VALUES = bytes(
    [
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
        0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
        0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
        0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
        0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
        0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
        0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA,
    ]
)
_AC_CHROMA_VALUES = bytes(
    [
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
        0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
        0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
        0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
        0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
        0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA,
    ]
)
# Every (run, size) symbol the encoder may emit plus EOB and ZRL must exist in the AC tables.
_AC_SYMBOLS = {0x00, 0xF0} | {(run << 4) | size for run in range(16) for size in range(1, 11)}
for _bits, _values in ((_AC_LUMA_BITS, _AC_LUMA_VALUES), (_AC_CHROMA_BITS, _AC_CHROMA_VALUES)):
    assert sum(_bits) == len(_values) == 162 and set(_values) == _AC_SYMBOLS, "corrupt AC table"


def _huffman_codes(bits: list[int], values: bytes | list[int]) -> dict[int, tuple[int, int]]:
    codes: dict[int, tuple[int, int]] = {}
    code = 0
    k = 0
    for length in range(1, 17):
        for _ in range(bits[length - 1]):
            codes[values[k]] = (code, length)
            k += 1
            code += 1
        code <<= 1
    return codes


def _dht_segment(table_class: int, table_id: int, bits: list[int], values: bytes | list[int]) -> bytes:
    payload = bytes([(table_class << 4) | table_id]) + bytes(bits) + bytes(values)
    return b"\xff\xc4" + struct.pack(">H", len(payload) + 2) + payload


class _BitWriter:
    def __init__(self) -> None:
        self.out = bytearray()
        self.acc = 0
        self.count = 0

    def put(self, value: int, nbits: int) -> None:
        self.acc = (self.acc << nbits) | (value & ((1 << nbits) - 1))
        self.count += nbits
        while self.count >= 8:
            byte = (self.acc >> (self.count - 8)) & 0xFF
            self.out.append(byte)
            if byte == 0xFF:
                self.out.append(0)  # byte stuffing
            self.count -= 8
            self.acc &= (1 << self.count) - 1

    @property
    def aligned(self) -> bool:
        return self.count == 0


def _encode_block(
    rng: random.Random,
    dc: dict[int, tuple[int, int]],
    ac: dict[int, tuple[int, int]],
    density: float,
    max_bits: int,
) -> bytes | None:
    """Entropy-codes one 8x8 block (DC difference 0, random AC coefficients); returns the
    bytes only when the block ends exactly on a byte boundary, so blocks can be concatenated."""
    writer = _BitWriter()
    writer.put(*dc[0])  # DC difference 0 (category 0)
    run = 0
    for _ in range(63):
        if rng.random() >= density:
            run += 1
            continue
        while run > 15:
            writer.put(*ac[0xF0])  # ZRL
            run -= 16
        size = rng.randint(1, max_bits)
        magnitude = rng.randint(1 << (size - 1), (1 << size) - 1)
        value = magnitude if rng.random() < 0.5 else -magnitude
        writer.put(*ac[(run << 4) | size])
        writer.put(value if value > 0 else value + (1 << size) - 1, size)
        run = 0
    if run > 0:
        writer.put(*ac[0x00])  # EOB
    return bytes(writer.out) if writer.aligned else None


def _block_pool(
    rng: random.Random,
    dc: dict[int, tuple[int, int]],
    ac: dict[int, tuple[int, int]],
    density: float,
    size: int = 96,
) -> list[bytes]:
    pool: list[bytes] = []
    while len(pool) < size:
        block = _encode_block(rng, dc, ac, density, max_bits=5)
        if block is not None:
            pool.append(block)
    return pool


def jpeg_bytes(
    width: int,
    height: int,
    rng: random.Random,
    density: float = 0.55,
    target_bytes: int | None = None,
) -> bytes:
    """Baseline JPEG (3 components, 4:4:4, standard Huffman tables): a mid-grey image with
    dense random AC texture. Every block is pre-encoded to a whole number of bytes, so the
    entropy-coded segment is a concatenation of pool entries and generation is fast. With
    `target_bytes` the dimensions are derived from the pool statistics instead."""
    dc_l = _huffman_codes(_DC_LUMA_BITS, _DC_VALUES)
    ac_l = _huffman_codes(_AC_LUMA_BITS, _AC_LUMA_VALUES)
    dc_c = _huffman_codes(_DC_CHROMA_BITS, _DC_VALUES)
    ac_c = _huffman_codes(_AC_CHROMA_BITS, _AC_CHROMA_VALUES)
    luma = _block_pool(rng, dc_l, ac_l, density)
    chroma = _block_pool(rng, dc_c, ac_c, density * 0.6)
    if target_bytes is not None:
        mcu_bytes = sum(map(len, luma)) / len(luma) + 2 * sum(map(len, chroma)) / len(chroma)
        width, height = _dimensions(target_bytes, mcu_bytes / 64)

    out = bytearray(b"\xff\xd8")
    out += b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    out += b"\xff\xdb" + struct.pack(">H", 2 + 65 + 65) + b"\x00" + bytes([8] * 64) + b"\x01" + bytes([12] * 64)
    out += b"\xff\xc0" + struct.pack(">HBHHB", 17, 8, height, width, 3)
    out += bytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
    out += _dht_segment(0, 0, _DC_LUMA_BITS, _DC_VALUES)
    out += _dht_segment(1, 0, _AC_LUMA_BITS, _AC_LUMA_VALUES)
    out += _dht_segment(0, 1, _DC_CHROMA_BITS, _DC_VALUES)
    out += _dht_segment(1, 1, _AC_CHROMA_BITS, _AC_CHROMA_VALUES)
    out += b"\xff\xda" + struct.pack(">HB", 12, 3) + bytes([1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
    mcus = ((width + 7) // 8) * ((height + 7) // 8)
    pieces: list[bytes] = []
    for _ in range(mcus):
        pieces.append(rng.choice(luma))
        pieces.append(rng.choice(chroma))
        pieces.append(rng.choice(chroma))
    out += b"".join(pieces)
    out += b"\xff\xd9"
    return bytes(out)


def _dimensions(target_bytes: int, bytes_per_pixel: float) -> tuple[int, int]:
    """4:3 dimensions (multiples of 8) giving roughly `target_bytes` at `bytes_per_pixel`."""
    pixels = max(64 * 64, int(target_bytes / bytes_per_pixel))
    width = max(8, (int((pixels * 4 / 3) ** 0.5) // 8) * 8)
    height = max(8, (int(pixels / width) // 8) * 8)
    return width, height


# --------------------------------------------------------------------------------------------
# Tables (--table, feature 006: the SC-005 book of perf-tables)
# --------------------------------------------------------------------------------------------

TABLE_OPTION = re.compile(r"(\d+)x(\d+)(?:@(\d+))?(?::(\d+))?")


@dataclass(frozen=True)
class TableSpec:
    """One `--table RxC[@SECTION][:merges]`: R rows x C columns after the title of section
    SECTION (from 1), with `merges` merged 2 x 2 blocks."""

    rows: int
    columns: int
    section: int
    merges: int
    text: str


def table_spec(value: str) -> TableSpec:
    match = TABLE_OPTION.fullmatch(value.strip())
    if not match:
        raise argparse.ArgumentTypeError(f"expected RxC[@SECTION][:merges], got {value!r}")
    rows, columns = int(match[1]), int(match[2])
    section = int(match[3]) if match[3] is not None else 1
    merges = int(match[4]) if match[4] is not None else 0
    if rows < 1 or columns < 1 or section < 1:
        raise argparse.ArgumentTypeError(f"rows, columns and section start at 1, got {value!r}")
    return TableSpec(rows, columns, section, merges, value.strip())


def place_merges(spec: TableSpec, rng: random.Random) -> list[tuple[int, int]]:
    """The top-left positions (row, column; from 0) of the merged 2 x 2 blocks: drawn from the
    seed among the body rows (the header row stays whole), no block touching another, not even
    at a corner, so the table stays regular."""
    if spec.merges == 0:
        return []
    candidates = [(r, c) for r in range(1, spec.rows - 1) for c in range(spec.columns - 1)]
    rng.shuffle(candidates)
    blocked: set[tuple[int, int]] = set()
    placed: list[tuple[int, int]] = []
    for r, c in candidates:
        if (r, c) in blocked:
            continue
        placed.append((r, c))
        if len(placed) == spec.merges:
            return sorted(placed)
        blocked.update((r + dr, c + dc) for dr in range(-2, 3) for dc in range(-2, 3))
    raise ValueError(
        f"--table {spec.text}: no room for {spec.merges} merged 2 x 2 blocks that touch no other"
    )


def table_xml(spec: TableSpec, rng: random.Random) -> str:
    """The table: the first row header cells (th), every other cell a td, each holding
    r<row>c<column> (from 1); a merged block's cell holds the text of its top-left position."""
    starts = set(place_merges(spec, rng))
    covered = {(r + dr, c + dc) for r, c in starts for dr in (0, 1) for dc in (0, 1)} - starts
    lines = ["\t\t\t<table>\n"]
    for r in range(spec.rows):
        kind = "th" if r == 0 else "td"
        cells = []
        for c in range(spec.columns):
            if (r, c) in covered:
                continue
            spans = ' colspan="2" rowspan="2"' if (r, c) in starts else ""
            cells.append(f"<{kind}{spans}>r{r + 1}c{c + 1}</{kind}>")
        lines.append(f"\t\t\t\t<tr>{''.join(cells)}</tr>\n")
    lines.append("\t\t\t</table>\n")
    return "".join(lines)


def render_tables(tables: Sequence[TableSpec], seed: int) -> dict[int, str]:
    """The XML of every table by section, in the order of the options. The tables draw from a
    generator of their own, seeded from --seed, so they never disturb the prose generator."""
    rng = random.Random(b"gen-large-book --table %d" % seed)
    by_section: dict[int, str] = {}
    for spec in tables:
        by_section[spec.section] = by_section.get(spec.section, "") + table_xml(spec, rng)
    return by_section


# --------------------------------------------------------------------------------------------
# Books
# --------------------------------------------------------------------------------------------


def write_text_book(
    out: Path,
    size_mb: float,
    paragraphs_per_section: int,
    seed: int,
    tables: Sequence[TableSpec] = (),
) -> str:
    rng = random.Random(seed)
    # The tables come from a generator of their own (render_tables) and are not counted towards
    # the size, so the prose - every section and paragraph - equals that of the same book
    # without them, and without tables nothing below changes.
    pending = render_tables(tables, seed)
    target = int(size_mb * 1024 * 1024)
    written = 0
    table_bytes = 0
    sections = 0
    paragraphs = 0
    with out.open("w", encoding="utf-8", newline="\n") as fh:
        header = HEADER.format(coverpage="")
        fh.write(header)
        written += len(header.encode("utf-8"))
        while written < target:
            sections += 1
            chunk = [f'\t\t<section id="s{sections}">\n\t\t\t<title><p>Глава {sections}</p></title>\n']
            for i in range(paragraphs_per_section):
                paragraphs += 1
                chunk.append(paragraph(rng, paragraphs))
                if i % 40 == 39:
                    chunk.append("\t\t\t<empty-line/>\n")
            chunk.append("\t\t</section>\n")
            text = "".join(chunk)
            written += len(text.encode("utf-8"))
            placed = pending.pop(sections, "")
            if placed:
                chunk.insert(1, placed)  # right after the section's title
                text = "".join(chunk)
                table_bytes += len(placed.encode("utf-8"))
            fh.write(text)
        fh.write(BODY_FOOTER + FOOTER)
    if pending:
        missing = ", ".join(str(section) for section in sorted(pending))
        raise ValueError(f"--table: no section {missing}; the book has {sections} sections")
    summary = f"{out} {written / 1024 / 1024:.1f} MB, {sections} sections, {paragraphs} paragraphs"
    if tables:
        cells = sum(spec.rows * spec.columns - 3 * spec.merges for spec in tables)
        summary += (
            f", {len(tables)} tables ({cells} cells, {table_bytes / 1024 / 1024:.1f} MB more):"
            f" {' '.join(spec.text for spec in tables)}"
        )
    return summary


def write_image_book(
    out: Path, size_mb: float, images: int, paragraphs_per_section: int, seed: int, mix: str
) -> str:
    rng = random.Random(seed)
    png_share, _, jpeg_share = mix.partition(":")
    png_weight = int(png_share or 1)
    jpeg_weight = int(jpeg_share or 1)
    cycle = png_weight + jpeg_weight
    kinds = ["png" if i % cycle < png_weight else "jpg" for i in range(images)]

    # Base64 inflates by 4/3 (plus one newline per 76 columns); the text part is small.
    target = int(size_mb * 1024 * 1024)
    text_estimate = images * paragraphs_per_section * 420 + 4096
    raw_per_image = max(16 * 1024, int((target - text_estimate) * 3 / 4 * 76 / 77 / images))

    with out.open("wb") as fh:
        written = 0

        def emit(text: str) -> None:
            nonlocal written
            data = text.encode("utf-8")
            fh.write(data)
            written += len(data)

        cover = '\t\t\t<coverpage><image l:href="#img1.png"/></coverpage>\n' if images else ""
        emit(HEADER.format(coverpage=cover))
        paragraphs = 0
        for i in range(1, images + 1):
            name = f"img{i}.{kinds[i - 1]}"
            chunk = [f'\t\t<section id="s{i}">\n\t\t\t<title><p>Глава {i}</p></title>\n']
            chunk.append(f'\t\t\t<image l:href="#{name}"/>\n')
            for _ in range(paragraphs_per_section):
                paragraphs += 1
                chunk.append(paragraph(rng, paragraphs))
            chunk.append("\t\t</section>\n")
            emit("".join(chunk))
        emit(BODY_FOOTER)
        for i in range(1, images + 1):
            kind = kinds[i - 1]
            if kind == "png":
                width, height = _dimensions(raw_per_image, 3.0)
                payload = png_bytes(width, height, rng)
                content_type = "image/png"
            else:
                payload = jpeg_bytes(0, 0, rng, target_bytes=raw_per_image)
                content_type = "image/jpeg"
            encoded = base64.encodebytes(payload).decode("ascii")
            emit(f'\t<binary id="img{i}.{kind}" content-type="{content_type}">')
            emit(encoded)
            emit("</binary>\n")
        emit(FOOTER)
    return (
        f"{out} {written / 1024 / 1024:.1f} MB, {images} sections, {paragraphs} paragraphs,"
        f" {images} binaries ({kinds.count('png')} png, {kinds.count('jpg')} jpeg)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, help="output .fb2 path")
    parser.add_argument("--size-mb", type=float, default=10.0, help="approximate size in MB")
    parser.add_argument("--paragraphs", type=int, default=120, help="paragraphs per section")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--images", type=int, default=0, help="image-heavy book with this many sections/binaries"
    )
    parser.add_argument(
        "--image-mix", default="2:1", help="PNG:JPEG ratio of the binaries (default 2:1)"
    )
    parser.add_argument(
        "--table",
        type=table_spec,
        action="append",
        default=[],
        metavar="RxC[@SECTION][:merges]",
        help="a table of R rows x C columns after the title of section SECTION (default 1),"
        " with merges merged 2 x 2 blocks (default 0); repeatable; text-only books",
    )
    args = parser.parse_args()
    if args.table and args.images > 0:
        parser.error("--table cannot be combined with --images")
    if args.table:
        try:
            render_tables(args.table, args.seed)  # refuses impossible merges before writing
        except ValueError as error:
            parser.error(str(error))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.images > 0:
        paragraphs = args.paragraphs if args.paragraphs != 120 else 6
        print(write_image_book(out, args.size_mb, args.images, paragraphs, args.seed, args.image_mix))
    else:
        try:
            print(write_text_book(out, args.size_mb, args.paragraphs, args.seed, args.table))
        except ValueError as error:
            out.unlink(missing_ok=True)
            parser.error(str(error))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Synthetic MOBI / KF8 / PalmDOC fixture generator for feature 018 tests (T004).

Produces deterministic valid MOBI 7 (uncompressed, PalmDOC LZ77, HuffCDIC; UTF-8 and
Windows-1252), joint MOBI 7 + KF8 (healthy and damaged-KF8), KF8-only (.azw3 with CSS,
SVG-framed cover, vector SVG, MathML, pop-up footnotes), plain PalmDOC (.prc), third-party
FB2 converter samples (Calibre, fb2converter, maxlibmobi), encrypted/DRM files, KFX magic,
FB2 renamed to .mobi, and optional --hostile malformed/bomb/script fixtures.

Standard library only; deterministic output across platforms.
"""

from __future__ import annotations

import argparse
import base64
import os
import struct
import zlib
from pathlib import Path
from typing import Iterable


# Tiny valid 1x1 red RGB baseline JFIF JPEG (160 bytes) and 1x1 blue PNG (69 bytes).
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////"
    "////////////////////////////////////////////wgALCAABAAEBAREA/8QAFAABAAAAAAAA"
    "AAAAAAAAAAAACf/aAAgBAQABPxA="
)

def make_png_1x1(rgb: tuple[int, int, int] = (30, 90, 200), width: int = 1, height: int = 1) -> bytes:
    """Create a valid minimal RGB PNG (or header-declared arbitrary width/height for hostile tests)."""
    def chunk(ctype: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(ctype + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"\x00" + bytes(rgb)
    idat = zlib.compress(raw)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def palmdoc_compress(data: bytes) -> bytes:
    """Standard PalmDOC LZ77 compressor matching Mobipocket spec."""
    out = bytearray()
    n = len(data)
    i = 0
    while i < n:
        # Back-reference search (distance 1..2047, length 3..10)
        best_dist = 0
        best_len = 0
        window_start = max(0, i - 2047)
        max_len = min(10, n - i)
        if max_len >= 3:
            needle3 = data[i : i + 3]
            pos = data.rfind(needle3, window_start, i)
            while pos != -1:
                length = 3
                while length < max_len and data[pos + length] == data[i + length]:
                    length += 1
                if length > best_len:
                    best_len = length
                    best_dist = i - pos
                    if best_len == max_len:
                        break
                pos = data.rfind(needle3, window_start, pos)
        if best_len >= 3:
            pair = 0x8000 | ((best_dist & 0x7FF) << 3) | ((best_len - 3) & 0x7)
            out.append((pair >> 8) & 0xFF)
            out.append(pair & 0xFF)
            i += best_len
            continue

        b = data[i]
        # Space + printable ASCII [0x40..0x7F] -> single byte b2 ^ 0x80
        if b == 0x20 and i + 1 < n and 0x40 <= data[i + 1] <= 0x7F:
            out.append(data[i + 1] ^ 0x80)
            i += 2
            continue
        if b == 0x00 or (0x09 <= b <= 0x7F):
            out.append(b)
            i += 1
            continue
        # Raw literal run 1..8 bytes for non-ASCII / control bytes
        run_end = i + 1
        while run_end < n and (run_end - i) < 8:
            nb = data[run_end]
            if nb == 0x00 or (0x09 <= nb <= 0x7F):
                break
            run_end += 1
        run_len = run_end - i
        out.append(run_len)
        out.extend(data[i:run_end])
        i = run_end
    return bytes(out)


def encode_vwi_forward(val: int) -> bytes:
    """Encode unsigned int as big-endian 7-bit VWI with stop bit 0x80 on the last byte."""
    parts = [val & 0x7F]
    val >>= 7
    while val:
        parts.append(val & 0x7F)
        val >>= 7
    parts.reverse()
    parts[-1] |= 0x80
    return bytes(parts)


def build_palmdb(
    name: str,
    records: list[bytes],
    db_type: bytes = b"BOOK",
    creator: bytes = b"MOBI",
) -> bytes:
    """Assemble a valid PalmDB file."""
    raw_name = name.encode("ascii", errors="ignore")[:31].ljust(32, b"\x00")
    num_records = len(records)
    # 78-byte header + 8 * num_records record table + 2-byte zero gap
    offset = 78 + 8 * num_records + 2
    header = bytearray(78)
    header[0:32] = raw_name
    struct.pack_into(">HH", header, 32, 0, 0)
    struct.pack_into(">III", header, 36, 0xE1234567, 0xE1234567, 0)
    header[60:64] = db_type
    header[64:68] = creator
    struct.pack_into(">IIH", header, 68, 0, 0, num_records)

    table = bytearray()
    for idx, rec in enumerate(records):
        table.extend(struct.pack(">IBBH", offset, 0, (idx >> 16) & 0xFF, idx & 0xFFFF))
        offset += len(rec)
    table.extend(b"\x00\x00")
    return bytes(header) + bytes(table) + b"".join(records)


def build_exth(entries: list[tuple[int, bytes]]) -> bytes:
    body = bytearray()
    for rec_type, payload in entries:
        body.extend(struct.pack(">II", rec_type, 8 + len(payload)))
        body.extend(payload)
    total_len = 12 + len(body)
    pad = (4 - (total_len % 4)) % 4
    return b"EXTH" + struct.pack(">II", total_len, len(entries)) + bytes(body) + (b"\x00" * pad)


def build_flis() -> bytes:
    return b"FLIS" + struct.pack(
        ">IHHIHHII",
        8,
        65,
        0,
        0,
        0xFFFF,
        0xFFFF,
        1,
        3,
    )[:32]


def make_flis_record() -> bytes:
    return (
        b"FLIS"
        + struct.pack(">I", 8)
        + struct.pack(">H", 65)
        + struct.pack(">H", 0)
        + struct.pack(">I", 0)
        + struct.pack(">I", 0xFFFFFFFF)
        + struct.pack(">H", 1)
        + struct.pack(">H", 3)
        + struct.pack(">I", 3)
        + struct.pack(">I", 1)
        + struct.pack(">I", 0xFFFFFFFF)
    )


def make_fcis_record(text_length: int) -> bytes:
    return (
        b"FCIS"
        + struct.pack(
            ">IIIIIIIIII",
            20,
            16,
            1,
            0,
            text_length,
            0,
            32,
            8,
            1,
            1,
        )
        + struct.pack(">I", 0)
    )


EOF_RECORD = b"\xE9\x8E\x0D\x0A"


def build_mobi7_ncx_records(entries: list[tuple[int, int, str, int]]) -> list[bytes]:
    """Build MOBI 7 INDX meta + entry + CNCX records for (offset, length, label, depth)."""
    cncx = bytearray()
    label_offsets: list[int] = []
    for _off, _ln, label, _depth in entries:
        label_offsets.append(len(cncx))
        utf8 = label.encode("utf-8")
        cncx.extend(encode_vwi_forward(len(utf8)))
        cncx.extend(utf8)

    # Entry record
    entry_buf = bytearray(192)
    entry_offsets: list[int] = []
    last_key = b""
    for idx, (off, ln, _label, depth) in enumerate(entries):
        entry_offsets.append(len(entry_buf))
        key = f"{idx:04X}".encode("ascii")
        last_key = key
        entry_buf.append(len(key))
        entry_buf.extend(key)
        # Control byte: bits 0,1,2,3 set -> tags 1,2,3,4 present (1 value each)
        entry_buf.append(0x0F)
        entry_buf.extend(encode_vwi_forward(off))
        entry_buf.extend(encode_vwi_forward(ln))
        entry_buf.extend(encode_vwi_forward(label_offsets[idx]))
        entry_buf.extend(encode_vwi_forward(depth))
    if len(entry_buf) % 2:
        entry_buf.append(0)
    idxt_off = len(entry_buf)
    entry_buf.extend(b"IDXT")
    for eo in entry_offsets:
        entry_buf.extend(struct.pack(">H", eo))
    while len(entry_buf) % 4:
        entry_buf.append(0)
    entry_buf[0:4] = b"INDX"
    struct.pack_into(">IIIIIIIIII", entry_buf, 4, 192, 0, 0, 2, idxt_off, len(entries), 0xFFFFFFFF, 0xFFFFFFFF, 0, 0)

    # Meta record with TAGX
    tagx = bytearray(b"TAGX")
    # 4 tags + end tag (5 * 4 = 20 bytes), total length = 12 + 20 = 32
    tagx.extend(struct.pack(">II", 32, 1))
    tagx.extend(bytes([1, 1, 0x01, 0]))  # offset
    tagx.extend(bytes([2, 1, 0x02, 0]))  # length
    tagx.extend(bytes([3, 1, 0x04, 0]))  # cncx label
    tagx.extend(bytes([4, 1, 0x08, 0]))  # depth
    tagx.extend(bytes([0, 0, 0, 1]))     # end of control byte

    meta = bytearray(192)
    meta.extend(tagx)
    idxt_entry_off = len(meta)
    meta.append(len(last_key))
    meta.extend(last_key)
    meta.extend(struct.pack(">H", len(entries)))
    if len(meta) % 2:
        meta.append(0)
    meta_idxt_off = len(meta)
    meta.extend(b"IDXT")
    meta.extend(struct.pack(">H", idxt_entry_off))
    while len(meta) % 4:
        meta.append(0)
    meta[0:4] = b"INDX"
    struct.pack_into(">IIIIIIIIIII", meta, 4, 192, 0, 0, 0, meta_idxt_off, 1, 65001, 0xFFFFFFFF, len(entries), 0, 0)
    struct.pack_into(">I", meta, 52, 1)  # cncx_count = 1

    return [bytes(meta), bytes(entry_buf), bytes(cncx)]


def build_header_record(
    *,
    compression: int,
    text_length: int,
    text_record_count: int,
    title: str,
    file_version: int = 6,
    header_length: int = 232,
    text_encoding: int = 65001,
    locale: int = 0x0409,
    encryption: int = 0,
    first_image_index: int = 0xFFFFFFFF,
    first_non_book_index: int = 0xFFFFFFFF,
    extra_data_flags: int = 0,
    indx_record: int = 0xFFFFFFFF,
    fcis_record: int = 0xFFFFFFFF,
    flis_record: int = 0xFFFFFFFF,
    huff_offset: int = 0,
    huff_count: int = 0,
    drm_offset: int = 0xFFFFFFFF,
    drm_count: int = 0,
    drm_size: int = 0,
    drm_flags: int = 0,
    first_content_or_fdst: int = 1,
    last_content_or_fdst_cnt: int = 0xFFFFFFFF,
    frag_record: int = 0xFFFFFFFF,
    skel_record: int = 0xFFFFFFFF,
    guide_record: int = 0xFFFFFFFF,
    exth_entries: list[tuple[int, bytes]] | None = None,
) -> bytes:
    buf = bytearray(16 + header_length)
    struct.pack_into(
        ">HHIHHHH",
        buf,
        0,
        compression,
        0,
        text_length,
        text_record_count,
        4096,
        encryption,
        0,
    )
    buf[16:20] = b"MOBI"
    struct.pack_into(">IIIII", buf, 20, header_length, 2, text_encoding, 0x12345678, file_version)
    for off in range(40, 80, 4):
        struct.pack_into(">I", buf, off, 0xFFFFFFFF)
    struct.pack_into(">I", buf, 80, first_non_book_index)
    struct.pack_into(">I", buf, 92, locale)
    struct.pack_into(">II", buf, 104, file_version, first_image_index)
    struct.pack_into(">II", buf, 112, huff_offset, huff_count)
    struct.pack_into(">I", buf, 128, 0x50 if exth_entries else 0x00)
    struct.pack_into(">IIII", buf, 168, drm_offset, drm_count, drm_size, drm_flags)
    struct.pack_into(">II", buf, 192, first_content_or_fdst, last_content_or_fdst_cnt)
    struct.pack_into(">IIII", buf, 200, fcis_record, 1 if fcis_record != 0xFFFFFFFF else 0, flis_record, 1 if flis_record != 0xFFFFFFFF else 0)
    if header_length >= 232:
        struct.pack_into(">II", buf, 240, extra_data_flags, indx_record)
    if header_length >= 264:
        struct.pack_into(">IIII", buf, 248, frag_record, skel_record, 0xFFFFFFFF, guide_record)

    if exth_entries:
        buf.extend(build_exth(exth_entries))

    title_bytes = title.encode("utf-8")
    full_name_offset = len(buf)
    struct.pack_into(">II", buf, 84, full_name_offset, len(title_bytes))
    buf.extend(title_bytes)
    buf.extend(b"\x00\x00")
    while len(buf) % 4:
        buf.append(0)
    return bytes(buf)


def chunk_bytes(data: bytes, chunk_size: int = 4096) -> list[bytes]:
    if not data:
        return [b""]
    return [data[i : i + chunk_size] for i in range(0, len(data), chunk_size)]


def build_simple_mobi7(
    *,
    title: str,
    author: str,
    html: bytes,
    compression: int = 2,
    text_encoding: int = 65001,
    locale: int = 0x0409,
    language: str = "en",
    pictures: list[bytes] | None = None,
    has_cover: bool = False,
    ncx_entries: list[tuple[int, int, str, int]] | None = None,
    encryption: int = 0,
    extra_exth: list[tuple[int, bytes]] | None = None,
) -> bytes:
    chunks = chunk_bytes(html, 4096)
    if compression == 1:
        text_recs = chunks
    elif compression == 2:
        text_recs = [palmdoc_compress(c) for c in chunks]
    else:
        raise ValueError(f"Unsupported compression here: {compression}")

    records: list[bytes] = [b""]  # placeholder for Record 0
    records.extend(text_recs)

    first_non_book = len(records)
    indx_rec = 0xFFFFFFFF
    if ncx_entries:
        indx_rec = len(records)
        records.extend(build_mobi7_ncx_records(ncx_entries))

    pics = pictures or []
    first_img = len(records) if pics else 0xFFFFFFFF
    records.extend(pics)

    flis_rec = len(records)
    records.append(make_flis_record())
    fcis_rec = len(records)
    records.append(make_fcis_record(len(html)))
    records.append(EOF_RECORD)

    exth: list[tuple[int, bytes]] = [
        (100, author.encode("utf-8")),
        (503, title.encode("utf-8")),
    ]
    if language:
        exth.append((524, language.encode("utf-8")))
    if has_cover and pics:
        exth.append((201, struct.pack(">I", 0)))
        if len(pics) >= 2:
            exth.append((202, struct.pack(">I", 1)))
        exth.append((203, struct.pack(">I", 0)))
    if extra_exth:
        exth.extend(extra_exth)

    records[0] = build_header_record(
        compression=compression,
        text_length=len(html),
        text_record_count=len(text_recs),
        title=title,
        file_version=6,
        header_length=232,
        text_encoding=text_encoding,
        locale=locale,
        encryption=encryption,
        first_image_index=first_img,
        first_non_book_index=first_non_book,
        extra_data_flags=0,
        indx_record=indx_rec,
        fcis_record=fcis_rec,
        flis_record=flis_rec,
        first_content_or_fdst=1,
        last_content_or_fdst_cnt=(first_img + len(pics) - 1) if pics else len(text_recs),
        drm_offset=0 if encryption else 0xFFFFFFFF,
        drm_count=1 if encryption else 0,
        drm_size=16 if encryption else 0,
        exth_entries=exth,
    )
    return build_palmdb(title[:31], records)


def build_huffcdic_records(payload: bytes, *, recursive_loop: bool = False) -> tuple[list[bytes], bytes, bytes]:
    """Construct a minimal, genuine HUFF + CDIC dictionary and compressed stream.

    Uses fixed 8-bit codes:
      - 0..254 -> direct 1-byte terminal literals (except 0x5A = 'Z' which is non-terminal
        expanding to two terminal codes 'A', 'B' in non-loop mode, or recursively to itself in
        recursive_loop mode to test the depth <= 32 safety guard).
      - In normal mode, every input byte b (0..255) is mapped via a 9-bit fixed-width code
        where codes 0..255 map to terminal single bytes, and code 256 maps to a non-terminal
        2-byte sequence 'AB' (demonstrating real recursive CDIC symbol expansion!).
    """
    # Fixed 9-bit codes: code_length = 9, symbols 0..256 (257 symbols).
    # HUFF table1 (256 entries, indexed by top 8 bits of 32-bit word):
    #   All entries have codelen=9, term=0 (not cached in table1 -> forces table2 lookup!).
    #   Wait: even simpler and strictly conforming to standard Mobipocket HuffCDIC:
    #   In standard HUFF:
    #     entry = table1[top8]
    #     codelen = entry & 0x1F
    #     term = entry & 0x80
    #     maxcode = entry >> 8
    #     if term == 0:
    #         while code < mincode[codelen]: codelen += 1
    #         maxcode = maxcode_table[codelen]
    #     slice_index = (maxcode - code) >> (32 - codelen)
    #   With 9-bit codes 0..511:
    #     For any 32-bit word x, top9 = x >> 23 in [0..511].
    #     If we set table1[i] = 9 (term=0, codelen=9, maxcode=0) for all i:
    #       mincode[9] = 0 << 23 = 0
    #       maxcode[9] = ((511 + 1) << 23) - 1 = 0xFFFFFFFF
    #       Wait: in Mobipocket HUFF, dict_index = (maxcode[codelen] - word) >> (32 - codelen)
    #       So dict_index = 511 - top9 -> top9 = 511 - dict_index!
    code_len = 9
    table1 = [code_len] * 256  # term=0, codelen=9
    # table2 has 64 uint32s: 32 pairs of (mincode_raw, maxcode_raw) for codelen 1..32
    # Standard reader shifts mincode[L] = raw_min << (32 - L), maxcode[L] = ((raw_max + 1) << (32 - L)) - 1
    table2: list[int] = []
    for L in range(1, 33):
        if L == code_len:
            table2.extend([0, 511])
        else:
            # Never match lengths != 9 (min > max, or min = 0xFFFFFFFF)
            table2.extend([0xFFFFFFFF, 0])

    # HUFF record layout:
    # 0..3 "HUFF", 4..7 header_len (24), 8..11 offset1 (24), 12..15 offset2 (24 + 256*4 = 1048),
    # 16..23 zeros, then table1 (256 u32), then table2 (64 u32).
    huff = bytearray()
    huff.extend(b"HUFF")
    huff.extend(struct.pack(">IIIII", 24, 24, 24 + 256 * 4, 0, 0))
    for v in table1:
        huff.extend(struct.pack(">I", v))
    for v in table2:
        huff.extend(struct.pack(">I", v))

    # Build CDIC with 512 entries (index 0..511):
    # - 0..255: terminal 1-byte literal bytes([idx])
    # - 256: non-terminal symbol expanding to codes for b"Chapter" (7 codes of 9 bits) or self-loop
    # - 257..511: terminal 1-byte literal b" "
    def encode_symbols(sym_indices: list[int]) -> bytes:
        bits = 0
        nbits = 0
        out = bytearray()
        for sym in sym_indices:
            code9 = 511 - sym
            bits = (bits << 9) | code9
            nbits += 9
            while nbits >= 8:
                nbits -= 8
                out.append((bits >> nbits) & 0xFF)
        if nbits:
            out.append((bits << (8 - nbits)) & 0xFF)
        return bytes(out)

    cdic_entries: list[tuple[bool, bytes]] = []
    for b in range(256):
        cdic_entries.append((True, bytes([b])))
    if recursive_loop:
        # Non-terminal symbol 256 points straight back to symbol 256 -> infinite recursion!
        cdic_entries.append((False, encode_symbols([256])))
    else:
        # Non-terminal symbol 256 expands to "Chapter" (7 literal 9-bit codes)
        cdic_entries.append((False, encode_symbols(list(b"Chapter"))))
    while len(cdic_entries) < 512:
        cdic_entries.append((True, b" "))

    # CDIC record layout:
    # 0..3 "CDIC", 4..7 header_len (16), 8..11 phrases_count (512), 12..15 code_length (9)
    # 16..16+512*2: uint16 offsets relative to byte 16
    # entries: uint16 (len | (0x8000 if terminal else 0)) + payload
    # Wait: in Mobipocket CDIC, flag bit 0x8000 = 1 means terminal (literal bytes),
    # 0 means non-terminal (bitstream of further Huffman codes to decode recursively!).
    data_start = len(cdic_entries) * 2
    offsets: list[int] = []
    blob = bytearray()
    for is_term, sym_bytes in cdic_entries:
        offsets.append(data_start + len(blob))
        flag_len = len(sym_bytes) | (0x8000 if is_term else 0)
        blob.extend(struct.pack(">H", flag_len))
        blob.extend(sym_bytes)

    cdic = bytearray()
    cdic.extend(b"CDIC")
    cdic.extend(struct.pack(">III", 16, len(cdic_entries), code_len))
    for off in offsets:
        cdic.extend(struct.pack(">H", off))
    cdic.extend(blob)

    # Compress payload into 9-bit codes, substituting b"Chapter" with non-terminal symbol 256!
    if recursive_loop:
        stream = encode_symbols([256])
        return [stream], bytes(huff), bytes(cdic)

    syms: list[int] = []
    i = 0
    while i < len(payload):
        if payload[i : i + 7] == b"Chapter":
            syms.append(256)
            i += 7
        else:
            syms.append(payload[i])
            i += 1
    # Note: 9-bit chunks can be split cleanly per ~3000 symbols (< 4096 uncompressed bytes)
    text_recs: list[bytes] = []
    pos = 0
    while pos < len(syms):
        chunk_syms = syms[pos : pos + 3000]
        text_recs.append(encode_symbols(chunk_syms))
        pos += 3000
    return text_recs or [b""], bytes(huff), bytes(cdic)


def build_huffcdic_mobi(title: str, author: str, html: bytes, *, recursive_loop: bool = False) -> bytes:
    text_recs, huff_rec, cdic_rec = build_huffcdic_records(html, recursive_loop=recursive_loop)
    records: list[bytes] = [b""]
    records.extend(text_recs)
    first_non_book = len(records)
    huff_offset = len(records)
    records.append(huff_rec)
    records.append(cdic_rec)
    flis_rec = len(records)
    records.append(make_flis_record())
    fcis_rec = len(records)
    records.append(make_fcis_record(len(html)))
    records.append(EOF_RECORD)
    exth = [
        (100, author.encode("utf-8")),
        (503, title.encode("utf-8")),
        (524, b"en"),
    ]
    records[0] = build_header_record(
        compression=17480,
        text_length=len(html),
        text_record_count=len(text_recs),
        title=title,
        file_version=6,
        header_length=232,
        text_encoding=65001,
        locale=0x0409,
        first_non_book_index=first_non_book,
        huff_offset=huff_offset,
        huff_count=2,
        fcis_record=fcis_rec,
        flis_record=flis_rec,
        last_content_or_fdst_cnt=len(text_recs),
        exth_entries=exth,
    )
    return build_palmdb(title[:31], records)


def build_kf8_part_records(
    *,
    title: str,
    author: str,
    xhtml: bytes,
    css: bytes,
    pictures: list[bytes],
    shared_pic_count: int | None = None,
    has_cover: bool = False,
) -> list[bytes]:
    """Build a standalone or joint KF8 record sequence (starting with KF8 header record)."""
    stream = xhtml + css
    chunks = chunk_bytes(stream, 4096)
    text_recs = [palmdoc_compress(c) for c in chunks]

    recs: list[bytes] = [b""]  # KF8 header record (relative index 0)
    recs.extend(text_recs)

    first_non_book = len(recs)
    # FDST record: 2 flows (flow 0 = XHTML, flow 1 = CSS)
    fdst_idx = len(recs)
    fdst = b"FDST" + struct.pack(">IIIIII", 12, 2, 0, len(xhtml), len(xhtml), len(stream))
    recs.append(fdst)

    # Standalone KF8 places its own pictures right after FDST; joint KF8 shares MOBI 7's pool
    if shared_pic_count is None:
        first_img = len(recs) if pictures else 0xFFFFFFFF
        recs.extend(pictures)
        pic_count = len(pictures)
    else:
        first_img = fdst_idx
        pic_count = shared_pic_count

    flis_idx = len(recs)
    recs.append(make_flis_record())
    fcis_idx = len(recs)
    recs.append(make_fcis_record(len(stream)))

    exth: list[tuple[int, bytes]] = [
        (100, author.encode("utf-8")),
        (125, struct.pack(">I", pic_count)),
        (131, struct.pack(">I", 0)),
        (503, title.encode("utf-8")),
        (524, b"en"),
    ]
    if has_cover and pic_count >= 1:
        exth.append((201, struct.pack(">I", 0)))
        if pic_count >= 2:
            exth.append((202, struct.pack(">I", 1)))
        exth.append((203, struct.pack(">I", 0)))

    recs[0] = build_header_record(
        compression=2,
        text_length=len(stream),
        text_record_count=len(text_recs),
        title=title,
        file_version=8,
        header_length=264,
        text_encoding=65001,
        locale=0x0409,
        first_image_index=first_img,
        first_non_book_index=first_non_book,
        extra_data_flags=0,
        indx_record=0xFFFFFFFF,
        fcis_record=fcis_idx,
        flis_record=flis_idx,
        first_content_or_fdst=fdst_idx,
        last_content_or_fdst_cnt=2,
        exth_entries=exth,
    )
    return recs


def build_joint_mobi(
    *,
    title: str,
    author: str,
    mobi7_html: bytes,
    kf8_xhtml: bytes,
    kf8_css: bytes,
    pictures: list[bytes],
    damage_kf8: bool = False,
) -> bytes:
    m7_chunks = [palmdoc_compress(c) for c in chunk_bytes(mobi7_html, 4096)]
    kf8_recs = build_kf8_part_records(
        title=title,
        author=author,
        xhtml=kf8_xhtml,
        css=kf8_css,
        pictures=[],
        shared_pic_count=len(pictures),
        has_cover=bool(pictures),
    )
    if damage_kf8:
        # Corrupt the KF8 text record with invalid LZ77 back-reference (distance = 2000 > output)
        kf8_recs[1] = b"\xBF\xF8\xFF\xFF\x80\x00"

    records: list[bytes] = [b""]
    records.extend(m7_chunks)
    first_non_book = len(records)
    first_img = len(records) if pictures else 0xFFFFFFFF
    records.extend(pictures)
    flis_rec = len(records)
    records.append(make_flis_record())
    fcis_rec = len(records)
    records.append(make_fcis_record(len(mobi7_html)))
    records.append(b"BOUNDARY")
    kf8_header_abs = len(records)
    records.extend(kf8_recs)
    records.append(EOF_RECORD)

    exth = [
        (100, author.encode("utf-8")),
        (121, struct.pack(">I", kf8_header_abs)),
        (125, struct.pack(">I", len(pictures))),
        (503, title.encode("utf-8")),
        (524, b"en"),
    ]
    if pictures:
        exth.append((201, struct.pack(">I", 0)))
        if len(pictures) >= 2:
            exth.append((202, struct.pack(">I", 1)))
        exth.append((203, struct.pack(">I", 0)))

    records[0] = build_header_record(
        compression=2,
        text_length=len(mobi7_html),
        text_record_count=len(m7_chunks),
        title=title,
        file_version=6,
        header_length=264,
        text_encoding=65001,
        locale=0x0409,
        first_image_index=first_img,
        first_non_book_index=first_non_book,
        fcis_record=fcis_rec,
        flis_record=flis_rec,
        last_content_or_fdst_cnt=(first_img + len(pictures) - 1) if pictures else len(m7_chunks),
        exth_entries=exth,
    )
    return build_palmdb(title[:31], records)


def build_palmdoc_prc(title: str, text: str) -> bytes:
    raw = text.encode("utf-8")
    chunks = [palmdoc_compress(c) for c in chunk_bytes(raw, 4096)]
    rec0 = struct.pack(">HHIHHI", 2, 0, len(raw), len(chunks), 4096, 0)
    return build_palmdb(title[:31], [rec0] + chunks, db_type=b"TEXt", creator=b"REAd")


def write_valid_fixtures(out_dir: Path) -> list[Path]:
    written: list[Path] = []
    pic_cover = TINY_JPEG
    pic_thumb = TINY_JPEG
    pic_inline = make_png_1x1((40, 140, 80))

    def save(name: str, data: bytes) -> None:
        p = out_dir / name
        p.write_bytes(data)
        written.append(p)

    # 1. MOBI 7 uncompressed UTF-8 with cover, thumbnail, inline image, table, note, NCX
    ch1_marker = "<h2>Chapter One</h2>"
    ch2_marker = "<h2>Chapter Two</h2>"
    m7_html_str = (
        "<html><head><title>Uncompressed Sample</title></head><body>"
        "<h1>Uncompressed Sample</h1><p>By Jane Author</p><mbp:pagebreak/>"
        f"{ch1_marker}"
        "<p>First paragraph with <b>bold</b>, <i>italic</i>, and a note"
        '<sup><a href="#note1">[1]</a></sup>.</p>'
        '<p><img recindex="00003" alt="Inline chart"/></p>'
        "<table><tr><th>Item</th><th>Value</th></tr><tr><td>Alpha</td><td>42</td></tr></table>"
        "<mbp:pagebreak/>"
        f"{ch2_marker}"
        "<p>Second chapter prose repeating enough words to test reading order cleanly.</p>"
        "<mbp:pagebreak/>"
        '<h2>Notes</h2><p id="note1"><a name="note1">[1]</a> Explanatory footnote text.</p>'
        "</body></html>"
    )
    m7_bytes = m7_html_str.encode("utf-8")
    off1 = m7_bytes.index(ch1_marker.encode("utf-8"))
    off2 = m7_bytes.index(ch2_marker.encode("utf-8"))
    save(
        "mobi7-uncompressed.mobi",
        build_simple_mobi7(
            title="Uncompressed Sample",
            author="Jane Author",
            html=m7_bytes,
            compression=1,
            pictures=[pic_cover, pic_thumb, pic_inline],
            has_cover=True,
            ncx_entries=[
                (off1, off2 - off1, "Chapter One", 0),
                (off2, len(m7_bytes) - off2, "Chapter Two", 0),
            ],
        ),
    )

    # 2. MOBI 7 PalmDOC compressed UTF-8 (sufficient prose for <= 80% ratio)
    prose_para = (
        "<p>The quick brown fox jumps over the lazy dog while the gentle river flows "
        "through the quiet valley under a bright autumn sky. </p>"
    )
    pd_html = (
        "<html><body><h1>PalmDOC Prose Book</h1><mbp:pagebreak/>"
        "<h2>Part I</h2>" + (prose_para * 24) + "<mbp:pagebreak/>"
        "<h2>Part II</h2>" + (prose_para * 24) + "</body></html>"
    ).encode("utf-8")
    p1 = pd_html.index(b"<h2>Part I</h2>")
    p2 = pd_html.index(b"<h2>Part II</h2>")
    save(
        "mobi7-palmdoc.mobi",
        build_simple_mobi7(
            title="PalmDOC Prose Book",
            author="Alex Writer",
            html=pd_html,
            compression=2,
            ncx_entries=[(p1, p2 - p1, "Part I", 0), (p2, len(pd_html) - p2, "Part II", 0)],
        ),
    )

    # 3. MOBI 7 HuffCDIC UTF-8 (with real non-terminal recursive symbol expansion)
    huff_html = (
        "<html><body><h1>HuffCDIC Book</h1>"
        "<h2>Chapter 1</h2><p>Chapter text decoded through HUFF and CDIC tables.</p>"
        "<h2>Chapter 2</h2><p>Chapter two verifies multi-symbol non-terminal expansion.</p>"
        "</body></html>"
    ).encode("utf-8")
    save("mobi7-huffcdic.mobi", build_huffcdic_mobi("HuffCDIC Book", "Huff Author", huff_html))

    # 4. MOBI 7 Windows-1252 (with smart quotes, em-dash, accented letters)
    cp1252_html = (
        "<html><body><h1>Caf\u00e9 \u2014 \u201cBonjour\u201d</h1>"
        "<p>Na\u00efve r\u00e9sum\u00e9 costs \u20ac12\u201315.</p></body></html>"
    ).encode("cp1252")
    save(
        "mobi7-cp1252.mobi",
        build_simple_mobi7(
            title="Cafe Bonjour",
            author="René Author",
            html=cp1252_html,
            compression=2,
            text_encoding=1252,
            locale=0x040C,
            language="fr",
        ),
    )

    # 5 & 6. Joint MOBI 7 + KF8 (healthy + damaged-KF8 fallback)
    joint_m7 = (
        "<html><body><h1>Joint Book</h1><h2>Chapter One</h2>"
        "<p>Fallback MOBI 7 text for joint container.</p>"
        '<p><img recindex="00001" alt="Cover"/></p></body></html>'
    ).encode("utf-8")
    joint_kf8 = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Joint Book</title></head><body>'
        '<h1>Joint Book</h1><h2>Chapter One</h2>'
        '<p class="lead">Rich KF8 text preferred when intact.</p>'
        '<p><img src="kindle:embed:0001?mime=image/jpeg" alt="Cover"/></p></body></html>'
    ).encode("utf-8")
    joint_css = b"p.lead { font-style: italic; text-indent: 1.5em; }\n"
    save(
        "joint-valid.mobi",
        build_joint_mobi(
            title="Joint Book",
            author="Dual Author",
            mobi7_html=joint_m7,
            kf8_xhtml=joint_kf8,
            kf8_css=joint_css,
            pictures=[pic_cover, pic_thumb],
            damage_kf8=False,
        ),
    )
    save(
        "joint-damaged-kf8.mobi",
        build_joint_mobi(
            title="Joint Damaged KF8",
            author="Dual Author",
            mobi7_html=joint_m7,
            kf8_xhtml=joint_kf8,
            kf8_css=joint_css,
            pictures=[pic_cover, pic_thumb],
            damage_kf8=True,
        ),
    )

    # 7. KF8-only (.azw3) with CSS, SVG-framed cover, vector SVG, MathML, pop-up footnote
    kf8_rich = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
        "<head><title>KF8 Rich Edition</title></head><body>"
        '<div class="cover"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150">'
        '<image width="100" height="150" href="kindle:embed:0001?mime=image/jpeg"/></svg></div>'
        "<h1>KF8 Rich Edition</h1>"
        "<h2>Visuals and Math</h2>"
        '<p class="callout">Styled KF8 paragraph with footnote '
        '<a epub:type="noteref" href="#fn1" id="ref1">1</a>.</p>'
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40">'
        '<rect x="2" y="2" width="76" height="36" fill="#2266aa"/><circle cx="40" cy="20" r="10" fill="#ffffff"/></svg>'
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></math>'
        '<aside epub:type="footnote" id="fn1"><p>KF8 pop-up footnote body. <a href="#ref1">Back</a></p></aside>'
        "</body></html>"
    ).encode("utf-8")
    kf8_rich_css = b".callout { font-weight: bold; text-align: center; }\n"
    kf8_recs = build_kf8_part_records(
        title="KF8 Rich Edition",
        author="Modern Author",
        xhtml=kf8_rich,
        css=kf8_rich_css,
        pictures=[pic_cover, pic_thumb],
        has_cover=True,
    )
    kf8_recs.append(EOF_RECORD)
    save("kf8-rich.azw3", build_palmdb("KF8_Rich_Edition", kf8_recs))

    # 8. Plain PalmDOC (.prc)
    save(
        "palmdoc-plain.prc",
        build_palmdoc_prc(
            "Plain PalmDOC",
            "First plain PalmDOC paragraph.\n\nSecond paragraph with simple prose.\n\nThird paragraph.",
        ),
    )

    # 9, 10, 11. Third-party FB2 converter samples (Calibre, fb2converter, maxlibmobi)
    calibre_html = (
        '<html><body><h1 class="calibre1">Calibre Converted</h1>'
        '<div class="calibre2"><p class="calibre3">Calibre styled paragraph.</p></div>'
        "</body></html>"
    ).encode("utf-8")
    save(
        "converter-calibre.mobi",
        build_simple_mobi7(
            title="Calibre Converted",
            author="Calibre Author",
            html=calibre_html,
            extra_exth=[(105, b"sci-fi"), (108, b"calibre (9.16.0)")],
        ),
    )

    fb2c_html = (
        '<html><body><div class="title1"><p>FB2Converter Title</p></div>'
        '<div class="epigraph"><p>An epigraph quote.</p><p class="text-author">Sage</p></div>'
        '<div class="poem"><div class="stanza"><p class="v">First verse line</p>'
        '<p class="v">Second verse line</p></div></div>'
        '<div class="cite"><p>A cited block.</p></div></body></html>'
    ).encode("utf-8")
    save(
        "converter-fb2converter.mobi",
        build_simple_mobi7(
            title="FB2Converter Sample",
            author="Converter Author",
            html=fb2c_html,
            extra_exth=[(108, b"fb2converter")],
        ),
    )

    maxlib_html = (
        '<html><body><div class="fb2-section"><div class="fb2-title"><p>Maxlibmobi Chapter</p></div>'
        '<div class="fb2-epigraph"><p>Maxlib epigraph.</p><p class="fb2-text-author">Poet</p></div>'
        '<div class="fb2-subtitle"><p>Subhead</p></div>'
        "<p>Main paragraph from maxlibmobi.</p></div></body></html>"
    ).encode("utf-8")
    save(
        "converter-maxlibmobi.mobi",
        build_simple_mobi7(
            title="Maxlibmobi Sample",
            author="Max Author",
            html=maxlib_html,
            extra_exth=[(108, b"maxlibmobi")],
        ),
    )

    # 12 & 13. Encrypted / DRM MOBI and AZW3
    save(
        "drm-encrypted.mobi",
        build_simple_mobi7(
            title="Locked Book",
            author="DRM Publisher",
            html=b"<html><body><p>Locked</p></body></html>",
            encryption=2,
        ),
    )
    drm_kf8 = build_kf8_part_records(
        title="Locked KF8",
        author="DRM Publisher",
        xhtml=b"<html><body><p>Locked</p></body></html>",
        css=b"",
        pictures=[],
    )
    # Patch encryption=2 at bytes 12..13 of KF8 header record
    hdr = bytearray(drm_kf8[0])
    struct.pack_into(">H", hdr, 12, 2)
    drm_kf8[0] = bytes(hdr)
    drm_kf8.append(EOF_RECORD)
    save("drm-encrypted.azw3", build_palmdb("Locked_KF8", drm_kf8))

    # 14 & 15. KFX magic (.kfx and renamed .mobi)
    kfx_bytes = b"\xEA" + b"DRMION" + b"\x00\x01\x02\x03" + b"CONT" + b"\x00" * 64
    save("kfx-book.kfx", kfx_bytes)
    save("kfx-renamed.mobi", kfx_bytes)

    # 16. Valid FB2 XML renamed to .mobi (for All files refusal check)
    fb2_xml = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">'
        "<description><title-info><genre>prose</genre><author><last-name>Test</last-name></author>"
        "<book-title>Actually FB2</book-title><lang>en</lang></title-info></description>"
        "<body><section><p>Hello FB2.</p></section></body></FictionBook>"
    ).encode("utf-8")
    save("fb2-renamed.mobi", fb2_xml)

    return written


def write_hostile_fixtures(out_dir: Path, include_oversized: bool = True) -> list[Path]:
    written: list[Path] = []

    def save(name: str, data: bytes) -> None:
        p = out_dir / name
        p.write_bytes(data)
        written.append(p)

    # 1. Truncated PalmDB header (< 78 bytes)
    save("hostile-truncated-header.mobi", b"TruncatedPalmDB" + b"\x00" * 25)

    # 2. Out-of-bounds record offset past EOF
    bad_pdb = bytearray(build_simple_mobi7(title="OOB", author="X", html=b"<html><body>ok</body></html>"))
    struct.pack_into(">I", bad_pdb, 78 + 8, 0x0FFFFFF0)
    save("hostile-oob-offset.mobi", bytes(bad_pdb))

    # 3. Record table declaring 65,535 records inside a tiny file
    tiny_many = bytearray(78 + 16)
    tiny_many[0:8] = b"ManyRecs"
    tiny_many[60:64] = b"BOOK"
    tiny_many[64:68] = b"MOBI"
    struct.pack_into(">H", tiny_many, 76, 65535)
    save("hostile-too-many-records.mobi", bytes(tiny_many))

    # 4. PalmDOC decompression bomb (small compressed payload expanding > 100x / > 2 MB)
    # 10 literal 'A's followed by ~2200 back-references of (dist=1, len=10) -> ~22,000 bytes per record * 80 recs = 1.76 MB from ~360 KB...
    # Even tighter: 1 literal 'A' + 409 back-refs (dist=1, len=10) = 819 bytes -> 4091 bytes (~5x),
    # or 1 record with 20,000 back-refs (dist=1, len=10) = 40 KB compressed -> 200 KB;
    # Wait: PalmDOC 2-byte token produces 10 bytes -> 5x per token, OR to trigger > 100x OR > 256 MB:
    # Actually 2-byte LZ77 token expands 2 bytes -> 10 bytes (5x max per record). What triggers > 256 MB?
    # Many records or a single record claiming huge expansion? With 2 bytes -> 10 bytes, 1000 copies of a 40 KB
    # record? No, HuffCDIC can expand exponentially (depth 20 doubles every level = 2^20 = 1,048,576x)!
    # Let's build a genuine HuffCDIC exponential bomb (depth 18: 2^18 = 262,144 bytes from 2 bytes -> > 100x!).
    # Build HUFF + CDIC where symbol 256 = [257, 257], 257 = [258, 258], ..., 275 = [65, 65] ('A','A') -> 2^20 = 1 MB from 2 bytes!
    code_len = 9
    table1 = [code_len] * 256
    table2: list[int] = []
    for L in range(1, 33):
        table2.extend([0, 511] if L == code_len else [0xFFFFFFFF, 0])
    huff = b"HUFF" + struct.pack(">IIIII", 24, 24, 24 + 256 * 4, 0, 0)
    huff += b"".join(struct.pack(">I", v) for v in table1)
    huff += b"".join(struct.pack(">I", v) for v in table2)

    def enc9(syms: list[int]) -> bytes:
        bits = 0
        nbits = 0
        out = bytearray()
        for sym in syms:
            bits = (bits << 9) | (511 - sym)
            nbits += 9
            while nbits >= 8:
                nbits -= 8
                out.append((bits >> nbits) & 0xFF)
        if nbits:
            out.append((bits << (8 - nbits)) & 0xFF)
        return bytes(out)

    cdic_entries: list[tuple[bool, bytes]] = [(True, bytes([b])) for b in range(256)]
    for lvl in range(21):
        nxt = 256 + lvl + 1 if lvl < 20 else ord("A")
        cdic_entries.append((False, enc9([nxt, nxt])))
    while len(cdic_entries) < 512:
        cdic_entries.append((True, b" "))
    data_start = len(cdic_entries) * 2
    offs: list[int] = []
    blob = bytearray()
    for is_term, sb in cdic_entries:
        offs.append(data_start + len(blob))
        blob.extend(struct.pack(">H", len(sb) | (0x8000 if is_term else 0)))
        blob.extend(sb)
    cdic = b"CDIC" + struct.pack(">III", 16, len(cdic_entries), code_len)
    cdic += b"".join(struct.pack(">H", o) for o in offs) + bytes(blob)
    bomb_text = enc9([256, 256])  # 3 bytes -> 2 * 2^21 = 4,194,304 bytes (> 1,000,000x ratio!)
    bomb_recs = [b"", bomb_text, huff, cdic, make_flis_record(), make_fcis_record(4_194_304), EOF_RECORD]
    bomb_recs[0] = build_header_record(
        compression=17480,
        text_length=4_194_304,
        text_record_count=1,
        title="Bomb",
        first_non_book_index=2,
        huff_offset=2,
        huff_count=2,
        flis_record=4,
        fcis_record=5,
        exth_entries=[(100, b"Hostile"), (503, b"Bomb")],
    )
    save("hostile-decomp-bomb.mobi", build_palmdb("Bomb", bomb_recs))

    # 5. HuffCDIC infinite recursion loop (exceeds depth <= 32)
    save("hostile-huff-loop.mobi", build_huffcdic_mobi("Huff Loop", "Hostile", b"<html></html>", recursive_loop=True))

    # 6. > 100 MP image (tiny PNG header declaring 12000 x 12000 = 144 MP)
    huge_png = make_png_1x1((10, 20, 30), width=12000, height=12000)
    save(
        "hostile-huge-image.mobi",
        build_simple_mobi7(
            title="Huge Image",
            author="Hostile",
            html=b'<html><body><h1>Huge</h1><p><img recindex="00001" alt="Huge"/></p></body></html>',
            pictures=[huge_png],
        ),
    )

    # 7. Deep nesting (500 nested divs)
    deep_html = (
        "<html><body><h1>Deep Nesting</h1>"
        + ("<div>" * 500)
        + "<p>Deeply nested text survives.</p>"
        + ("</div>" * 500)
        + "</body></html>"
    ).encode("utf-8")
    save("hostile-deep-nesting.mobi", build_simple_mobi7(title="Deep Nesting", author="Hostile", html=deep_html))

    # 8. Scripts, event handlers, iframes, remote URLs
    script_html = (
        '<html><head><link rel="stylesheet" href="https://evil.invalid/s.css"/>'
        "<script>window.__MFBE_XSS__ = true;</script></head>"
        '<body onload="window.__MFBE_XSS__ = true;">'
        '<h1>Hostile Scripts</h1>'
        '<p onclick="window.__MFBE_XSS__ = true;">Safe visible paragraph.</p>'
        '<iframe src="https://evil.invalid/frame"></iframe>'
        '<img src="https://evil.invalid/pixel.png" alt="tracker"/>'
        '<a href="javascript:window.__MFBE_XSS__=true">Bad link</a>'
        "</body></html>"
    ).encode("utf-8")
    save("hostile-scripts-remote.mobi", build_simple_mobi7(title="Hostile Scripts", author="Hostile", html=script_html))

    # 9. Random non-MOBI bytes renamed .mobi
    pseudo_random = bytes((i * 73 + 19) & 0xFF for i in range(4096))
    save("hostile-random.mobi", pseudo_random)

    # 10. > 150 MB sparse file (151 MB)
    if include_oversized:
        big_path = out_dir / "hostile-oversized.mobi"
        base = build_simple_mobi7(title="Oversized", author="Hostile", html=b"<html><body><p>Big</p></body></html>")
        with big_path.open("wb") as f:
            f.write(base)
            f.seek(151 * 1024 * 1024 - 1)
            f.write(b"\x00")
        written.append(big_path)

    return written


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate MOBI/KF8 test fixtures for feature 018.")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent / "generated",
        help="Output directory for generated fixture files.",
    )
    parser.add_argument(
        "--hostile",
        action="store_true",
        help="Also generate hostile/malformed/oversized fixtures.",
    )
    parser.add_argument(
        "--no-oversized",
        action="store_true",
        help="Skip creating the 151 MB hostile-oversized.mobi file.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    args.out.mkdir(parents=True, exist_ok=True)
    files = write_valid_fixtures(args.out)
    if args.hostile:
        files.extend(write_hostile_fixtures(args.out, include_oversized=not args.no_oversized))
    print(f"Generated {len(files)} fixture(s) in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

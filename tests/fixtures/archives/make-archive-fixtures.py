#!/usr/bin/env python3
"""Writes the ZIP archive fixtures of feature 009 (books in ZIP archives, research DP-21).

The archives are small and committed; this script regenerates them byte for byte (fixed
timestamps), and is run only when a fixture must change. The big archives - the expanding
"bomb", the 70,000-entry ZIP64 archive and the 1,000-book archive - are built by the tests
themselves at run time and are not written here.

Most fixtures go through a raw ZIP writer below, so that each entry's name bytes, flags,
compression method and payload are exactly what the tests need (legacy code-page names without
the UTF-8 flag, an encryption flag, an unknown method, a wrong CRC). zstd entries need the
`zstd` command; PPMd entries cannot be made here (no 7-Zip) and are not part of the set.

Usage: python3 tests/fixtures/archives/make-archive-fixtures.py
"""

from __future__ import annotations

import bz2
import gzip
import io
import lzma
import shutil
import struct
import subprocess
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOOKS = HERE.parent / "books"
DOS_TIME = 0  # 00:00:00
DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1  # 2026-01-01
UTF8_FLAG = 0x0800


def book(title: str, lang: str = "ru", paragraph: str = "") -> bytes:
    """A small, valid FictionBook document."""
    text = paragraph or f"The text of {title}."
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" '
        'xmlns:l="http://www.w3.org/1999/xlink">\n'
        "<description><title-info><genre>prose_classic</genre><author><first-name>Test</first-name>"
        f"<last-name>Author</last-name></author><book-title>{title}</book-title>"
        f"<lang>{lang}</lang></title-info><document-info><author><nickname>mfbe</nickname>"
        "</author><date>2026</date><id>mfbe-fixture-" + f"{zlib.crc32(title.encode()):08x}" +
        "</id><version>1.0</version></document-info></description>\n"
        f"<body><section><title><p>{title}</p></title><p>{text}</p></section></body>\n"
        "</FictionBook>\n"
    ).encode("utf-8")


def raw_deflate(data: bytes) -> bytes:
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()


def zstd_frame(data: bytes) -> bytes:
    if shutil.which("zstd") is None:
        raise SystemExit("the zstd command is needed for method-zstd.zip")
    return subprocess.run(["zstd", "-q", "-c", "-19"], input=data, capture_output=True,
                          check=True).stdout


def raw_zip(entries: list[dict]) -> bytes:
    """A ZIP of `entries`: dicts with `name` (bytes), `data` (uncompressed bytes) and optional
    `method` (default 8), `payload` (compressed bytes; computed for 0 and 8), `flags`, `crc`."""
    out = io.BytesIO()
    central = []
    for e in entries:
        name: bytes = e["name"]
        data: bytes = e["data"]
        method = e.get("method", 8)
        payload = e.get("payload")
        if payload is None:
            payload = data if method == 0 else raw_deflate(data)
        flags = e.get("flags", 0)
        crc = e.get("crc", zlib.crc32(data) & 0xFFFFFFFF)
        version = 63 if method in (14, 93, 95, 98) else 20
        offset = out.tell()
        out.write(struct.pack("<IHHHHHIIIHH", 0x04034B50, version, flags, method, DOS_TIME,
                              DOS_DATE, crc, len(payload), len(data), len(name), 0))
        out.write(name)
        out.write(payload)
        central.append(struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 63, version, flags, method,
                                   DOS_TIME, DOS_DATE, crc, len(payload), len(data), len(name),
                                   0, 0, 0, 0, 0o100644 << 16, offset) + name)
    start = out.tell()
    for c in central:
        out.write(c)
    size = out.tell() - start
    out.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries), size, start,
                          0))
    return out.getvalue()


def entry(name: str | bytes, data: bytes, **kw) -> dict:
    if isinstance(name, str):
        raw = name.encode("utf-8")
        if raw != name.encode("ascii", "ignore"):
            kw["flags"] = kw.get("flags", 0) | UTF8_FLAG
        name = raw
    return {"name": name, "data": data, **kw}


def library_zip(method: int, name: str, data: bytes) -> bytes:
    """A one-entry archive written by Python's zipfile (bzip2 and LZMA entries)."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = method
        info.external_attr = 0o100644 << 16
        z.writestr(info, data)
    return out.getvalue()


def main() -> None:
    fixtures: dict[str, bytes] = {}
    modern = (BOOKS / "modern-utf8.fb2").read_bytes()
    fixtures["single.fb2.zip"] = raw_zip([entry("book.fb2", modern)])

    many = []
    for i in range(200):
        folder = f"folder-{i // 20 + 1:02d}"
        many.append(entry(f"{folder}/book-{i + 1:03d}.fb2", book(f"Book {i + 1:03d}")))
    many.append(entry("cover.jpg", b"\xff\xd8\xff\xe0" + b"\0" * 60 + b"\xff\xd9"))
    many.append(entry("readme.txt", b"200 books in 10 folders.\n"))
    fixtures["many-200.zip"] = raw_zip(many)

    fixtures["book-and-fbd.zip"] = raw_zip([
        entry("book.fb2", book("A book")),
        entry("book.fbd", (BOOKS / "descriptor.fbd").read_bytes()),
    ])
    fixtures["same-name-two-folders.zip"] = raw_zip([
        entry("a/book.fb2", book("First of two")),
        entry("b/book.fb2", book("Second of two")),
    ])
    inner = raw_zip([entry("inner.fb2", book("Inside the inner archive"))])
    fixtures["nested.zip"] = raw_zip([
        entry("outer.fb2", book("The outer book")),
        entry("inner.zip", inner, method=0),
    ])
    fixtures["no-book.zip"] = raw_zip([entry("readme.txt", b"No book here.\n")])
    fixtures["dotdot-names.zip"] = raw_zip([entry("../evil.fb2", book("Dot dot"))])
    fixtures["absolute-names.zip"] = raw_zip([entry("/abs/evil.fb2", book("Absolute"))])
    fixtures["12345.zip"] = raw_zip([entry("War and Peace.fb2", book("War and Peace"))])

    # Names in legacy code pages, without the UTF-8 flag (DP-2), two books each.
    cyrillic = ["Война и мир.fb2", "Анна Каренина.fb2"]
    hebrew = ["מלחמה ושלום.fb2", "שירים.fb2"]
    western = ["Café crème.fb2", "Über alles.fb2"]
    for codepage, names in (("cp866", cyrillic), ("cp1251", cyrillic), ("cp862", hebrew),
                            ("cp1255", hebrew), ("cp437", western)):
        fixtures[f"names-{codepage}.zip"] = raw_zip(
            [entry(n.encode(codepage), book(n[:-4])) for n in names])
    fixtures["names-utf8-flag.zip"] = raw_zip([entry(n, book(n[:-4])) for n in cyrillic])
    fixtures["names-utf8-noflag.zip"] = raw_zip(
        [entry(n.encode("utf-8"), book(n[:-4])) for n in cyrillic])

    # Refused: an encryption flag, an undefined method, a truncated archive, a wrong CRC.
    plain = book("Refused")
    fixtures["encrypted.zip"] = raw_zip([entry("book.fb2", plain, method=0, flags=0x0001)])
    fixtures["method-unknown.zip"] = raw_zip([entry("book.fb2", plain, method=77,
                                                    payload=b"\x00" * 64)])
    whole = fixtures["single.fb2.zip"]
    fixtures["truncated.zip"] = whole[: len(whole) * 6 // 10]
    fixtures["crc-bad.zip"] = raw_zip([entry("book.fb2", plain, method=0, crc=0x12345678)])

    # Every other method (DP-3 as revised: all methods libarchive reads are read). The deflate64
    # payload is a plain deflate stream without length-258 matches, which deflate64 reads alike.
    short = book("Methods", paragraph="Каждый метод сжатия читается: " + "".join(
        f"{n} " for n in range(200)))
    fixtures["method-deflate64.zip"] = raw_zip([entry("book.fb2", short, method=9,
                                                      payload=raw_deflate(short))])
    fixtures["method-bzip2.zip"] = library_zip(zipfile.ZIP_BZIP2, "book.fb2", short)
    fixtures["method-lzma.zip"] = library_zip(zipfile.ZIP_LZMA, "book.fb2", short)
    fixtures["method-xz.zip"] = raw_zip([entry("book.fb2", short, method=95,
                                               payload=lzma.compress(short,
                                                                     format=lzma.FORMAT_XZ))])
    fixtures["method-zstd.zip"] = raw_zip([entry("book.fb2", short, method=93,
                                                 payload=zstd_frame(short))])
    assert bz2.decompress(bz2.compress(short)) == short

    # Other archive kinds: their leading bytes (FR-020). The gzip one is a real gzip file.
    fixtures["sample.rar"] = b"Rar!\x1a\x07\x00" + b"\0" * 57
    fixtures["sample.7z"] = b"7z\xbc\xaf\x27\x1c\x00\x04" + b"\0" * 56
    fixtures["sample.gz"] = gzip.compress(plain, mtime=0)

    for name, data in sorted(fixtures.items()):
        (HERE / name).write_bytes(data)
    print(f"wrote {len(fixtures)} fixtures to {HERE}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Writes the FB2 books of feature 014's PDF export into tests/fixtures/pdf/ (tasks T007).

The EPUB export's reference books (tests/fixtures/books/: reference-all-elements, invalid-for-export,
german-book, russian-untitled-notes, pictures-alt, no-pictures, tables) serve the PDF export too;
this script adds what they do not cover:

* notes.fb2: a note longer than an A6 page, a note referred to twice, one never referred to, and a
  reference to a note that does not exist (D18, D19);
* untitled-sections.fb2: sections nested with and without titles, and every block kind the PDF's
  structure merges (the hints of research R10);
* scripts.fb2: Georgian, Armenian, polytonic Greek and Latin with accents (the shipped coverage,
  D7), plus Hebrew words and a Chinese word (drawn with a system font and listed);
* stylesheet-kinds.fb2: a stylesheet that names fonts of each kind (D7, US7 scenario 8).

`--hostile DIR` writes the hostile books of US4 into DIR (too large or too slow to commit): sections
nested 1,000 deep, a table of 10,000 rows, a 20,000 x 20,000 picture, 50,000 notes.

Every book is our own text. The output is deterministic. Run only when a fixture must change.
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import struct
import zlib

HERE = pathlib.Path(__file__).resolve().parent

HEAD = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" '
    'xmlns:l="http://www.w3.org/1999/xlink">\n'
)


def description(title: str, lang: str, book_id: str, genre: str = "sf_fantasy") -> str:
    return (
        "<description>\n<title-info>\n"
        f"<genre>{genre}</genre>\n"
        "<author><first-name>Ivan</first-name><last-name>Testov</last-name></author>\n"
        f"<book-title>{title}</book-title>\n"
        f"<lang>{lang}</lang>\n"
        "</title-info>\n<document-info>\n"
        "<author><nickname>mfbe-tests</nickname></author>\n"
        "<date value=\"2026-11-12\">12 November 2026</date>\n"
        f"<id>{book_id}</id>\n<version>1.0</version>\n"
        "</document-info>\n</description>\n"
    )


def words(seed: int, count: int, vocabulary: list[str]) -> str:
    """Deterministic pseudo-prose from a vocabulary (our own text)."""
    out, state = [], seed
    for _ in range(count):
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        out.append(vocabulary[state % len(vocabulary)])
    return " ".join(out)


RU = ("город река утро письмо дорога окно книга сад вечер голос дом поле лес ветер свет "
      "время море снег мост улица").split()


def notes_book() -> str:
    long_note = "".join(f"<p>{words(i, 120, RU).capitalize()}.</p>" for i in range(1, 9))
    return (
        HEAD + description("Книга примечаний", "ru", "mfbe-pdf-notes-0001")
        + "<body>\n<title><p>Книга примечаний</p></title>\n"
        "<section><title><p>Глава первая</p></title>\n"
        '<p>Первая ссылка ведёт к длинному примечанию<a l:href="#n1" type="note">1</a>, '
        'вторая к короткому<a l:href="#n2" type="note">2</a>.</p>\n'
        f"<p>{words(7, 60, RU).capitalize()}.</p>\n"
        '<p>Короткое примечание названо ещё раз<a l:href="#n2" type="note">2</a>, '
        'а эта ссылка ведёт в никуда<a l:href="#n9" type="note">9</a>.</p>\n'
        "</section>\n</body>\n"
        '<body name="notes">\n<title><p>Примечания</p></title>\n'
        f'<section id="n1"><title><p>1</p></title>{long_note}</section>\n'
        '<section id="n2"><title><p>2</p></title><p>Короткое примечание, на которое ссылаются дважды.</p></section>\n'
        '<section id="n3"><title><p>3</p></title><p>Примечание, на которое никто не ссылается.</p></section>\n'
        "</body>\n</FictionBook>\n"
    )


def untitled_book() -> str:
    return (
        HEAD + description("Untitled sections", "en", "mfbe-pdf-untitled-0001")
        + "<body>\n<title><p>Untitled sections</p></title>\n"
        "<epigraph><p>An epigraph of the body.</p><text-author>Someone</text-author></epigraph>\n"
        "<section>\n"
        "<section><title><p>A titled section inside</p></title>\n"
        "<annotation><p>The section's annotation.</p></annotation>\n"
        "<p>Text of the titled inner section.</p>\n</section>\n"
        "<section><p>An untitled section inside an untitled one.</p>\n"
        "<poem><title><p>A poem</p></title><epigraph><p>The poem's epigraph.</p></epigraph>\n"
        "<stanza><title><p>First stanza</p></title><subtitle>its subtitle</subtitle>"
        "<v>The first verse,</v><v>the second verse.</v></stanza>\n"
        '<text-author>The poet</text-author><date value="1901-01-01">1901</date></poem>\n'
        "<cite><p>A quotation.</p><text-author>Its author</text-author></cite>\n"
        "<subtitle>A subtitle</subtitle>\n<empty-line/>\n"
        '<p>A paragraph with <strikethrough>struck</strikethrough>, H<sub>2</sub>O, x<sup>2</sup> '
        'and <style name="whisper">a named style</style>, and <code>code</code>.</p>\n'
        '<p xml:lang="de">Ein deutscher Absatz.</p>\n'
        '<p id="unlinked-id">A paragraph whose id no link targets.</p>\n'
        "</section>\n</section>\n"
        "<section><title><p>A titled top-level section</p></title><p>The end.</p></section>\n"
        "</body>\n</FictionBook>\n"
    )


def scripts_book() -> str:
    return (
        HEAD + description("Scripts", "en", "mfbe-pdf-scripts-0001")
        + "<body>\n<title><p>Scripts</p></title>\n<section><title><p>Shipped coverage</p></title>\n"
        '<p xml:lang="ka">ქართული ენა ერთ-ერთი უძველესი სალიტერატურო ენაა.</p>\n'
        '<p xml:lang="hy">Հայերենը հնդեվրոպական լեզվաընտանիքի առանձին ճյուղ է։</p>\n'
        '<p xml:lang="grc">Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν.</p>\n'
        '<p xml:lang="pl">Zażółć gęślą jaźń; český ř, ů; română ș, ț; latviešu ā, ē, ī, ū.</p>\n'
        '<p xml:lang="uk">Ґанок, їжак, єнот, ім\u02bcя; беларуская ў.</p>\n'
        "</section>\n<section><title><p>System fonts</p></title>\n"
        '<p>Hebrew words <style name="he">שלום עולם</style> and a Chinese word 书 in an English line.</p>\n'
        "</section>\n</body>\n</FictionBook>\n"
    )


def stylesheet_book() -> str:
    css = (
        'title p { font-family: "Arial", sans-serif; }\n'
        "epigraph { font-family: Georgia; }\n"
        "code { font-family: 'Courier New', monospace; }\n"
        ".plain { font-family: Verdana; }\n"
        ".unknown { font-family: 'Some Unknown Face'; }\n"
    )
    return (
        HEAD
        + "<stylesheet type=\"text/css\">" + css + "</stylesheet>\n"
        + description("Font kinds", "en", "mfbe-pdf-kinds-0001")
        + "<body>\n<title><p>Font kinds</p></title>\n<section><title><p>Titles in a sans-serif</p></title>\n"
        "<epigraph><p>An epigraph in Georgia, a serif.</p></epigraph>\n"
        '<p>Body text, then <code>code in Courier New</code>, <style name="plain">Verdana by name</style> '
        'and <style name="unknown">an unknown face</style>.</p>\n'
        "</section>\n</body>\n</FictionBook>\n"
    )


def png_rows(width: int, height: int):
    """A grey 8-bit PNG of the given size, written row by row (never held whole)."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    yield b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
    compressor = zlib.compressobj(9)
    row = b"\x00" + b"\x80" * width
    data = b""
    for _ in range(height):
        data += compressor.compress(row)
        if len(data) > 1 << 20:
            yield chunk(b"IDAT", data)
            data = b""
    data += compressor.flush()
    yield chunk(b"IDAT", data) + chunk(b"IEND", b"")


def hostile(out: pathlib.Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    nest = "".join("<section><title><p>Level %d</p></title>" % i for i in range(1, 1001))
    (out / "deep-nesting.fb2").write_text(
        HEAD + description("Deep nesting", "en", "mfbe-pdf-hostile-nest") + "<body>\n"
        + nest + "<p>The bottom.</p>" + "</section>" * 1000 + "\n</body>\n</FictionBook>\n", encoding="utf-8")
    rows = "".join(f"<tr><td>r{r}c1</td><td>r{r}c2</td></tr>" for r in range(1, 10001))
    (out / "big-table.fb2").write_text(
        HEAD + description("Big table", "en", "mfbe-pdf-hostile-table") + "<body>\n<section>"
        "<table><tr><th>One</th><th>Two</th></tr>" + rows + "</table></section>\n</body>\n</FictionBook>\n",
        encoding="utf-8")
    picture = b"".join(png_rows(20000, 20000))
    (out / "huge-picture.fb2").write_text(
        HEAD + description("Huge picture", "en", "mfbe-pdf-hostile-picture") + "<body>\n<section>"
        '<image l:href="#huge.png"/><p>After the picture.</p></section>\n</body>\n'
        '<binary id="huge.png" content-type="image/png">' + base64.b64encode(picture).decode("ascii")
        + "</binary>\n</FictionBook>\n", encoding="utf-8")
    refs = "".join(f'<p>Reference {i}<a l:href="#n{i}" type="note">{i}</a>.</p>' for i in range(1, 50001))
    notes = "".join(f'<section id="n{i}"><title><p>{i}</p></title><p>Note {i}.</p></section>' for i in range(1, 50001))
    (out / "many-notes.fb2").write_text(
        HEAD + description("Many notes", "en", "mfbe-pdf-hostile-notes") + "<body>\n<section>" + refs
        + '</section>\n</body>\n<body name="notes">' + notes + "</body>\n</FictionBook>\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hostile", type=pathlib.Path, help="write the hostile books of US4 there")
    args = parser.parse_args()
    if args.hostile:
        hostile(args.hostile)
        return
    for name, text in [("notes.fb2", notes_book()), ("untitled-sections.fb2", untitled_book()),
                       ("scripts.fb2", scripts_book()), ("stylesheet-kinds.fb2", stylesheet_book())]:
        (HERE / name).write_text(text, encoding="utf-8")
        print(f"wrote tests/fixtures/pdf/{name}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Writes the reference EPUBs of feature 012 into tests/fixtures/epub/ (research DP-21).

Every book is our own text, so the files are committed. They cover every EPUB version the import
reads (D17), every form of page (XHTML 1.1, XML HTML5, DTBook, OEB 1, SVG, an XML island with its
fallback), the protected and broken files (D17, D29), the markup of the converters found in the
corpus (D21, D26), the people by role (D28) and what FB2 cannot hold (D23-D27). Corpus books are
never copied here.

Run: python3 tests/fixtures/epub/make-fixtures.py (only when a fixture must change), and
--large <dir> for the hostile books too large to commit (many-pages.epub). The output is
deterministic: fixed ZIP times, fixed order.
"""
from __future__ import annotations

import pathlib
import struct
import zipfile
import zlib

HERE = pathlib.Path(__file__).resolve().parent
IMAGES = HERE.parent / "images"
EPOCH = (1980, 1, 1, 0, 0, 0)

XHTML_NS = "http://www.w3.org/1999/xhtml"
EPUB_NS = "http://www.idpf.org/2007/ops"
OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
CONTAINER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    '  <rootfiles><rootfile full-path="{path}" media-type="application/oebps-package+xml"/>'
    "</rootfiles>\n</container>\n"
)


def image(name: str) -> bytes:
    return (IMAGES / name).read_bytes()


def animated_gif() -> bytes:
    """A 1 x 1 GIF with two frames and the NETSCAPE loop extension (D23: the first frame)."""
    frame = b"!\xf9\x04\x00\x0a\x00\x00\x00" + b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00"
    head = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff"
    loop = b"!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    return head + loop + frame + frame + b";"


def png(width: int, height: int, rgb: tuple[int, int, int] = (40, 90, 160)) -> bytes:
    """An opaque RGB PNG of one colour, written row by row (also the 100-megapixel picture)."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    row = b"\x00" + bytes(rgb) * width
    compressor = zlib.compressobj(9)
    parts = [compressor.compress(row) for _ in range(height)]
    parts.append(compressor.flush())
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", b"".join(parts)) + chunk(b"IEND", b"")


def write_epub(name: str, entries: list[tuple[str, bytes | str]], *, mimetype_first: bool = True,
               encrypted: tuple[str, ...] = ()) -> None:
    path = HERE / name
    with zipfile.ZipFile(path, "w") as archive:
        def put(entry: str, data: bytes | str, stored: bool = False) -> None:
            info = zipfile.ZipInfo(entry, date_time=EPOCH)
            info.create_system = 3
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            archive.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)

        if mimetype_first:
            put("mimetype", "application/epub+zip", stored=True)
        for entry, data in entries:
            put(entry, data)
        if not mimetype_first:
            put("mimetype", "application/epub+zip")
    if encrypted:
        mark_encrypted(path, encrypted)


def mark_encrypted(path: pathlib.Path, names: tuple[str, ...]) -> None:
    """Sets the 'encrypted' flag of the named entries (a password-protected ZIP, D29)."""
    data = bytearray(path.read_bytes())
    for name in names:
        encoded = name.encode("utf-8")
        for signature, flag_offset, name_offset in ((b"PK\x03\x04", 6, 30), (b"PK\x01\x02", 8, 46)):
            start = 0
            while (start := data.find(signature, start)) >= 0:
                length = struct.unpack_from("<H", data, start + (26 if signature == b"PK\x03\x04" else 28))[0]
                if data[start + name_offset:start + name_offset + length] == encoded:
                    flags = struct.unpack_from("<H", data, start + flag_offset)[0] | 0x1
                    struct.pack_into("<H", data, start + flag_offset, flags)
                start += 4
    path.write_bytes(bytes(data))


def page3(title: str, body: str, lang: str = "en", head: str = "") -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
        f'<html xmlns="{XHTML_NS}" xmlns:epub="{EPUB_NS}" xml:lang="{lang}" lang="{lang}">\n'
        f"<head><meta charset=\"UTF-8\"/><title>{title}</title>"
        f'<link rel="stylesheet" type="text/css" href="style.css"/>{head}</head>\n<body>\n{body}\n</body>\n</html>\n'
    )


def page2(title: str, body: str, lang: str = "en") -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n'
        f'<html xmlns="{XHTML_NS}" xml:lang="{lang}">\n<head><title>{title}</title>'
        f'<link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n{body}\n</body>\n</html>\n'
    )


def nav(items: list[tuple[str, str]], extra: str = "") -> str:
    lis = "".join(f'<li><a href="{href}">{label}</a></li>' for href, label in items)
    body = f'<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{lis}</ol></nav>{extra}'
    return page3("Contents", body)


def ncx(uid: str, title: str, items: list[tuple[str, str]]) -> str:
    points = "".join(
        f'<navPoint id="p{n}" playOrder="{n}"><navLabel><text>{label}</text></navLabel>'
        f'<content src="{href}"/></navPoint>'
        for n, (href, label) in enumerate(items, 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        f'<head><meta name="dtb:uid" content="{uid}"/></head>\n'
        f"<docTitle><text>{title}</text></docTitle>\n<navMap>{points}</navMap>\n</ncx>\n"
    )


def opf(version: str | None, metadata: str, manifest: list[tuple[str, str, str, str]],
        spine: list[str], *, guide: str = "", toc: str | None = None, prefix: str = "",
        spine_attrs: str = "") -> str:
    version_attr = f' version="{version}"' if version else ""
    prefix_attr = f' prefix="{prefix}"' if prefix else ""
    items = "".join(
        f'<item id="{item_id}" href="{href}" media-type="{media}"{(" " + extra) if extra else ""}/>'
        for item_id, href, media, extra in manifest
    )
    toc_attr = f' toc="{toc}"' if toc else ""
    refs = "".join(f'<itemref idref="{idref}"/>' if " " not in idref else f"<itemref {idref}/>" for idref in spine)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<package xmlns="{OPF_NS}"{version_attr} unique-identifier="uid"{prefix_attr}>\n'
        f'<metadata xmlns:dc="{DC_NS}" xmlns:opf="{OPF_NS}">{metadata}</metadata>\n'
        f"<manifest>{items}</manifest>\n<spine{toc_attr}{spine_attrs}>{refs}</spine>\n{guide}</package>\n"
    )


STYLE = "p { text-indent: 1.5em; margin: 0; }\nh1, h2 { text-align: center; }\n"


def epub3_book(name: str, version: str, *, extra_meta: str = "", chapters: list[tuple[str, str]],
               extra_items: list[tuple[str, str, str, str]] = (), extra_entries: list[tuple[str, bytes | str]] = (),
               spine_extra: list[str] = (), lang: str = "en", legacy: bool = True, prefix: str = "",
               nav_extra: str = "", spine_attrs: str = "", style: str = STYLE) -> None:
    identifier = f"urn:uuid:7c1e7a40-{len(name):04d}-4000-8000-{sum(map(ord, name)):012d}"
    meta = (
        f'<dc:identifier id="uid">{identifier}</dc:identifier>'
        f"<dc:title>{name.removesuffix('.epub')} title</dc:title><dc:language>{lang}</dc:language>"
        '<dc:creator id="a1">Anna Example</dc:creator>'
        '<meta refines="#a1" property="role" scheme="marc:relators">aut</meta>'
        '<meta refines="#a1" property="file-as">Example, Anna</meta>'
        '<meta property="dcterms:modified">2026-11-10T12:00:00Z</meta>' + extra_meta
    )
    manifest = [("nav", "nav.xhtml", "application/xhtml+xml", 'properties="nav"'), ("css", "style.css", "text/css", "")]
    spine = []
    pages: list[tuple[str, bytes | str]] = [("EPUB/style.css", style)]
    toc_items = []
    for index, (title, body) in enumerate(chapters, 1):
        href = f"ch{index:02d}.xhtml"
        manifest.append((f"c{index}", href, "application/xhtml+xml", ""))
        spine.append(f"c{index}")
        pages.append((f"EPUB/{href}", page3(title, body, lang)))
        toc_items.append((href, title))
    if legacy:
        manifest.append(("ncx", "toc.ncx", "application/x-dtbncx+xml", ""))
        pages.append(("EPUB/toc.ncx", ncx(identifier, name, toc_items)))
    manifest.extend(extra_items)
    spine.extend(spine_extra)
    pages.append(("EPUB/nav.xhtml", nav(toc_items, nav_extra)))
    package = opf(version, meta, manifest, spine, toc="ncx" if legacy else None, prefix=prefix, spine_attrs=spine_attrs)
    write_epub(name, [("META-INF/container.xml", CONTAINER.format(path="EPUB/package.opf")),
                      ("EPUB/package.opf", package), *pages, *extra_entries])


def epub2_book(name: str, *, version: str | None = "2.0", chapters: list[tuple[str, str, str]],
               extra_meta: str = "", extra_items: list[tuple[str, str, str, str]] = (),
               extra_entries: list[tuple[str, bytes | str]] = (), guide: str = "", mimetype_first: bool = True,
               encrypted: tuple[str, ...] = ()) -> None:
    """chapters: (href, media type, content)."""
    meta = (
        '<dc:identifier id="uid" opf:scheme="UUID">5a7d2c10-0000-4000-8000-000000000002</dc:identifier>'
        f"<dc:title>{name.removesuffix('.epub')} title</dc:title><dc:language>ru</dc:language>"
        '<dc:creator opf:role="aut" opf:file-as="Иванов, Иван Иванович">Иван Иванович Иванов</dc:creator>'
        '<dc:contributor opf:role="trl" opf:file-as="Петров, Пётр">Пётр Петров</dc:contributor>' + extra_meta
    )
    manifest = [("ncx", "toc.ncx", "application/x-dtbncx+xml", ""), ("css", "style.css", "text/css", "")]
    spine, toc_items = [], []
    pages: list[tuple[str, bytes | str]] = [("OEBPS/style.css", STYLE)]
    for index, (href, media, content) in enumerate(chapters, 1):
        manifest.append((f"c{index}", href, media, ""))
        spine.append(f"c{index}")
        pages.append((f"OEBPS/{href}", content))
        toc_items.append((href, f"Глава {index}"))
    manifest.extend(extra_items)
    pages.append(("OEBPS/toc.ncx", ncx("5a7d2c10-0000-4000-8000-000000000002", name, toc_items)))
    package = opf(version, meta, manifest, spine, guide=guide, toc="ncx")
    write_epub(name, [("META-INF/container.xml", CONTAINER.format(path="OEBPS/content.opf")),
                      ("OEBPS/content.opf", package), *pages, *extra_entries],
               mimetype_first=mimetype_first, encrypted=encrypted)


def chapter_text(n: int) -> str:
    return f"<p>Paragraph one of chapter {n}.</p><p>Paragraph <em>two</em> of chapter <strong>{n}</strong>.</p>"


def large(directory: pathlib.Path) -> None:
    """The hostile books too large to commit (SC-009), written where the tests ask (T042)."""
    global HERE
    HERE = directory
    directory.mkdir(parents=True, exist_ok=True)
    epub3_book("many-pages.epub", "3.0", chapters=[(f"P{n}", f"<p>Page {n}.</p>") for n in range(1, 10001)],
               legacy=False)


def main() -> None:
    HERE.mkdir(exist_ok=True)
    # --- Every version (D17) ---------------------------------------------------------------
    ru2 = [
        ("ch1.xhtml", "application/xhtml+xml", page2("Глава 1", "<h1>Глава 1</h1><p>Текст<a id=\"r1\" href=\"ch2.xhtml#n1\">[1]</a>.</p>", "ru")),
        ("ch2.xhtml", "application/xhtml+xml", page2("Глава 2", "<h1>Глава 2</h1><p>Ещё текст.</p>"
                                                     "<p id=\"n1\"><a href=\"ch1.xhtml#r1\">[1]</a> Примечание.</p>", "ru")),
    ]
    cover_guide = '<guide><reference type="text" title="Text" href="ch1.xhtml"/></guide>\n'
    epub2_book("epub-2.0.epub", chapters=ru2, guide=cover_guide,
               extra_meta='<meta name="calibre:series" content="Серия"/><meta name="calibre:series_index" content="2"/>')
    epub2_book("epub-2.0.1.epub", chapters=ru2, guide=cover_guide)
    epub2_book("epub-no-version.epub", version=None, chapters=ru2)
    chapters3 = [("Chapter 1", f"<h1>Chapter 1</h1>{chapter_text(1)}"),
                 ("Chapter 2", f"<h1>Chapter 2</h1>{chapter_text(2)}")]
    epub3_book("epub-3.0.epub", "3.0", chapters=[
        ("Chapter 1", '<h1>Chapter 1</h1><p>Text<a epub:type="noteref" href="ch02.xhtml#fn1">1</a>.</p>'),
        ("Chapter 2", '<h1>Chapter 2</h1><p>More.</p><aside epub:type="footnote" id="fn1"><p>A note.</p></aside>')])
    epub3_book("epub-3.0.1.epub", "3.0", chapters=chapters3)
    epub3_book("epub-3.1.epub", "3.1", chapters=chapters3, legacy=False)
    epub3_book("epub-3.2.epub", "3.0", chapters=[
        ("The Book", "<h1>The Book</h1>"),
        ("Chapter 1", f"<h2>Chapter 1</h2>{chapter_text(1)}"),
        ("Chapter 2", f"<h2>Chapter 2</h2>{chapter_text(2)}")])
    epub3_book("epub-3.3.epub", "3.0", extra_meta=(
        '<meta property="schema:accessMode">textual</meta><dc:publisher>Example Press</dc:publisher>'
        '<dc:identifier id="isbn">urn:isbn:9780000000002</dc:identifier><dc:date>2026-01-02</dc:date>'
        '<dc:subject>sf_fantasy</dc:subject><dc:subject>Adventure</dc:subject>'
        '<dc:description>An annotation.</dc:description>'
        '<meta property="belongs-to-collection" id="s1">The Series</meta>'
        '<meta refines="#s1" property="collection-type">series</meta>'
        '<meta refines="#s1" property="group-position">3</meta>'), chapters=[
        ("Cover", '<div><img src="cover.jpg" alt="Cover"/></div>'),
        ("Title page", "<h1>epub-3.3 title</h1><p>Anna Example</p>"),
        ("Copyright", "<p>Copyright 2026 Example Press.</p>"),
        ("Chapter 1", '<h1 id="c1">Chapter 1</h1><p id="p1">Text.</p>'
                      '<p><a href="ch05.xhtml">next chapter</a>, <a href="ch05.xhtml#p2">a place</a>, '
                      '<a href="ch05.xhtml#missing">missing</a>, <a href="https://www.google.com">web</a>.</p>'),
        ("Chapter 2", '<h1>Chapter 2</h1><p id="p2">Second.</p><figure><img src="cover.jpg" alt="A picture"/>'
                      "<figcaption>The caption</figcaption></figure>")],
        extra_items=[("cover", "cover.jpg", "image/jpeg", 'properties="cover-image"')],
        extra_entries=[("EPUB/cover.jpg", image("tiny.jpg"))])
    # --- Every form of page (D17) ----------------------------------------------------------
    dtbook = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en">'
        "<head><meta name=\"dc:Title\" content=\"DTBook\"/></head><book><bodymatter><level1><h1>A poem</h1>"
        "<epigraph><p>An epigraph.</p></epigraph><poem><linegroup><line>First line</line><line>Second line</line>"
        "</linegroup></poem></level1></bodymatter></book></dtbook>\n")
    epub2_book("dtbook.epub", chapters=[("poem.xml", "application/x-dtbook+xml", dtbook)])
    oeb1 = ('<?xml version="1.0"?>\n<!DOCTYPE html PUBLIC "+//ISBN 0-9673008-1-9//DTD OEB 1.0.1 Document//EN" '
            '"http://openebook.org/dtds/oeb-1.0.1/oebdoc101.dtd">\n<html><head><title>OEB</title></head>'
            "<body><h1>OEB 1</h1><p>An OEB 1 document.</p></body></html>\n")
    epub2_book("oeb1.epub", chapters=[("oeb.html", "text/x-oeb1-document", oeb1)])
    island = '<?xml version="1.0"?>\n<recipe xmlns="urn:example:recipe"><step>Mix.</step></recipe>\n'
    epub2_book("xml-island.epub", chapters=[("ch1.xhtml", "application/xhtml+xml", page2("Before", "<p>Before.</p>"))],
               extra_items=[("island", "recipe.xml", "application/x-recipe+xml", 'fallback="fb"'),
                            ("fb", "recipe.xhtml", "application/xhtml+xml", "")],
               extra_entries=[("OEBPS/recipe.xml", island),
                              ("OEBPS/recipe.xhtml", page2("Recipe", "<p>Mix (fallback text).</p>"))])
    svg_page = ('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
                '<rect width="100" height="50" fill="#36c"/><text x="10" y="30">SVG page</text></svg>\n')
    epub3_book("svg-pages.epub", "3.0", chapters=chapters3,
               extra_items=[("svgp", "page.svg", "image/svg+xml", "")], spine_extra=["svgp"],
               extra_entries=[("EPUB/page.svg", svg_page)])
    # --- Protected and broken (D17, D29) ---------------------------------------------------
    adept = ('<?xml version="1.0"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
             'xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod '
             'Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference '
             'URI="OEBPS/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>\n')
    epub2_book("drm-adept.epub", chapters=ru2, extra_entries=[
        ("META-INF/encryption.xml", adept),
        ("META-INF/rights.xml", '<?xml version="1.0"?>\n<adept:rights xmlns:adept="http://ns.adobe.com/adept"/>\n')])
    obfuscation = ('<?xml version="1.0"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
                   'xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod '
                   'Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference '
                   'URI="OEBPS/font.otf"/></enc:CipherData></enc:EncryptedData></encryption>\n')
    epub2_book("font-obfuscation.epub", chapters=ru2,
               extra_items=[("font", "font.otf", "application/vnd.ms-opentype", "")],
               extra_entries=[("OEBPS/font.otf", b"OTTO" + bytes(60)), ("META-INF/encryption.xml", obfuscation)])
    (HERE / "not-zip.epub").write_text("This is not a ZIP archive, although it is named .epub.\n", encoding="utf-8")
    epub2_book("zip-bomb.epub", chapters=ru2, extra_entries=[("OEBPS/zeros.txt", bytes(64 * 1024 * 1024))])
    epub2_book("path-escape.epub", chapters=ru2, extra_entries=[("../../escape.txt", "outside the container\n")])
    epub2_book("mimetype-late.epub", chapters=ru2, mimetype_first=False)
    epub2_book("not-well-formed.epub", chapters=[
        ("ch1.xhtml", "application/xhtml+xml", '<html><head><title>Broken</title></head><body><p>Unclosed &nbsp; '
                                               "paragraph<p>Another<br>line</body></html>\n")])
    epub2_book("password-zip.epub", chapters=ru2, encrypted=("OEBPS/ch1.xhtml",))
    laughs = ('<?xml version="1.0"?>\n<!DOCTYPE html [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
              '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">'
              '<!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">'
              '<!ENTITY ext SYSTEM "file:///etc/passwd">]>\n'
              f'<html xmlns="{XHTML_NS}"><head><title>Entities</title></head><body><p>&f;</p><p>&ext;</p></body></html>\n')
    epub2_book("entities.epub", chapters=[("ch1.xhtml", "application/xhtml+xml", laughs)])
    deep = "<div>" * 500 + "<p>Deep.</p>" + "</div>" * 500
    epub3_book("deep-nesting.epub", "3.0", chapters=[("Deep", deep)])
    epub3_book("huge-picture.epub", "3.0", chapters=[("Huge", '<p><img src="huge.png" alt="huge"/></p>')],
               extra_items=[("huge", "huge.png", "image/png", "")],
               extra_entries=[("EPUB/huge.png", png(10001, 10000))])
    # --- Converters' markup (D20, D21, D26) ------------------------------------------------
    classes = "\n".join(f".calibre{n} {{ display: block; }}" for n in range(1, 31))
    classes += ("\n.calibre3 { text-indent: 1.2em; margin: 0 0 0.2em; }\n.calibre5 { font-style: italic; }"
                "\n.calibre6 { font-weight: bold; }\n.calibre7 { font-variant: small-caps; }"
                "\n.calibre8 { text-align: center; }\n.calibre9 { letter-spacing: 0.3em; }\n")
    para = '<p class="calibre3">'
    epub3_book("calibre-like.epub", "3.0", chapters=[("Chapter 1", (
        f'<h1 class="calibre2">Chapter 1</h1>{para}Plain <span class="calibre5">italic</span> and '
        f'<span class="calibre6">bold</span>.</p>{para}<span class="calibre7">Small caps</span>.</p>'
        f'<p class="calibre3 calibre8">Centred.</p>{para}<span class="calibre9">Spaced</span>.</p>'
        f"{para}Plain again.</p>"))],
        extra_entries=[("EPUB/calibre.css", classes)],
        extra_items=[("calcss", "calibre.css", "text/css", "")])
    epub3_book("indesign-footnotes.epub", "3.0", chapters=[("Chapter 1", (
        '<h1>Chapter 1</h1><p>Text<span class="_idFootnoteLink _idGenColorInherit">'
        '<a class="_idFootnoteLink" href="#footnote-001" id="footnote-001-backlink">1</a></span>.</p>'
        '<div class="_idFootnotes"><div class="_idFootnote" id="footnote-001">'
        '<p><a class="_idFootnoteAnchor" href="#footnote-001-backlink">1</a> The footnote.</p></div></div>'))])
    epub2_book("fb2-converter.epub", chapters=[("ch1.xhtml", "application/xhtml+xml", page2("Body", (
        '<h1 class="body_head">Автор<br/>Книга</h1><div class="section1"><h2 class="hsection1">Глава</h2>'
        '<blockquote class="epigraph"><p class="b">Эпиграф.</p><blockquote><p>Автор эпиграфа</p></blockquote>'
        '</blockquote><p class="b">Абзац.</p><h5 class="subtitle">Подзаголовок</h5>'
        '<div class="poem"><div class="v">Строка один</div><div class="v">Строка два</div></div></div>'), "ru"))],
        extra_meta='<dc:source>FictionBook2</dc:source>')
    # --- People by role (D28) --------------------------------------------------------------
    roles = "".join(
        f'<dc:{kind} id="{pid}">{name}</dc:{kind}><meta refines="#{pid}" property="role" scheme="marc:relators">{role}</meta>'
        + (f'<meta refines="#{pid}" property="file-as">{file_as}</meta>' if file_as else "")
        for kind, pid, name, role, file_as in (
            ("contributor", "t1", "Peter Translator", "trl", "Translator, Peter"),
            ("contributor", "i1", "Vincent Van Gogh", "ill", "Van Gogh, Vincent"),
            ("contributor", "e1", "Ю Редактор", "edt", ""),
            ("contributor", "ph", "Paula Photographer", "pht", ""),
            ("contributor", "bk", "calibre (7.0) [https://calibre-ebook.com]", "bkp", ""),
        ))
    epub3_book("roles.epub", "3.0", extra_meta=roles, chapters=chapters3)
    # --- What FB2 cannot hold (D23-D27) ----------------------------------------------------
    mathml = ('<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>')
    everything_body = (
        '<h1>Everything</h1><p><img src="i.webp" alt="webp"/><img src="a.gif" alt="gif"/><img src="i.bmp" alt="bmp"/>'
        '<img src="i.tif" alt="tif"/><img src="i.avif" alt="avif"/><img src="d.svg" alt="svg picture"/></p>'
        '<p>Inline <svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" '
        f'fill="#c33"/></svg> drawing and a formula {mathml}.</p>'
        '<p><audio src="s.mp3" controls="controls">The audio fallback text.</audio></p>'
        '<p><video src="v.mp4" poster="poster.png" controls="controls">The video fallback.</video></p>'
        '<script>document.title = "never runs";</script><form action="#"><input type="text" name="q"/></form>'
        '<p><span epub:type="pagebreak" id="pg5" title="5"/>After page 5.</p>'
        '<p><img src="https://example.com/remote.png" alt="remote"/></p>')
    epub3_book("everything.epub", "3.0", chapters=[("Everything", everything_body)],
               extra_items=[
                   ("webp", "i.webp", "image/webp", ""), ("gif", "a.gif", "image/gif", ""), ("bmp", "i.bmp", "image/bmp", ""),
                   ("tif", "i.tif", "image/tiff", ""), ("avif", "i.avif", "image/avif", ""),
                   ("svg", "d.svg", "image/svg+xml", ""), ("mp3", "s.mp3", "audio/mpeg", ""), ("mp4", "v.mp4", "video/mp4", ""),
                   ("poster", "poster.png", "image/png", ""), ("font", "f.otf", "font/otf", ""),
                   ("smil", "c1.smil", "application/smil+xml", "")],
               extra_entries=[
                   ("EPUB/i.webp", image("tiny.webp")), ("EPUB/a.gif", animated_gif()), ("EPUB/i.bmp", image("tiny.bmp")),
                   ("EPUB/i.tif", image("tiny.tif")), ("EPUB/i.avif", image("tiny.avif")),
                   ("EPUB/d.svg", svg_page), ("EPUB/s.mp3", b"ID3" + bytes(32)), ("EPUB/v.mp4", bytes(32)),
                   ("EPUB/poster.png", image("tiny.png")), ("EPUB/f.otf", b"OTTO" + bytes(60)),
                   ("EPUB/c1.smil", '<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body/></smil>\n')],
               style=STYLE + '@font-face { font-family: "Remote"; src: url("https://example.com/f.woff2"); }\n',
               nav_extra='<nav epub:type="page-list" hidden="hidden"><ol><li><a href="ch01.xhtml#pg5">5</a></li></ol></nav>')
    epub3_book("fixed-layout.epub", "3.0", prefix="rendition: http://www.idpf.org/vocab/rendition/#",
               extra_meta='<meta property="rendition:layout">pre-paginated</meta>',
               chapters=[("Page 1", '<div style="position:absolute;left:10px;top:10px"><img src="p.png" alt="page"/></div>'
                                    '<p style="position:absolute;left:10px;top:200px">Text on page 1.</p>')],
               extra_items=[("p", "p.png", "image/png", "")], extra_entries=[("EPUB/p.png", image("tiny.png"))])


if __name__ == "__main__":
    import sys

    if len(sys.argv) == 3 and sys.argv[1] == "--large":
        large(pathlib.Path(sys.argv[2]).resolve())
    else:
        main()

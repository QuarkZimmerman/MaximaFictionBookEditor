#!/usr/bin/env python3
"""Feature 016 (research R10; tasks T004): the PDF import's generated fixtures.

  python3 tests/fixtures/pdf/import/make-fixtures.py [--check]

Writes, next to this script, PDFs the editor's tests read: text PDFs, scans with an invisible text layer
and with the text under the picture, a picture of text without a layer, pictures only, a garbled layer,
drawings, forms, password-protected and copy-restricted files, and the hostile set (hostile/). Each PDF has
`<name>.expected.json`: the page kinds, the refusal reason when the import must refuse, and words its text
must hold. The tagged fixture is printed by Chromium (make-tagged.mjs). `--check` regenerates in memory and
fails when a committed file differs.

Needs Pillow, as tests/fixtures/pdf/make-format-fixtures.py does (the host's venv has it). Deterministic:
no dates, fixed ids, fixed drawing.
"""
from __future__ import annotations

import hashlib
import io
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FONT = REPO / "resources" / "fonts" / "NotoSerif-Regular.ttf"
PAGE_W, PAGE_H = 420, 595  # A5-ish, points
SCAN_W, SCAN_H = 700, 992  # page pictures, pixels (120 dpi)
FILE_ID = bytes.fromhex("0123456789abcdef0123456789abcdef")

PROSE = [
    "The first paragraph of the generated book tells a short story about a quiet",
    "harbour town, where the boats come in early and the market opens at dawn.",
    "Fishermen sort their catch while the bakers carry warm bread to the square.",
    "  A second paragraph begins with an indent, as printed books set it, and",
    "goes on for a few lines so that the import can see where paragraphs end and",
    "where a word is hyphen-",
    "ated at the end of a line.",
]

# --- PDF writing ---------------------------------------------------------------------------------


class Pdf:
    def __init__(self) -> None:
        self.objects: list[bytes | None] = []

    def reserve(self) -> int:
        self.objects.append(None)
        return len(self.objects)

    def add(self, body: bytes | str, number: int | None = None) -> int:
        data = body.encode("latin-1") if isinstance(body, str) else body
        if number is None:
            self.objects.append(data)
            return len(self.objects)
        self.objects[number - 1] = data
        return number

    def stream(self, data: bytes, extra: str = "", number: int | None = None, compress: bool = True) -> int:
        if compress:
            data = zlib.compress(data, 9)
            extra = "/Filter /FlateDecode " + extra
        head = f"<< {extra}/Length {len(data)} >>\nstream\n".encode("latin-1")
        return self.add(head + data + b"\nendstream", number)

    def write(self, root: int, info: int | None = None, encrypt: int | None = None,
              crypt=None) -> bytes:
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for number, body in enumerate(self.objects, start=1):
            assert body is not None, f"object {number} never written"
            if crypt and number != encrypt:
                body = crypt(number, body)
            offsets.append(len(out))
            out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
        xref = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(self.objects) + 1)
        for offset in offsets:
            out += b"%010d 00000 n \n" % offset
        trailer = f"<< /Size {len(self.objects) + 1} /Root {root} 0 R /ID [<{FILE_ID.hex()}> <{FILE_ID.hex()}>]"
        if info:
            trailer += f" /Info {info} 0 R"
        if encrypt:
            trailer += f" /Encrypt {encrypt} 0 R"
        out += ("trailer\n" + trailer + " >>\n").encode("latin-1")
        out += b"startxref\n%d\n%%%%EOF\n" % xref
        return bytes(out)


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def fonts(pdf: Pdf) -> dict[str, int]:
    """Helvetica in three styles, WinAnsi, with a ToUnicode map that keeps 0xAD a soft hyphen."""
    cmap = (b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /mfbe-ansi def\n"
            b"1 begincodespacerange <00> <FF> endcodespacerange\n"
            b"2 beginbfrange <20> <7E> <0020> <AD> <AD> <00AD> endbfrange\n"
            b"endcmap CMapName currentdict /CMap defineresource pop end end\n")
    to_unicode = pdf.stream(cmap)
    out = {}
    for key, base in (("F1", "Helvetica"), ("F2", "Helvetica-Bold"), ("F3", "Helvetica-Oblique")):
        out[key] = pdf.add(f"<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding "
                           f"/ToUnicode {to_unicode} 0 R >>")
    return out


def font_res(f: dict[str, int]) -> str:
    return "/Font << " + " ".join(f"/{k} {v} 0 R" for k, v in f.items()) + " >>"


def jpeg(image: Image.Image, quality: int = 70) -> bytes:
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=quality, optimize=False)
    return out.getvalue()


def image_obj(pdf: Pdf, image: Image.Image) -> int:
    data = jpeg(image)
    space = "/DeviceGray" if image.mode == "L" else "/DeviceRGB"
    return pdf.stream(data, f"/Type /XObject /Subtype /Image /Width {image.width} /Height {image.height} "
                            f"/ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode ", compress=False)


def pages_tree(pdf: Pdf, kids: list[int], pages: int) -> None:
    pdf.add(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>", pages)


def page(pdf: Pdf, parent: int, content: bytes, resources: str, extra: str = "") -> int:
    c = pdf.stream(content)
    return pdf.add(f"<< /Type /Page /Parent {parent} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                   f"/Resources << {resources} >> /Contents {c} 0 R {extra}>>")


def text_lines(lines, x0=40, top=520, size=10, lead=13, font="F1", mode=0) -> bytes:
    out = [f"BT {mode} Tr /{font} {size} Tf {lead} TL {x0} {top} Td"]
    for line in lines:
        indent = 18 if line.startswith("  ") else 0
        text = esc(line.strip())
        if indent:
            out.append(f"{indent} 0 Td ({text}) Tj -{indent} 0 Td T*")
        else:
            out.append(f"({text}) Tj T*")
    out.append("ET")
    return "\n".join(out).encode("latin-1")


# --- page pictures (scans) -----------------------------------------------------------------------


def render_text_picture(lines: list[str], blank: bool = False) -> Image.Image:
    image = Image.new("L", (SCAN_W, SCAN_H), 250)
    if blank:
        return image
    draw = ImageDraw.Draw(image)
    face = ImageFont.truetype(str(FONT), 22)
    y = 120
    for line in lines:
        x = 90 + (40 if line.startswith("  ") else 0)
        draw.text((x, y), line.strip().replace("\u00ad", "-"), fill=20, font=face)
        y += 34
    return image


def illustration() -> Image.Image:
    image = Image.new("L", (SCAN_W, SCAN_H), 250)
    draw = ImageDraw.Draw(image)
    draw.ellipse((150, 250, 550, 650), outline=30, width=14)
    draw.rectangle((250, 700, 450, 880), fill=90)
    draw.polygon([(350, 100), (500, 230), (200, 230)], fill=60)
    return image


def scan_page(pdf: Pdf, parent: int, f: dict[str, int], picture: Image.Image, layer: list[str] | None,
              under: bool = False) -> int:
    im = image_obj(pdf, picture)
    draw = f"q {PAGE_W} 0 0 {PAGE_H} 0 0 cm /Im1 Do Q\n".encode("latin-1")
    text = b""
    if layer is not None:
        text = text_lines(layer, x0=54, top=PAGE_H - 92, size=12.6, lead=20.3, mode=0 if under else 3)
    content = (text + b"\n" + draw) if under else (draw + text)
    return page(pdf, parent, content, f"{font_res(f)} /XObject << /Im1 {im} 0 R >>")


# --- encryption (standard handler, RC4 40-bit, revision 2) ---------------------------------------

PAD = bytes.fromhex("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a")


def rc4(key: bytes, data: bytes) -> bytes:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    i = j = 0
    out = bytearray()
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def encryption(user: str, owner: str, permissions: int):
    padded = lambda pw: (pw.encode("latin-1") + PAD)[:32]
    o = rc4(hashlib.md5(padded(owner)).digest()[:5], padded(user))
    key = hashlib.md5(padded(user) + o + struct.pack("<i", permissions) + FILE_ID).digest()[:5]
    u = rc4(key, PAD)
    dictionary = f"<< /Filter /Standard /V 1 /R 2 /O <{o.hex()}> /U <{u.hex()}> /P {permissions} >>"

    def crypt(number: int, body: bytes) -> bytes:
        if b"stream\n" not in body:
            return body  # the fixtures hold no strings outside streams
        head, rest = body.split(b"stream\n", 1)
        data = rest[: rest.rindex(b"\nendstream")]
        object_key = hashlib.md5(key + struct.pack("<I", number)[:3] + b"\x00\x00").digest()[:10]
        return head + b"stream\n" + rc4(object_key, data) + b"\nendstream"

    return dictionary, crypt


# --- the fixtures --------------------------------------------------------------------------------


def text_untagged() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    picture = Image.new("RGB", (160, 100), (200, 220, 240))
    ImageDraw.Draw(picture).rectangle((20, 20, 140, 80), fill=(40, 90, 160))
    im = image_obj(pdf, picture)
    kids = []
    for n in (1, 2):
        head = text_lines(["The Generated Book"], x0=150, top=570, size=8)
        number = text_lines([str(n)], x0=205, top=24, size=8)
        if n == 1:
            body = (text_lines(["Chapter One"], top=520, size=16, font="F2")
                    + b"\n" + text_lines(PROSE, top=490)
                    + b"\nBT /F2 10 Tf 40 380 Td (Bold words) Tj /F3 10 Tf ( and italic words.) Tj ET\n"
                    + f"q 160 0 0 100 40 250 cm /Im1 {0} Do Q".replace("/Im1 0", "/Im1").encode("latin-1"))
        else:
            body = text_lines(["Chapter Two"], top=520, size=16, font="F2") + b"\n" + text_lines(PROSE[:3], top=490)
        link = pdf.add(f"<< /Type /Annot /Subtype /Link /Rect [40 480 300 492] /Border [0 0 0] "
                       f"/A << /S /URI /URI (https://example.org/) >> >>") if n == 1 else None
        extra = f"/Annots [{link} 0 R] " if link else ""
        kids.append(page(pdf, pages, head + b"\n" + number + b"\n" + body,
                         f"{font_res(f)} /XObject << /Im1 {im} 0 R >>", extra))
    pages_tree(pdf, kids, pages)
    outline = pdf.reserve()
    b1 = pdf.add(f"<< /Title (Chapter One) /Parent {outline} 0 R /Next {outline + 2} 0 R "
                 f"/Dest [{kids[0]} 0 R /XYZ 0 540 0] >>")
    b2 = pdf.add(f"<< /Title (Chapter Two) /Parent {outline} 0 R /Prev {b1} 0 R "
                 f"/Dest [{kids[1]} 0 R /XYZ 0 540 0] >>")
    pdf.add(f"<< /Type /Outlines /First {b1} 0 R /Last {b2} 0 R /Count 2 >>", outline)
    info = pdf.add("<< /Title (The Generated Book) /Author (Ann Example) /Subject (A generated text PDF.) "
                   "/Keywords (fixture, import) >>")
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R /Outlines {outline} 0 R /Lang (en) >>", catalog)
    return pdf.write(catalog, info), {"kinds": ["text", "text"], "contains": ["harbour", "hyphenated",
                                                                         "Bold", "italic"]}


def scan(layer_mode: str) -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    layered = [line.replace("hyphen-", "hyphen\u00ad") for line in PROSE]
    kids = [scan_page(pdf, pages, f, illustration(), None)]
    under = layer_mode == "under"
    kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE), [l.replace("\u00ad", "\xad") for l in layered], under))
    kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE[:3]), PROSE[:3], under))
    kids.append(scan_page(pdf, pages, f, render_text_picture([], blank=True), None))
    pages_tree(pdf, kids, pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    kinds = ["pictureWithoutText", "pictureWithLayer", "pictureWithLayer", "blank"]
    return pdf.write(catalog), {"kinds": kinds, "contains": ["harbour", "hyphenated"], "cover": 1}


def picture_pages(with_first_layer: bool, garbled: bool = False) -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    kids = []
    if garbled:
        junk = ["pc; ekop. l_ta ,11oo;p:tda [{ozlyag-", "k|!ig1ovi(!, 11., Bare}!!{evo }1ors. ar\\.",
                "*. t1:t !|os::fa. !1:tzvattt v 1951] g. 1} |!0(\"|'',", "1(o3'Rvvs|{F1'F, zal.' Fhotst:oe ttore"]
        kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE), junk))
        kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE[:3]), junk[:2]))
        pages_tree(pdf, kids, pages)
        pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
        return pdf.write(catalog), {"kinds": ["garbled", "garbled"], "reason": "garbled"}
    if with_first_layer:
        kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE), PROSE))
    kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE), None))
    kids.append(scan_page(pdf, pages, f, render_text_picture(PROSE[:4]), None))
    pages_tree(pdf, kids, pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    if with_first_layer:
        return pdf.write(catalog), {"kinds": ["pictureWithLayer", "pictureShowingText", "pictureShowingText"],
                                    "reason": "pictureOfText", "pages": 2}
    return pdf.write(catalog), {"kinds": ["pictureShowingText", "pictureShowingText"], "reason": "noText",
                                "pages": 2}


def drawing() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    chart = ["q 0.2 0.3 0.6 rg", "60 300 30 80 re f", "100 300 30 140 re f", "140 300 30 60 re f",
             "180 300 30 110 re f", "Q", "q 0 0 0 RG 1 w 50 300 m 230 300 l S 50 300 m 50 460 l S Q"]
    table = ["q 0 0 0 RG 0.5 w", "40 200 m 380 200 l S", "40 180 m 380 180 l S", "40 160 m 380 160 l S",
             "40 160 m 40 200 l S", "210 160 m 210 200 l S", "380 160 m 380 200 l S", "Q"]
    cells = (b"BT /F1 10 Tf 46 186 Td (Cell one) Tj 170 0 Td (Cell two) Tj ET\n"
             b"BT /F1 10 Tf 46 166 Td (Cell three) Tj 170 0 Td (Cell four) Tj ET\n")
    content = (text_lines(PROSE[:3], top=540) + b"\n" + "\n".join(chart).encode() + b"\n"
               + "\n".join(table).encode() + b"\n" + cells
               + b"BT /F1 7 Tf 60 290 Td (Q1  Q2  Q3  Q4) Tj ET")
    kids = [page(pdf, pages, content, font_res(f))]
    pages_tree(pdf, kids, pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    return pdf.write(catalog), {"kinds": ["text"], "drawings": 1, "contains": ["harbour", "Cell"]}


def forms() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    page_number = pdf.reserve()
    fields = []
    for i, (label, value, y) in enumerate((("Name:", "Ann Example", 480), ("Town:", "Harbourtown", 455))):
        fields.append(pdf.add(f"<< /Type /Annot /Subtype /Widget /FT /Tx /T (field{i}) /V ({value}) "
                              f"/Rect [110 {y - 4} 300 {y + 12}] /P {page_number} 0 R /F 4 >>"))
    content = (b"BT /F1 11 Tf 40 480 Td (Name:) Tj 0 -25 Td (Town:) Tj ET\n"
               + text_lines(PROSE[:2], top=420))
    c = pdf.stream(content)
    pdf.add(f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << {font_res(f)} >> "
            f"/Contents {c} 0 R /Annots [{' '.join(f'{x} 0 R' for x in fields)}] >>", page_number)
    pages_tree(pdf, [page_number], pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R /AcroForm << /Fields [{' '.join(f'{x} 0 R' for x in fields)}] >> >>",
            catalog)
    return pdf.write(catalog), {"kinds": ["text"], "forms": 2, "contains": ["Name", "Harbourtown"]}


def protected(user: str, permissions: int) -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    kids = [page(pdf, pages, text_lines(PROSE, top=520), font_res(f))]
    pages_tree(pdf, kids, pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    dictionary, crypt = encryption(user, "owner", permissions)
    encrypt = pdf.add(dictionary)
    expected = {"kinds": ["text"], "contains": ["harbour"], "userPassword": user, "ownerPassword": "owner"}
    if permissions & 16 == 0:
        expected["copyForbidden"] = True
    return pdf.write(catalog, encrypt=encrypt, crypt=crypt), expected


def hostile() -> dict[str, tuple[bytes, dict]]:
    base, _ = text_untagged()
    out: dict[str, tuple[bytes, dict]] = {}
    out["truncated"] = (base[: len(base) // 2], {"reasonAny": ["damaged", "notPdf"]})
    broken = base.replace(b"xref\n0 ", b"xref\n9 ")
    out["broken-xref"] = (broken, {"reasonAny": ["damaged"], "mayRead": True})
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    pdf.add(f"<< /Type /Pages /Kids [{pages} 0 R] /Count 1 >>", pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    out["page-loop"] = (pdf.write(catalog), {"reasonAny": ["damaged", "noText"]})
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    content = zlib.compress(b"0 " * (32 * 1024 * 1024), 9)  # 64 MB of operands when inflated
    c = pdf.add(f"<< /Filter /FlateDecode /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream")
    p = pdf.add(f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Contents {c} 0 R >>")
    pages_tree(pdf, [p], pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    out["bomb"] = (pdf.write(catalog), {"reasonAny": ["noText", "damaged", "memory", "timeout"]})
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    p = pdf.add(f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] >>")
    pdf.add(f"<< /Type /Pages /Kids [{p} 0 R] /Count 100000 >>", pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    out["many-pages"] = (pdf.write(catalog), {"reasonAny": ["noText", "damaged", "tooManyPages"]})
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    im = pdf.add(b"<< /Type /XObject /Subtype /Image /Width 50000 /Height 50000 /ColorSpace /DeviceGray "
                 b"/BitsPerComponent 8 /Length 4 >>\nstream\n\x00\x00\x00\x00\nendstream")
    c = pdf.stream(f"q {PAGE_W} 0 0 {PAGE_H} 0 0 cm /Im1 Do Q".encode())
    p = pdf.add(f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                f"/Resources << /XObject << /Im1 {im} 0 R >> >> /Contents {c} 0 R >>")
    pages_tree(pdf, [p], pages)
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>", catalog)
    out["huge-picture"] = (pdf.write(catalog), {"reasonAny": ["noText", "damaged"]})
    pdf = Pdf()
    catalog, pages = pdf.reserve(), pdf.reserve()
    f = fonts(pdf)
    p = page(pdf, pages, text_lines(PROSE[:2]), font_res(f))
    pages_tree(pdf, [p], pages)
    first = len(pdf.objects) + 1
    depth = 300
    for i in range(depth):
        number = first + i
        parent = number - 1 if i else first + depth
        kid = f"/First {number + 1} 0 R /Last {number + 1} 0 R /Count 1 " if i + 1 < depth else ""
        pdf.add(f"<< /Title (Level {i}) /Parent {parent} 0 R {kid}/Dest [{p} 0 R /XYZ 0 500 0] >>")
    root = pdf.add(f"<< /Type /Outlines /First {first} 0 R /Last {first} 0 R /Count 1 >>")
    pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R /Outlines {root} 0 R "
            f"/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> "
            f"/Names << /EmbeddedFiles << /Names [(a.txt) << /Type /Filespec /F (a.txt) >>] >> >> >>", catalog)
    out["deep-outline-scripts"] = (pdf.write(catalog), {"kinds": ["text"], "contains": ["harbour"]})
    return out


def tagged() -> tuple[bytes, dict] | None:
    script = HERE / "make-tagged.mjs"
    if not script.exists():
        return None
    result = subprocess.run(["node", str(script)], capture_output=True, cwd=REPO / "ui")
    if result.returncode != 0:
        print(result.stderr.decode(errors="replace"), file=sys.stderr)
        return None
    return result.stdout, {"kinds": ["text"], "tagged": True, "contains": ["Heading", "item", "Cell"]}


def build() -> dict[str, tuple[bytes, dict]]:
    files = {
        "text-untagged": text_untagged(),
        "scan-invisible": scan("invisible"),
        "scan-under": scan("under"),
        "picture-of-text": picture_pages(True),
        "pictures-only": picture_pages(False),
        "garbled": picture_pages(False, garbled=True),
        "drawing": drawing(),
        "forms": forms(),
        "password-user": protected("secret", -4),
        "copy-restricted": protected("", -20),
    }
    files.update({f"hostile/{k}": v for k, v in hostile().items()})
    t = tagged()
    if t:
        files["tagged"] = t
    return files


def main() -> int:
    check = "--check" in sys.argv
    failed = []
    for name, (data, expected) in build().items():
        pdf_path = HERE / f"{name}.pdf"
        json_path = HERE / f"{name}.expected.json"
        text = json.dumps(expected, indent=1, ensure_ascii=False) + "\n"
        if check:
            if name == "tagged":
                continue  # printed by the browser: its bytes carry the print time
            if not pdf_path.exists() or pdf_path.read_bytes() != data or json_path.read_text() != text:
                failed.append(name)
            continue
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        pdf_path.write_bytes(data)
        json_path.write_text(text, encoding="utf-8")
        print(f"wrote {pdf_path.relative_to(REPO)} ({len(data)} bytes)")
    if failed:
        print("differ: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

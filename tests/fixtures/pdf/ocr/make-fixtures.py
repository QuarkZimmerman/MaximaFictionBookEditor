#!/usr/bin/env python3
"""Feature 020 (tasks T007): deterministic synthetic OCR and mixed-PDF test fixtures.

  python3 tests/fixtures/pdf/ocr/make-fixtures.py [--check]

Writes, next to this script, synthetic PDFs covering every OCR scenario:
  - scan-en-10p.pdf: 10-page English image-only scan
  - scan-ru-10p.pdf: 10-page Russian image-only scan with contradictory /Lang (en)
  - scan-de.pdf: 2-page German image-only scan (umlauts and sharp s)
  - scan-uk.pdf: 2-page Ukrainian image-only scan (distinguishable from Russian)
  - scan-rotated.pdf: 3-page English scan rotated 90, 180, and 270 degrees clockwise
  - garbled-ru.pdf: 2-page Russian scan with a garbled invisible text layer
  - mixed-full.pdf: 6-page mixed book (page-1 cover, searchable text, searchable text +
    embedded text-bearing raster image + pure illustration, stray-furniture scan,
    scanned page with inline illustration, bilingual EN+RU scanned page)
  - scan-bilingual-ru-en.pdf: 2-page primarily Russian scan with an English paragraph block
  - clean-ocr-layer.pdf: 2-page ABBYY-style pictureWithLayer scan that must bypass OCR
  - copy-restricted-scan.pdf: copy-forbidden image-only scan
  - unreadable-noise.pdf: 1-page high-frequency noise image (ocrUnreadable)
  - scan-uninstalled-script.pdf: 1-page Georgian script scan (ocrLanguageMissing)
  - scan-partial-fallback.pdf: 2-page scan with readable page 1 + unreadable page 2

Each PDF has a matching `<name>.expected.json`. `--check` regenerates in memory and fails
when any committed fixture differs. Requires Pillow and uses bundled Noto fonts for
bit-for-bit determinism across hosts.
"""
from __future__ import annotations

import hashlib
import io
import json
import random
import struct
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FONTS_DIR = REPO / "resources" / "fonts"
FONT_REGULAR = FONTS_DIR / "NotoSerif-Regular.ttf"
FONT_BOLD = FONTS_DIR / "NotoSerif-Bold.ttf"
FONT_GEORGIAN = FONTS_DIR / "NotoSerifGeorgian-Regular.ttf"

PAGE_W, PAGE_H = 420, 595  # A5 points (5.83" x 8.26")
SCAN_W, SCAN_H = 1050, 1488  # ~180 dpi for crisp Tesseract recognition
FILE_ID = bytes.fromhex("2026112400000020abcdef0123456789")


# --- minimal deterministic PDF builder -----------------------------------------------------------


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


def winansi_fonts(pdf: Pdf) -> dict[str, int]:
    cmap = (b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /mfbe-ansi def\n"
            b"1 begincodespacerange <00> <FF> endcodespacerange\n"
            b"2 beginbfrange <20> <7E> <0020> <AD> <AD> <00AD> endbfrange\n"
            b"endcmap CMapName currentdict /CMap defineresource pop end end\n")
    to_unicode = pdf.stream(cmap)
    out = {}
    for key, base in (("F1", "Helvetica"), ("F2", "Helvetica-Bold")):
        out[key] = pdf.add(
            f"<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding "
            f"/ToUnicode {to_unicode} 0 R >>"
        )
    return out


def font_res(f: dict[str, int]) -> str:
    return "/Font << " + " ".join(f"/{k} {v} 0 R" for k, v in f.items()) + " >>"


def jpeg_bytes(image: Image.Image, quality: int = 72) -> bytes:
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=quality, optimize=False)
    return out.getvalue()


def image_obj(pdf: Pdf, image: Image.Image, quality: int = 72) -> int:
    data = jpeg_bytes(image, quality=quality)
    space = "/DeviceGray" if image.mode == "L" else "/DeviceRGB"
    return pdf.stream(
        data,
        f"/Type /XObject /Subtype /Image /Width {image.width} /Height {image.height} "
        f"/ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode ",
        compress=False,
    )


def pages_tree(pdf: Pdf, kids: list[int], pages: int) -> None:
    pdf.add(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>", pages)


def add_page(pdf: Pdf, parent: int, content: bytes, resources: str,
             width: int = PAGE_W, height: int = PAGE_H) -> int:
    c = pdf.stream(content)
    return pdf.add(
        f"<< /Type /Page /Parent {parent} 0 R /MediaBox [0 0 {width} {height}] "
        f"/Resources << {resources} >> /Contents {c} 0 R >>"
    )


def text_lines(lines: list[str], x0: float = 42, top: float = 520, size: float = 10,
               lead: float = 14, font: str = "F1", mode: int = 0) -> bytes:
    out = [f"BT {mode} Tr /{font} {size} Tf {lead} TL {x0} {top} Td"]
    for line in lines:
        indent = 16 if line.startswith("  ") else 0
        text = esc(line.strip())
        if indent:
            out.append(f"{indent} 0 Td ({text}) Tj -{indent} 0 Td T*")
        else:
            out.append(f"({text}) Tj T*")
    out.append("ET")
    return "\n".join(out).encode("latin-1")


def scan_page(pdf: Pdf, parent: int, picture: Image.Image, f: dict[str, int] | None = None,
              layer_content: bytes = b"", quality: int = 72,
              width: int = PAGE_W, height: int = PAGE_H) -> int:
    im = image_obj(pdf, picture, quality=quality)
    draw = f"q {width} 0 0 {height} 0 0 cm /Im1 Do Q\n".encode("latin-1")
    res = f"/XObject << /Im1 {im} 0 R >>"
    if f:
        res = f"{font_res(f)} {res}"
    return add_page(pdf, parent, draw + layer_content, res, width=width, height=height)


# --- encryption (RC4 40-bit, revision 2) ---------------------------------------------------------

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
            return body
        head, rest = body.split(b"stream\n", 1)
        data = rest[: rest.rindex(b"\nendstream")]
        object_key = hashlib.md5(key + struct.pack("<I", number)[:3] + b"\x00\x00").digest()[:10]
        return head + b"stream\n" + rc4(object_key, data) + b"\nendstream"

    return dictionary, crypt


# --- page raster rendering helpers ---------------------------------------------------------------


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def wrap_paragraph(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont,
                   max_width: int, first_indent: int = 0) -> list[tuple[int, str]]:
    words = text.split()
    lines: list[tuple[int, str]] = []
    current = ""
    indent = first_indent
    for word in words:
        trial = f"{current} {word}" if current else word
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] <= max_width - indent or not current:
            current = trial
        else:
            lines.append((indent, current))
            indent = 0
            current = word
    if current:
        lines.append((indent, current))
    return lines


def render_paragraphs_page(
    paragraphs: list[str],
    heading: str | None = None,
    font_path: Path = FONT_REGULAR,
    bold_path: Path = FONT_BOLD,
    font_size: int = 32,
    width: int = SCAN_W,
    height: int = SCAN_H,
    mode: str = "L",
) -> Image.Image:
    bg = 252 if mode == "L" else (252, 252, 252)
    fg = 18 if mode == "L" else (18, 18, 18)
    image = Image.new(mode, (width, height), bg)
    draw = ImageDraw.Draw(image)
    body_font = load_font(font_path, font_size)
    head_font = load_font(bold_path, int(font_size * 1.35))
    margin_x = 110
    max_w = width - 2 * margin_x
    y = 140
    if heading:
        draw.text((margin_x, y), heading, fill=fg, font=head_font)
        y += int(font_size * 2.4)
    line_step = int(font_size * 1.48)
    for para in paragraphs:
        wrapped = wrap_paragraph(draw, para, body_font, max_w, first_indent=42)
        for indent, line in wrapped:
            draw.text((margin_x + indent, y), line, fill=fg, font=body_font)
            y += line_step
        y += int(font_size * 0.75)
    return image


def render_cover_image() -> Image.Image:
    """Decorative full-page book cover with bold title painted inside the artwork."""
    img = Image.new("RGB", (SCAN_W, SCAN_H), (28, 52, 88))
    draw = ImageDraw.Draw(img)
    # Border frame and geometric cover emblem
    draw.rectangle((60, 60, SCAN_W - 60, SCAN_H - 60), outline=(228, 198, 128), width=12)
    draw.rectangle((90, 90, SCAN_W - 90, SCAN_H - 90), outline=(180, 150, 92), width=4)
    draw.ellipse((240, 480, 810, 1050), fill=(195, 140, 64), outline=(245, 224, 168), width=10)
    draw.polygon([(525, 530), (740, 920), (310, 920)], fill=(42, 74, 118))
    draw.ellipse((460, 640, 590, 770), fill=(246, 220, 130))
    title_font = load_font(FONT_BOLD, 66)
    sub_font = load_font(FONT_REGULAR, 38)
    draw.text((190, 190), "HARBOUR CHRONICLE", fill=(248, 238, 208), font=title_font)
    draw.text((320, 1180), "COLLECTED EDITION", fill=(232, 212, 165), font=sub_font)
    return img


def render_pure_illustration(width: int = 560, height: int = 360) -> Image.Image:
    """Colorful geometric illustration containing zero text."""
    img = Image.new("RGB", (width, height), (195, 225, 248))
    draw = ImageDraw.Draw(img)
    # Horizon and hills
    draw.rectangle((0, int(height * 0.62), width, height), fill=(92, 152, 86))
    draw.polygon(
        [(0, int(height * 0.65)), (int(width * 0.35), int(height * 0.25)), (int(width * 0.72), int(height * 0.65))],
        fill=(78, 108, 138),
    )
    draw.polygon(
        [(int(width * 0.38), int(height * 0.65)), (int(width * 0.75), int(height * 0.20)), (width, int(height * 0.65))],
        fill=(56, 86, 116),
    )
    # Sun and cottage
    draw.ellipse((int(width * 0.72), 28, int(width * 0.72) + 84, 112), fill=(248, 212, 68), outline=(218, 162, 32), width=4)
    hx = int(width * 0.22)
    hy = int(height * 0.56)
    draw.rectangle((hx, hy, hx + 110, hy + 82), fill=(214, 178, 138), outline=(72, 48, 32), width=4)
    draw.polygon([(hx - 14, hy), (hx + 55, hy - 54), (hx + 124, hy)], fill=(166, 62, 46), outline=(72, 48, 32))
    draw.rectangle((hx + 42, hy + 34, hx + 68, hy + 82), fill=(92, 54, 34))
    draw.rectangle((4, 4, width - 5, height - 5), outline=(45, 55, 68), width=5)
    return img


def render_embedded_text_card(lines: list[str], width: int = 840, height: int = 340) -> Image.Image:
    """Text-bearing raster image placed inside a searchable page (notice / inset box)."""
    img = Image.new("RGB", (width, height), (249, 247, 240))
    draw = ImageDraw.Draw(img)
    draw.rectangle((8, 8, width - 9, height - 9), outline=(70, 70, 70), width=4)
    font = load_font(FONT_REGULAR, 32)
    y = 48
    for line in lines:
        draw.text((42, y), line, fill=(18, 18, 18), font=font)
        y += 54
    return img


def render_noise_image(seed: int = 42) -> Image.Image:
    """High-frequency salt-and-pepper noise containing no legible characters."""
    rng = random.Random(seed)
    img = Image.new("L", (SCAN_W, SCAN_H), 200)
    # Coarse deterministic noise blocks so JPEG doesn't smooth it to flat gray
    block = 12
    draw = ImageDraw.Draw(img)
    for y in range(60, SCAN_H - 60, block):
        for x in range(60, SCAN_W - 60, block):
            v = rng.choice((15, 60, 120, 185, 240))
            draw.rectangle((x, y, x + block - 1, y + block - 1), fill=v)
    return img


# --- prose corpora -------------------------------------------------------------------------------

EN_PAGES: list[tuple[str | None, list[str]]] = [
    ("Chapter One: The Lantern Keeper", [
        "Every morning before sunrise the lantern keeper walked down the stone pier to inspect the brass beacon and trim the linen wick.",
        "Fishing boats drifted quietly past the breakwater while seagulls circled above the wooden crates lined along the harbour wall.",
    ]),
    (None, [
        "In the bakery behind the clock tower, warm loaves of rye bread cooled on pine shelves beside baskets of roasted chestnuts.",
        "Travellers waiting for the coastal ferry gathered near the sheltered archway and exchanged newspapers from the southern provinces.",
    ]),
    (None, [
        "Clara carried her leather satchel across the cobbled square and paused beside the fountain to check the brass pocket compass.",
        "The autumn wind stirred golden maple leaves along the narrow lane leading toward the old maritime observatory on the ridge.",
    ]),
    (None, [
        "Inside the reading room, tall oak bookcases held charts of northern currents, tide tables, and weathered journals bound in canvas.",
        "An astronomer adjusted the brass telescope lens while recording clear barometric pressure readings in a neat ledger notebook.",
    ]),
    (None, [
        "By midday the harbour market grew lively with voices calling out fresh apples, smoked herring, knitted wool scarves, and honey jars.",
        "Carpenters repaired the oak rudder of a merchant schooner while apprentices sorted copper nails beside the timber shed.",
    ]),
    ("Chapter Two: Across the Estuary", [
        "When the afternoon tide turned westward, the ferry captain sounded the brass bell and cast off the heavy hemp mooring lines.",
        "Passengers leaned against the painted railing to watch green headlands and white chalk cliffs glide slowly across the sunlit bay.",
    ]),
    (None, [
        "Farther inland, stone bridges spanned the winding river where willow branches dipped gracefully into the cool clear current.",
        "Farmers stacked bundles of dry hay beneath slate barns before the evening mist settled over the quiet terraced meadows.",
    ]),
    (None, [
        "At the hillside station, a green steam locomotive hissed softly as porters loaded wooden trunks onto the luggage carriage.",
        "The stationmaster checked the silver pocket watch and raised a painted signal lamp as dusk darkened the distant pine forest.",
    ]),
    (None, [
        "Inside the warm dining car, passengers sipped spiced tea and listened to rain tapping steadily against the polished glass windows.",
        "Through the passing twilight, glowing cottage lamps appeared briefly between hedgerows and vanished behind the rolling hills.",
    ]),
    (None, [
        "Late that evening the train reached the stone terminus beside the cathedral square, where quiet carriages waited under amber lamps.",
        "Clara stepped onto the platform, folded her travel map carefully, and smiled at the familiar sound of the midnight bells.",
    ]),
]

RU_PAGES: list[tuple[str | None, list[str]]] = [
    ("Глава первая. Старый маяк", [
        "Каждое утро до рассвета смотритель спускался по каменной лестнице к гавани, чтобы проверить медный фонарь и записать погоду в журнал.",
        "Рыбацкие лодки тихо выходили за мол, а над деревянными причалами кружили белые чайки в прохладном морском воздухе.",
    ]),
    (None, [
        "В небольшой пекарне за часовой башней на сосновых полках остывали свежие караваи ржаного хлеба и сладкие булочки с корицей.",
        "Путники, ожидавшие утренний паром, собирались под каменной аркой и неторопливо обсуждали новости из соседних городов.",
    ]),
    (None, [
        "Мария прошла через мощёную площадь с кожаной сумкой и остановилась у фонтана, чтобы сверить маршрут по старой карте.",
        "Осенний ветер кружил жёлтые кленовые листья вдоль узкой улицы, ведущей к морской обсерватории на высоком холме.",
    ]),
    (None, [
        "В читальном зале стояли высокие дубовые шкафы с атласами северных течений, таблицами приливов и толстыми дневниками капитанов.",
        "Дежурный астроном протирал оптическое стекло телескопа и аккуратно вносил показания барометра в толстую тетрадь.",
    ]),
    (None, [
        "К полудню на рыночной площади становилось шумно: торговцы раскладывали спелые яблоки, свежевыловленную рыбу и баночки душистого мёда.",
        "Плотники чинили дубовый руль торговой шхуны, пока ученики сортировали медные гвозди возле мастерской на берегу.",
    ]),
    ("Глава вторая. Залив на закате", [
        "Когда послеобеденный прилив повернул к западу, капитан парома ударил в бронзовый колокол и отдал толстые пеньковые канаты.",
        "Пассажиры вышли на верхнюю палубу, чтобы полюбоваться зелёными мысами и светлыми утёсами, медленно проплывавшими мимо борта.",
    ]),
    (None, [
        "Дальше от побережья каменные мосты перекинулись через извилистую реку, где ветви старых ив склонялись к прозрачной воде.",
        "Крестьяне убирали связки сухого сена под крыши сараев, пока вечерний туман опускался на тихие прибрежные луга.",
    ]),
    (None, [
        "На небольшой горной станции зелёный паровоз тихо выпускал пар, пока носильщики грузили деревянные сундуки в багажный вагон.",
        "Начальник станции сверил время по серебряным часам и поднял сигнальный фонарь, когда сумерки укрыли сосновый лес.",
    ]),
    (None, [
        "В тёплом вагоне пассажиры пили горячий чай с лимоном и слушали, как мелкий осенний дождь постукивает по оконному стеклу.",
        "За стеклом среди тёмных холмов время от времени вспыхивали уютные жёлтые огоньки далёких сельских домиков.",
    ]),
    (None, [
        "Поздним вечером поезд прибыл на каменный вокзал у соборной площади, где под янтарными фонарями уже ждали извозчики.",
        "Мария вышла на перрон, аккуратно сложила дорожную карту и улыбнулась, услышав знакомый перезвон полуночных часов.",
    ]),
]

DE_PAGES: list[tuple[str | None, list[str]]] = [
    ("Kapitel Eins: Die Alte Bücherei", [
        "Jeden Morgen öffnete der Buchhändler die schwere Holztür an der schmalen Straße und stellte frische Bücher über Geschichte und Natur ins Fenster.",
        "Im Frühling blühten die weißen Bäume entlang des Flusses, während die Schüler mit ihren Taschen über die alte Brücke zur Schule gingen.",
    ]),
    (None, [
        "Nachmittags saßen viele Besucher in dem ruhigen Lesesaal, lasen dicke Romane und machten sorgfältige Notizen für ihre eigenen Arbeiten.",
        "Wenn draußen ein kühler Regen begann, schmeckte der warme Kräutertee am Fenster besonders gut und die Stunden vergingen fast unbemerkt.",
    ]),
]

UK_PAGES: list[tuple[str | None, list[str]]] = [
    ("Розділ перший. Весняний Київ", [
        "Щоранку сонячні промені освітлювали дніпровські схили, а над тихою річкою підіймався легкий туман перед початком нового робочого дня.",
        "У старій міській бібліотеці на дерев'яних полицях зберігалися рідкісні українські книжки, давній літопис та географічні карти України.",
    ]),
    (None, [
        "Читачі приходили сюди ще зранку, гортали пожовклі сторінки видань і обговорювали цікаві історії про подорожі та відомих письменників.",
        "Увечері вздовж затишної вулиці запалювалися ліхтарі, і тепле світло відбивалося у вікнах будинків біля зеленого парку.",
    ]),
]

ROTATED_PARAGRAPHS = [
    "Navigation along the northern coastline required careful attention to the brass compass, the daily tide charts, and every rocky headland.",
    "During the long winter evenings, experienced sailors repaired canvas sails by lantern light while recalling voyages across the open sea.",
    "Before setting out at dawn, the crew checked the fresh water barrels, secured the timber hatch, and studied the wind across the bay.",
    "Clear skies above the lighthouse promised steady passage toward the southern archipelago before the next autumn storm arrived.",
]

GEORGIAN_PARAGRAPHS = [
    "ძველი ქალაქის ქუჩებში ყოველ დილით მზის სხივები ანათებდა ქვის სახურავებს და წყნარ ბაღებს.",
    "მოგზაურები მდინარის ნაპირზე იკრიბებოდნენ, კითხულობდნენ წიგნებს და საუბრობდნენ შორეულ ქვეყნებზე.",
    "საღამოს მთების თავზე ვარსკვლავები გამოჩნდა და ქალაქში თბილი სინათლეები აინთო.",
]


# --- fixture builders ----------------------------------------------------------------------------


def build_scan_series(
    pages_spec: list[tuple[str | None, list[str]]],
    lang: str,
    catalog_lang: str | None = None,
    contains: list[str] | None = None,
) -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    kids = []
    for heading, paragraphs in pages_spec:
        img = render_paragraphs_page(paragraphs, heading=heading)
        kids.append(scan_page(pdf, pages_obj, img))
    pages_tree(pdf, kids, pages_obj)
    lang_entry = f" /Lang ({catalog_lang})" if catalog_lang else ""
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R{lang_entry} >>", catalog)
    return pdf.write(catalog), {
        "pages": len(kids),
        "lang": lang,
        "catalogLang": catalog_lang,
        "contains": contains or [],
    }


def build_scan_rotated() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    # PIL.Image.rotate uses counter-clockwise angles:
    # -90 => rotated 90 CW (needs 270 CW / 90 CCW to restore)
    # 180 => upside-down (180 to restore)
    # 90  => rotated 270 CW / 90 CCW (needs 90 CW to restore)
    base_img = render_paragraphs_page(ROTATED_PARAGRAPHS, heading="Northern Voyages")
    kids = []
    for ccw_angle in (-90, 180, 90):
        rotated = base_img.rotate(ccw_angle, expand=True)
        w = PAGE_H if abs(ccw_angle) == 90 else PAGE_W
        h = PAGE_W if abs(ccw_angle) == 90 else PAGE_H
        kids.append(scan_page(pdf, pages_obj, rotated, width=w, height=h))
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 3,
        "lang": "en",
        "rotations": [90, 180, 270],
        "contains": ["Navigation", "northern", "coastline", "lighthouse", "archipelago"],
    }


def build_garbled_ru() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    f = winansi_fonts(pdf)
    junk = [
        "pc; ekop. l_ta ,11oo;p:tda [{ozlyag-",
        "k|!ig1ovi(!, 11., Bare}!!{evo }1ors. ar\\.",
        "*. t1:t !|os::fa. !1:tzvattt v 1951] g. 1} |!0(\"|'',",
        "1(o3'Rvvs|{F1'F, zal.' Fhotst:oe ttore",
    ]
    kids = []
    for idx in range(2):
        heading, paragraphs = RU_PAGES[idx]
        img = render_paragraphs_page(paragraphs, heading=heading)
        layer = text_lines(junk, x0=54, top=PAGE_H - 92, size=12, lead=20, mode=3)
        kids.append(scan_page(pdf, pages_obj, img, f=f, layer_content=layer))
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 2,
        "lang": "ru",
        "refusalWithoutOcr": "garbled",
        "contains": ["смотритель", "фонарь", "пекарне", "караваи"],
    }


def build_mixed_full() -> tuple[bytes, dict]:
    """6-page mixed book testing every US2 requirement:
    Page 1: Full-page decorative cover (must remain coverpage, zero OCR).
    Page 2: Pure searchable text page (100% verbatim, zero OCR).
    Page 3: Searchable text page + embedded text-bearing raster image (style="ocr-image" + kept <image>)
            + pure geometric illustration (kept <image>, zero OCR).
    Page 4: Scanned page with stray searchable page number "4" (must OCR full page).
    Page 5: Scanned page with English prose + colorful inline illustration in the middle (ocrCrop).
    Page 6: Scanned page with an English block and a Russian block (xml:lang="ru" on foreign block).
    """
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    f = winansi_fonts(pdf)
    kids = []

    # Page 1: Full-page cover
    kids.append(scan_page(pdf, pages_obj, render_cover_image(), quality=78))

    # Page 2: Clean searchable text page
    p2_lines = [
        "Chapter One: Harbour Ledger",
        "  The verbatim searchable opening paragraph explains how ships entered the",
        "inner basin every autumn carrying cedar timber, salt barrels, and wool.",
        "  Harbour clerks recorded every arrival in blue ink before noon and sent",
        "exact manifests to the customs house beside the northern quay.",
    ]
    p2_content = (
        text_lines([p2_lines[0]], x0=42, top=530, size=15, lead=20, font="F2")
        + b"\n"
        + text_lines(p2_lines[1:], x0=42, top=495, size=10.5, lead=15, font="F1")
    )
    kids.append(add_page(pdf, pages_obj, p2_content, font_res(f)))

    # Page 3: Searchable text + embedded text-bearing raster image + pure geometric illustration
    inset_lines = [
        "Notice to Harbour Pilots:",
        "Western channel lanterns remain lit",
        "from sunset until morning fog clears.",
        "Report shoaling depths immediately.",
    ]
    inset_img = render_embedded_text_card(inset_lines, width=840, height=320)
    illus_img = render_pure_illustration(width=560, height=340)
    im_inset = image_obj(pdf, inset_img, quality=80)
    im_illus = image_obj(pdf, illus_img, quality=78)
    p3_top_text = text_lines(
        [
            "  The official harbour bulletin was pasted directly onto the captain's desk",
            "above a watercolour sketch of the coastal lighthouse and meadows.",
        ],
        x0=42, top=540, size=10.5, lead=15,
    )
    # Place inset image at y=340..470, x=42..378 (width 336, height 128)
    # Place pure illustration at y=140..300, x=78..342 (width 264, height 160)
    # Place bottom searchable paragraph at y=95
    p3_bottom_text = text_lines(
        [
            "  All captains acknowledged these harbour regulations before sailing.",
        ],
        x0=42, top=105, size=10.5, lead=15,
    )
    p3_draws = (
        b"q 336 0 0 128 42 342 cm /ImInset Do Q\n"
        b"q 264 0 0 160 78 148 cm /ImIllus Do Q\n"
    )
    p3_res = f"{font_res(f)} /XObject << /ImInset {im_inset} 0 R /ImIllus {im_illus} 0 R >>"
    kids.append(add_page(pdf, pages_obj, p3_top_text + b"\n" + p3_draws + p3_bottom_text, p3_res))

    # Page 4: Scanned page with ONLY a stray searchable page number "4" at the bottom
    p4_img = render_paragraphs_page(
        [
            "Beneath the clock gallery, the watchmaker arranged brass pendulums and silver springs on a green felt tray.",
            "Every chime struck precisely on the hour while rain drummed steadily along the copper gutters outside.",
        ],
        heading="Chapter Two: The Watchmaker",
    )
    p4_stray = text_lines(["4"], x0=206, top=26, size=9, lead=11, mode=0)
    kids.append(scan_page(pdf, pages_obj, p4_img, f=f, layer_content=p4_stray))

    # Page 5: Scanned page combining English prose + distinct colorful inline illustration + English prose
    p5_img = Image.new("RGB", (SCAN_W, SCAN_H), (252, 252, 252))
    draw5 = ImageDraw.Draw(p5_img)
    body_font = load_font(FONT_REGULAR, 32)
    margin_x = 110
    max_w = SCAN_W - 2 * margin_x
    y = 130
    top_para = (
        "Along the eastern meadow stood a small timber cottage overlooking the sunlit hills "
        "and distant blue mountains beyond the valley."
    )
    for indent, line in wrap_paragraph(draw5, top_para, body_font, max_w, first_indent=42):
        draw5.text((margin_x + indent, y), line, fill=(18, 18, 18), font=body_font)
        y += 48
    inline_art = render_pure_illustration(width=660, height=420)
    p5_img.paste(inline_art, ((SCAN_W - inline_art.width) // 2, y + 60))
    y += 60 + inline_art.height + 70
    bot_para = (
        "Travellers frequently sketched this quiet landscape in their notebooks before continuing "
        "along the stone road toward the harbour."
    )
    for indent, line in wrap_paragraph(draw5, bot_para, body_font, max_w, first_indent=42):
        draw5.text((margin_x + indent, y), line, fill=(18, 18, 18), font=body_font)
        y += 48
    kids.append(scan_page(pdf, pages_obj, p5_img, quality=78))

    # Page 6: Scanned page with distinct English paragraph block AND Russian paragraph block
    p6_img = Image.new("L", (SCAN_W, SCAN_H), 252)
    draw6 = ImageDraw.Draw(p6_img)
    y = 140
    en_block = (
        "During the winter exhibition in the northern pavilion, archivists displayed historical "
        "letters, painted sea charts, and brass instruments donated by local captains."
    )
    for indent, line in wrap_paragraph(draw6, en_block, body_font, max_w, first_indent=42):
        draw6.text((margin_x + indent, y), line, fill=18, font=body_font)
        y += 48
    y += 90  # clear vertical break between distinct blocks
    ru_block = (
        "В русском письме из северного порта капитан подробно описал зимнее плавание, "
        "встречный ветер и благополучное возвращение команды в родную гавань."
    )
    for indent, line in wrap_paragraph(draw6, ru_block, body_font, max_w, first_indent=42):
        draw6.text((margin_x + indent, y), line, fill=18, font=body_font)
        y += 48
    kids.append(scan_page(pdf, pages_obj, p6_img))

    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 6,
        "lang": "en",
        "coverPage": 1,
        "searchablePages": [2, 3],
        "ocrFullPages": [4, 5, 6],
        "embeddedOcrImagePage": 3,
        "inlineCropPage": 5,
        "foreignBlock": {"page": 6, "lang": "ru"},
        "contains": [
            "verbatim searchable opening paragraph",
            "Western channel lanterns",
            "watchmaker",
            "timber cottage",
            "northern pavilion",
            "северного порта",
        ],
        "coverTextAbsentFromBody": ["HARBOUR CHRONICLE", "COLLECTED EDITION"],
    }


def build_bilingual_ru_en() -> tuple[bytes, dict]:
    """2-page primarily Russian scan with an English paragraph block on page 2."""
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    kids = []
    # Page 1: Russian
    kids.append(scan_page(pdf, pages_obj, render_paragraphs_page(RU_PAGES[0][1], heading=RU_PAGES[0][0])))
    # Page 2: Russian paragraph + English paragraph
    img = Image.new("L", (SCAN_W, SCAN_H), 252)
    draw = ImageDraw.Draw(img)
    font = load_font(FONT_REGULAR, 32)
    margin_x = 110
    max_w = SCAN_W - 2 * margin_x
    y = 140
    for indent, line in wrap_paragraph(draw, RU_PAGES[1][1][0], font, max_w, first_indent=42):
        draw.text((margin_x + indent, y), line, fill=18, font=font)
        y += 48
    y += 90
    en_para = (
        "An English translator added this explanatory paragraph describing how the coastal ferry "
        "connected the northern harbour with the southern railway station every morning."
    )
    for indent, line in wrap_paragraph(draw, en_para, font, max_w, first_indent=42):
        draw.text((margin_x + indent, y), line, fill=18, font=font)
        y += 48
    kids.append(scan_page(pdf, pages_obj, img))
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 2,
        "lang": "ru",
        "foreignBlock": {"page": 2, "lang": "en"},
        "contains": ["смотритель", "пекарне", "English translator", "southern railway"],
    }


def build_clean_ocr_layer() -> tuple[bytes, dict]:
    """ABBYY-style clean pictureWithLayer scan with full vertical coverage.
    Must NEVER be re-OCR'd: uses distinctive spelling 'recognisedlayer' in the layer
    while the underlying raster shows 'recognizedlayer'.
    """
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    f = winansi_fonts(pdf)
    image_paras = [
        "The existing recognizedlayer inside this scanned volume already holds accurate text across the full height of every page.",
        "Every line sits cleanly behind the page scan so the importer extracts words directly without running optical recognition again.",
        "Archivists preserved this edition carefully after checking each paragraph, heading, and punctuation mark against the original print.",
        "Harbour records from autumn showed calm seas, steady northern winds, and full baskets of fresh bread delivered at sunrise.",
        "Because the searchable text layer covers the body cleanly from top to bottom, no extra recognition pass is needed.",
    ]
    layer_lines = [
        "The existing recognisedlayer inside this scanned volume already",
        "holds accurate text across the full height of every page.",
        "  Every line sits cleanly behind the page scan so the importer",
        "extracts words directly without running optical recognition again.",
        "  Archivists preserved this edition carefully after checking each",
        "paragraph, heading, and punctuation mark against the original print.",
        "  Harbour records from autumn showed calm seas, steady northern",
        "winds, and full baskets of fresh bread delivered at sunrise.",
        "  Because the searchable text layer covers the body cleanly from",
        "top to bottom, no extra recognition pass is needed.",
    ]
    kids = []
    for _ in range(2):
        img = render_paragraphs_page(image_paras)
        # Span y = 510 down to y = 210 (~50% vertical coverage, > 80 words)
        layer = text_lines(layer_lines, x0=44, top=510, size=11, lead=28, mode=3)
        kids.append(scan_page(pdf, pages_obj, img, f=f, layer_content=layer))
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R /Lang (en) >>", catalog)
    return pdf.write(catalog), {
        "pages": 2,
        "ocrUsed": False,
        "contains": ["recognisedlayer"],
        "absent": ["recognizedlayer"],
    }


def build_copy_restricted_scan() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    img = render_paragraphs_page(EN_PAGES[0][1], heading=EN_PAGES[0][0])
    kids = [scan_page(pdf, pages_obj, img)]
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    dictionary, crypt = encryption("", "owner", -20)
    encrypt = pdf.add(dictionary)
    return pdf.write(catalog, encrypt=encrypt, crypt=crypt), {
        "pages": 1,
        "copyForbidden": True,
    }


def build_unreadable_noise() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    kids = [scan_page(pdf, pages_obj, render_noise_image(seed=1337), quality=75)]
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 1,
        "refusal": "ocrUnreadable",
    }


def build_uninstalled_script() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    img = render_paragraphs_page(
        GEORGIAN_PARAGRAPHS,
        font_path=FONT_GEORGIAN,
        bold_path=FONT_GEORGIAN,
        font_size=34,
    )
    kids = [scan_page(pdf, pages_obj, img)]
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 1,
        "script": "Georgian",
        "refusal": "ocrLanguageMissing",
    }


def build_partial_fallback() -> tuple[bytes, dict]:
    pdf = Pdf()
    catalog, pages_obj = pdf.reserve(), pdf.reserve()
    kids = [
        scan_page(pdf, pages_obj, render_paragraphs_page(EN_PAGES[0][1], heading=EN_PAGES[0][0])),
        scan_page(pdf, pages_obj, render_noise_image(seed=9001), quality=75),
    ]
    pages_tree(pdf, kids, pages_obj)
    pdf.add(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>", catalog)
    return pdf.write(catalog), {
        "pages": 2,
        "lang": "en",
        "fallbackPages": [2],
        "contains": ["Lantern", "harbour", "breakwater"],
    }


def build_all() -> dict[str, tuple[bytes, dict]]:
    return {
        "scan-en-10p": build_scan_series(
            EN_PAGES,
            lang="en",
            contains=["lantern", "breakwater", "chestnuts", "observatory", "locomotive", "midnight"],
        ),
        "scan-ru-10p": build_scan_series(
            RU_PAGES,
            lang="ru",
            catalog_lang="en",  # deliberate contradictory scanner metadata
            contains=["смотритель", "пекарне", "обсерватории", "телескопа", "паровоз", "полуночных"],
        ),
        "scan-de": build_scan_series(
            DE_PAGES,
            lang="de",
            contains=["Bücherei", "Buchhändler", "Straße", "Frühling", "Lesesaal", "Kräutertee"],
        ),
        "scan-uk": build_scan_series(
            UK_PAGES,
            lang="uk",
            contains=["Весняний", "Київ", "бібліотеці", "книжки", "України", "письменників"],
        ),
        "scan-rotated": build_scan_rotated(),
        "garbled-ru": build_garbled_ru(),
        "mixed-full": build_mixed_full(),
        "scan-bilingual-ru-en": build_bilingual_ru_en(),
        "clean-ocr-layer": build_clean_ocr_layer(),
        "copy-restricted-scan": build_copy_restricted_scan(),
        "unreadable-noise": build_unreadable_noise(),
        "scan-uninstalled-script": build_uninstalled_script(),
        "scan-partial-fallback": build_partial_fallback(),
    }


def main() -> int:
    check = "--check" in sys.argv
    failed = []
    for name, (data, expected) in build_all().items():
        pdf_path = HERE / f"{name}.pdf"
        json_path = HERE / f"{name}.expected.json"
        text = json.dumps(expected, indent=2, ensure_ascii=False) + "\n"
        if check:
            if not pdf_path.exists() or pdf_path.read_bytes() != data or json_path.read_text(encoding="utf-8") != text:
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

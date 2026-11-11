#!/usr/bin/env python3
"""Regenerates the FB2 fixtures in this folder (T037).

The generated files are committed; run this script only when a fixture needs to change:
    python3 tests/fixtures/books/make-fixtures.py
Images come from tests/fixtures/images/ (tiny 8x6 pictures, < 1 KB each).
"""
from __future__ import annotations

import base64
import colorsys
import json
import math
import pathlib
import re
import struct
import textwrap
import xml.etree.ElementTree as ET
import zlib

HERE = pathlib.Path(__file__).resolve().parent
IMAGES = HERE.parent / "images"

FB_NS = "http://www.gribuser.ru/xml/fictionbook/2.0"
XLINK_NS = "http://www.w3.org/1999/xlink"


def b64(name: str) -> str:
    data = base64.b64encode((IMAGES / name).read_bytes()).decode("ascii")
    return "\n".join(textwrap.wrap(data, 76))


def write(name: str, text: str, encoding: str = "utf-8", bom: bool = False) -> None:
    data = text.encode(encoding)
    if bom:
        data = {"utf-8": b"\xef\xbb\xbf", "utf-16-le": b"\xff\xfe", "utf-16-be": b"\xfe\xff"}[
            encoding
        ] + data
    (HERE / name).write_bytes(data)
    print(f"{name}: {len(data)} bytes ({encoding}{' + BOM' if bom else ''})")


# ----------------------------------------------------------------------------------------------
# legacy-cp1251.fb2 - a 2.0-era file: windows-1251, `xlink` prefix, old description order
# (document-info before title-info, lang before coverpage, date before program-used, year
# before book-name), a notes body with footnotes, cover image, one JPEG binary. Invalid as-is
# (element order), valid FB2 2.1 once the writer normalises the description order.
# ----------------------------------------------------------------------------------------------
LEGACY = f"""<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="{FB_NS}" xmlns:xlink="{XLINK_NS}">
<description>
<document-info>
<author><nickname>Старый конвертер</nickname></author>
<date value="2005-03-01">1 марта 2005</date>
<program-used>FB Tools 2.0</program-used>
<id>legacy-0001</id>
<version>1.1</version>
</document-info>
<title-info>
<genre>prose_classic</genre>
<genre match="50">poetry</genre>
<author>
<first-name>Антон</first-name>
<middle-name>Павлович</middle-name>
<last-name>Чехов</last-name>
</author>
<book-title>Старая книга</book-title>
<annotation><p>Аннотация старой книги — так писали старые конвертеры.</p></annotation>
<lang>ru</lang>
<coverpage><image xlink:href="#cover.jpg"/></coverpage>
<date>1890</date>
<keywords>проза, рассказы</keywords>
</title-info>
<publish-info>
<year>1999</year>
<book-name>Старая книга (бумажное издание)</book-name>
<publisher>Издательство «Пример»</publisher>
<city>Москва</city>
<isbn>5-00000-000-0</isbn>
</publish-info>
</description>
<body>
<title><p>Старая книга</p></title>
<section id="s1">
<title><p>Глава первая</p></title>
<p>Первый абзац с <strong>жирным</strong> и <emphasis>курсивом</emphasis>, а также сноска<a xlink:href="#n_1" type="note">[1]</a>.</p>
<p>Второй абзац: «ёлка», «Ёж», тире — и кавычки.</p>
<empty-line/>
<p>Третий абзац со ссылкой на <a xlink:href="http://example.org/">внешний ресурс</a>.</p>
</section>
<section>
<title><p>Глава вторая</p></title>
<section>
<p>Вложенный раздел без заголовка.</p>
</section>
</section>
</body>
<body name="notes">
<title><p>Примечания</p></title>
<section id="n_1">
<title><p>1</p></title>
<p>Текст первой сноски.</p>
</section>
</body>
<binary id="cover.jpg" content-type="image/jpeg">{b64("tiny.jpg")}
</binary>
</FictionBook>
"""

# ----------------------------------------------------------------------------------------------
# modern-utf8.fb2 - valid FB2 2.1 (checked with xmllint --schema): every body construct the
# model knows, all inline marks, a notes body, PNG and GIF binaries, a stylesheet.
# ----------------------------------------------------------------------------------------------
MODERN = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<stylesheet type="text/css">p {{ text-indent: 1em; }}</stylesheet>
	<description>
		<title-info>
			<genre>sf</genre>
			<genre match="30">adventure</genre>
			<author>
				<first-name>Анна</first-name>
				<middle-name>Петровна</middle-name>
				<last-name>Иванова</last-name>
				<home-page>https://example.org/anna</home-page>
				<email>anna@example.org</email>
				<id>author-1</id>
			</author>
			<author>
				<nickname>Соавтор</nickname>
			</author>
			<book-title>Современная книга</book-title>
			<annotation>
				<p>Аннотация с <emphasis>курсивом</emphasis>.</p>
				<empty-line/>
				<p>Второй абзац аннотации.</p>
			</annotation>
			<keywords>фантастика, приключения</keywords>
			<date value="2020-05-17">май 2020</date>
			<coverpage>
				<image l:href="#cover.png" alt="Обложка"/>
			</coverpage>
			<lang>ru</lang>
			<src-lang>en</src-lang>
			<translator>
				<first-name>Пётр</first-name>
				<last-name>Сидоров</last-name>
			</translator>
			<sequence name="Серия" number="3">
				<sequence name="Подсерия" number="1"/>
			</sequence>
		</title-info>
		<src-title-info>
			<genre>sf</genre>
			<author>
				<first-name>Anna</first-name>
				<last-name>Ivanova</last-name>
			</author>
			<book-title>A Modern Book</book-title>
			<lang>en</lang>
		</src-title-info>
		<document-info>
			<author>
				<nickname>maker</nickname>
				<email>maker@example.org</email>
			</author>
			<program-used>Maxima Fiction Book Editor</program-used>
			<date value="2026-10-12">2026-10-12</date>
			<src-url>https://example.org/source</src-url>
			<src-ocr>OCR by hand</src-ocr>
			<id>9b7f2c9d-1e22-4b0b-9a1e-3f0a4b7e2d31</id>
			<version>2.1</version>
			<history>
				<p>v1.0 — создание файла</p>
				<p>v2.1 — вычитка</p>
			</history>
			<publisher>
				<nickname>Publisher Nick</nickname>
			</publisher>
		</document-info>
		<publish-info>
			<book-name>Современная книга</book-name>
			<publisher>Издательство</publisher>
			<city>Санкт-Петербург</city>
			<year>2021</year>
			<isbn>978-5-00000-000-0</isbn>
			<sequence name="Бумажная серия" number="7"/>
		</publish-info>
		<custom-info info-type="source">corpus fixture</custom-info>
		<custom-info info-type="note" xml:lang="en">English note</custom-info>
	</description>
	<body>
		<image l:href="#cover.png" alt="Обложка" title="Титул"/>
		<title>
			<p>Современная книга</p>
			<empty-line/>
			<p>Подзаголовок книги</p>
		</title>
		<epigraph id="epi1">
			<p>Эпиграф ко всей книге.</p>
			<text-author>Неизвестный автор</text-author>
		</epigraph>
		<section id="ch1" xml:lang="ru">
			<title>
				<p>Глава 1</p>
			</title>
			<epigraph>
				<poem>
					<stanza>
						<v>Строка эпиграфа раз,</v>
						<v>строка эпиграфа два.</v>
					</stanza>
				</poem>
				<text-author>Поэт</text-author>
			</epigraph>
			<annotation>
				<p>Аннотация раздела.</p>
			</annotation>
			<p id="p1" style="lead">Текст с <strong>жирным</strong>, <emphasis>курсивом</emphasis>, <strikethrough>зачёркнутым</strikethrough>, H<sub>2</sub>O, x<sup>2</sup>, <code>code()</code>, <style name="note">именованным стилем</style>, <a l:href="https://example.org/" type="simple">ссылкой</a> и сноской<a l:href="#n_1" type="note">[1]</a>.</p>
			<p>Вложенные стили: <strong>жирный <emphasis>и курсив <strikethrough>и зачёркнутый</strikethrough></emphasis></strong>, <a l:href="#n_2" type="note"><sup>2</sup></a>.</p>
			<subtitle>Подзаголовок</subtitle>
			<p>Абзац с инлайн-картинкой <image l:href="#dot.gif" alt="точка"/> внутри.</p>
			<empty-line/>
			<poem id="poem1">
				<title>
					<p>Стихотворение</p>
				</title>
				<epigraph>
					<p>Эпиграф стихотворения.</p>
				</epigraph>
				<stanza>
					<title>
						<p>Первая строфа</p>
					</title>
					<subtitle>подзаголовок строфы</subtitle>
					<v>Первая строка,</v>
					<v>вторая строка.</v>
				</stanza>
				<subtitle>между строфами</subtitle>
				<stanza>
					<v>Третья строка.</v>
				</stanza>
				<text-author>Автор стихов</text-author>
				<date value="1900-01-01">1900</date>
			</poem>
			<cite id="cite1">
				<p>Цитата.</p>
				<subtitle>Подзаголовок цитаты</subtitle>
				<empty-line/>
				<poem>
					<stanza>
						<v>Стих в цитате.</v>
					</stanza>
				</poem>
				<table>
					<tr>
						<th>Заголовок</th>
					</tr>
					<tr>
						<td>Ячейка в цитате</td>
					</tr>
				</table>
				<text-author>Цитируемый</text-author>
			</cite>
			<table id="t1" style="grid">
				<tr align="center">
					<th id="h1" colspan="2" align="center" valign="middle">Шапка</th>
				</tr>
				<tr>
					<td align="right">1</td>
					<td rowspan="2" valign="bottom">2</td>
				</tr>
				<tr>
					<td style="em">3</td>
				</tr>
			</table>
			<image l:href="#cover.png" alt="Картинка в разделе" title="Подпись" id="img1"/>
			<p>Последний абзац главы.</p>
		</section>
		<section>
			<title>
				<p>Глава 2</p>
			</title>
			<image l:href="#dot.gif"/>
			<section>
				<p>Вложенный раздел A.</p>
			</section>
			<section>
				<p>Вложенный раздел B.</p>
			</section>
		</section>
	</body>
	<body name="notes">
		<title>
			<p>Примечания</p>
		</title>
		<section id="n_1">
			<title>
				<p>1</p>
			</title>
			<p>Первая сноска.</p>
		</section>
		<section id="n_2">
			<title>
				<p>2</p>
			</title>
			<p>Вторая сноска.</p>
		</section>
	</body>
	<binary id="cover.png" content-type="image/png">{b64("tiny.png")}
</binary>
	<binary id="dot.gif" content-type="image/gif">{b64("tiny.gif")}
</binary>
</FictionBook>
"""

# ----------------------------------------------------------------------------------------------
# Small books in other encodings.
# ----------------------------------------------------------------------------------------------


def small_book(encoding_decl: str, title: str, text: str, declaration: bool = True) -> str:
    decl = f'<?xml version="1.0" encoding="{encoding_decl}"?>\n' if declaration else ""
    return f"""{decl}<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Иван</first-name>
				<last-name>Петров</last-name>
			</author>
			<book-title>{title}</book-title>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<date value="2026-01-01">2026</date>
			<id>fixture-{encoding_decl.lower()}</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<section>
			<title>
				<p>{title}</p>
			</title>
			<p>{text}</p>
			<p>Съешь же ещё этих мягких французских булок, да выпей чаю.</p>
		</section>
	</body>
</FictionBook>
"""


UTF16 = small_book("UTF-16", "Книга в UTF-16", "Текст в кодировке UTF-16 с BOM: ёж, Ёлка, Ω нет.")
KOI8R = small_book("KOI8-R", "Книга в KOI8-R", "Текст в кодировке KOI8-R: ёж, Ёлка, линия ─ и ©.")
MISMATCH = small_book("utf-8", "Неверная декларация", "Байты windows-1251, декларация utf-8.")
NODECL = small_book("utf-8", "Без декларации", "UTF-8 без XML-декларации.", declaration=False)

# ----------------------------------------------------------------------------------------------
# malformed.fb2 - the <p> on line 19 is never closed; libxml2 reports "Opening and ending tag
# mismatch: p line 19 and section" at line 20, column 13.
# ----------------------------------------------------------------------------------------------
MALFORMED = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_contemporary</genre>
			<author><first-name>A</first-name><last-name>B</last-name></author>
			<book-title>Malformed</book-title>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author><nickname>fixture</nickname></author>
			<date value="2026-01-01">2026</date>
			<id>fixture-malformed</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<section>
			<p>This paragraph is never closed
		</section>
	</body>
</FictionBook>
"""

# ----------------------------------------------------------------------------------------------
# unknown-elements.fb2 - unknown element + unknown attribute inside a section (one on a known
# element), an unknown inline element, and a top-level unknown element in a foreign namespace.
# ----------------------------------------------------------------------------------------------
UNKNOWN = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}" xmlns:x="urn:example:extension">
	<description>
		<title-info>
			<genre>prose_contemporary</genre>
			<author><first-name>A</first-name><last-name>B</last-name></author>
			<book-title>Unknown elements</book-title>
			<lang>en</lang>
			<x:rating>5</x:rating>
		</title-info>
		<document-info>
			<author><nickname>fixture</nickname></author>
			<date value="2026-01-01">2026</date>
			<id>fixture-unknown</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<section id="s1" x:kind="chapter" data-foo="bar">
			<title><p>Known title</p></title>
			<p>A paragraph with an <x:marker ref="7">unknown inline</x:marker> element.</p>
			<footnote-ref target="n_1" l:href="#n_1">unknown FB2-namespace element</footnote-ref>
			<p>Another paragraph.</p>
		</section>
	</body>
	<x:metadata version="1"><x:item key="a">A</x:item><!-- comment inside --><x:item key="b"/></x:metadata>
</FictionBook>
"""

# ----------------------------------------------------------------------------------------------
# descriptor.fbd - description only (no body, no binaries).
# ----------------------------------------------------------------------------------------------
DESCRIPTOR = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>sci_history</genre>
			<author>
				<first-name>Клио</first-name>
				<last-name>Историк</last-name>
			</author>
			<book-title>Только описание</book-title>
			<annotation>
				<p>Файл-описание без тела.</p>
			</annotation>
			<lang>ru</lang>
			<sequence name="Описания" number="1"/>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>fixture generator</program-used>
			<date value="2026-01-01">2026</date>
			<id>fixture-descriptor</id>
			<version>1.0</version>
		</document-info>
		<publish-info>
			<book-name>Бумажное издание</book-name>
			<year>2001</year>
		</publish-info>
		<custom-info info-type="kind">descriptor</custom-info>
	</description>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# many-sections.fb2 - Find and Replace journeys (feature 002, User Story 5). 48 top-level
# sections, so the Body view shows it in windows (more than 40 sections). The word
# "разыскать" occurs exactly 20 times, in 6 sections spread over the book; two paragraphs hold
# it twice; an inline image stands right before the 3rd occurrence and a picture of its own
# (an element without text) between the paragraphs of section 10. The word appears nowhere else
# (no title, no description field).
# ----------------------------------------------------------------------------------------------
SEARCH_WORD = "разыскать"
MANY_SECTIONS_COUNT = 48
# Section number (1-based) -> paragraphs with the word; "{w}" marks one occurrence, "{img}" the
# inline image and BLOCK_IMAGE a picture between paragraphs.
BLOCK_IMAGE = "{block-img}"
MANY_SECTIONS_HITS = {
    3: [
        "Утром Анна решила {w} старую карту отца.",
        "Карту следовало {w} до вечера, пока не стемнело.",
        "{img} На этой картинке видно, где {w} тайник.",
    ],
    10: [
        "Брат обещал {w} фонарь, а сестра — {w} верёвку.",
        BLOCK_IMAGE,
        "Никто не знал, как {w} дорогу в темноте.",
    ],
    18: [
        "Старик велел {w} колодец за мельницей.",
        "Пришлось {w} его по старым приметам.",
        "Только к полудню удалось {w} тропу.",
        "Осталось {w} ворота в каменной стене.",
    ],
    27: [
        "В городе предстояло {w} аптеку.",
        "Затем — {w} почтовую контору.",
        "И наконец {w} знакомого кузнеца.",
    ],
    36: [
        "Письмо поручало {w} архив и {w} в нём одну папку.",
        "Папку не удалось {w} с первого раза.",
        "Пришлось {w} помощника.",
    ],
    46: [
        "Под конец надо было {w} ключ от сундука.",
        "Анна смогла {w} его в кармане старого пальто.",
        "А брат так и не смог {w} свой фонарь.",
    ],
}
FILLER = [
    "Дорога шла через поле, и ветер гнал по небу низкие облака.",
    "В доме было тихо, только часы на стене отсчитывали время.",
    "Вечером все собрались у окна и долго смотрели на огни города.",
]


def many_sections() -> str:
    occurrences = sum(p.count("{w}") for ps in MANY_SECTIONS_HITS.values() for p in ps)
    assert occurrences == 20, occurrences
    sections = []
    for number in range(1, MANY_SECTIONS_COUNT + 1):
        paragraphs = MANY_SECTIONS_HITS.get(number, []) + FILLER[: 3 - (number % 2)]
        lines = [f'\t\t<section id="s{number}">', f"\t\t\t<title>\n\t\t\t\t<p>Глава {number}</p>\n\t\t\t</title>"]
        for text in paragraphs:
            if text == BLOCK_IMAGE:
                lines.append('\t\t\t<image l:href="#pin.png"/>')
                continue
            text = text.replace("{w}", SEARCH_WORD).replace("{img}", '<image l:href="#pin.png"/>')
            lines.append(f"\t\t\t<p>{text}</p>")
        lines.append("\t\t</section>")
        sections.append("\n".join(lines))
    body = "\n".join(sections)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Поисковая</first-name>
				<last-name>Книга</last-name>
			</author>
			<book-title>Много разделов</book-title>
			<annotation>
				<p>Книга для проверки поиска и замены.</p>
			</annotation>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>fixture generator</program-used>
			<date value="2026-01-01">2026</date>
			<id>fixture-many-sections</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Много разделов</p>
		</title>
{body}
	</body>
	<binary id="pin.png" content-type="image/png">{b64("tiny.png")}
</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# nbsp-layout.fb2 - non-breaking-space marker journeys (feature 002, User Story 6). U+00A0 in
# first-line indented paragraphs, a verse, an epigraph, a section title, the annotation, the
# history and the book title; two in a row; at the start and the end of a paragraph; next to
# an inline image and to links. Real □ ▫ ◦ characters in the text and in a sequence name must
# survive every marker setting.
# ----------------------------------------------------------------------------------------------
NB = " "
NBSP_LAYOUT = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Мария</first-name>
				<last-name>Пробелова</last-name>
			</author>
			<book-title>Неразрывные{NB}пробелы</book-title>
			<annotation>
				<p>Аннотация с{NB}неразрывным пробелом.</p>
			</annotation>
			<lang>ru</lang>
			<sequence name="Серия □ ▫ ◦" number="1"/>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>fixture generator</program-used>
			<date value="2026-01-01">2026</date>
			<id>fixture-nbsp-layout</id>
			<version>1.0</version>
			<history>
				<p>v1.0 — создание{NB}файла</p>
			</history>
		</document-info>
	</description>
	<body>
		<title>
			<p>Неразрывные пробелы</p>
		</title>
		<section id="s1">
			<title>
				<p>Глава{NB}первая</p>
			</title>
			<epigraph>
				<p>Эпиграф с{NB}пробелом.</p>
				<text-author>Автор эпиграфа</text-author>
			</epigraph>
			<p id="p-indent">Первый абзац: до станции 10{NB}км, и ещё{NB}немного пешком.</p>
			<p id="p-double">Два подряд:{NB}{NB}вот они.</p>
			<p id="p-start">{NB}В начале абзаца.</p>
			<p id="p-end">В конце абзаца{NB}</p>
			<p id="p-image">Рядом с картинкой{NB}<image l:href="#pin.png"/>{NB}и после неё.</p>
			<p id="p-link">Рядом со <a l:href="https://example.org/">ссылкой</a>{NB}и{NB}сноской<a l:href="#n_1" type="note">[1]</a>.</p>
			<poem>
				<stanza>
					<v>Строка{NB}стиха,</v>
					<v>вторая строка.</v>
				</stanza>
			</poem>
			<p id="p-real">Настоящие символы: □ квадрат, ▫ малый квадрат, ◦ кружок.</p>
		</section>
	</body>
	<body name="notes">
		<section id="n_1">
			<title>
				<p>1</p>
			</title>
			<p>Сноска.</p>
		</section>
	</body>
	<binary id="pin.png" content-type="image/png">{b64("tiny.png")}
</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# maxlib-roles.fbd, maxlib-roles-edge.fbd, maxlib-roles.expected.json - the Maxima Library's
# role entries (feature 004, User Story 3; resource-formats §14, research R3.5).
#
# Copied 2026-10-20 from the Maxima Library's lookup-service checks
# `/srv/maxima/tests/lookup-service/check-fbd-roles.sh` (lines 29-38),
# `check-fbd-roles-edge-cases.sh`, `check-fbd-roles-repeated.sh`, laid out as `make-archive.sh`
# writes a description; the requester's own work, under the project's licence; no third-party
# material. The layout is the library's: UTF-8, four-space indentation, `custom-info` directly
# under `description` after `<publish-info>`, no body. No XML comment goes into the files
# (comments become preserved extras and would clutter the round-trip comparison).
# ----------------------------------------------------------------------------------------------
MAXLIB_SOURCE_NOTE = (
    "Copied 2026-10-20 from the Maxima Library's lookup-service checks "
    "`/srv/maxima/tests/lookup-service/check-fbd-roles.sh` (lines 29–38), "
    "`check-fbd-roles-edge-cases.sh`, `check-fbd-roles-repeated.sh`, laid out as "
    "`make-archive.sh` writes a description; the requester's own work, under the project's "
    "licence; no third-party material."
)

# The six roles plus the three record numbers of check-fbd-roles.sh:30-38, in that order.
MAXLIB_ROLE_ROWS = [
    ("mlillustrator", "Илюстраторов Илья Ильич"),
    ("mleditor", "Редакторов Роман Романович"),
    ("mlcompiler", "Составителев Семён Семёнович"),
    ("mldesigner", "Оформителев Олег Олегович"),
    ("mlcommentator", "Комментаторов Кузьма Кузьмич"),
    ("mlabouttheauthor", "Оавторов Артём Артёмович"),
    ("mlillustratorid", "4711 Илюстраторов Илья Ильич"),
    ("mleditorid", "4712 Редакторов Роман Романович"),
    ("mlseriesid", "99 Какая-то серия"),
]

# The library's edge cases (check-fbd-roles-edge-cases.sh, check-fbd-roles-repeated.sh) plus
# this feature's (spec User Story 3 and its edge cases), in that order.
MAXLIB_EDGE_ROWS = [
    ("mlillustrator", "Однофамильцев"),  # surname only
    ("mleditor", "Однофамильцев"),  # surname only
    ("mlcompiler", "Ю Ю Ю"),  # every part a single letter
    ("mlcommentator", ""),  # empty -> plain row
    ("mlabouttheauthor", "Первый Второй Третий Четвёртый Пятый"),  # five parts -> plain row
    ("mlillustrator", "Первов Пётр Петрович"),  # two illustrators ...
    ("mlillustrator", "Второв Вадим Вадимович"),  # ... in order
    ("mleditor", "Де_Голль Шарль"),  # `_` for a space inside a part
    ("mldesigner", "Дизайнеров  Данилович"),  # no first name: two spaces
    ("mleditor", "  Пробелов Пётр Петрович "),  # leading / trailing spaces, kept unedited
    ("MlEditor", "Регистров Р Р"),  # another letter case -> plain row
]

MAXLIB_ROLE_BY_INFO_TYPE = {
    "mlillustrator": "illustrator",
    "mleditor": "editor",
    "mlcompiler": "compiler",
    "mldesigner": "designer",
    "mlcommentator": "commentator",
    "mlabouttheauthor": "aboutTheAuthor",
}


def xml_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def maxlib_description(
    title: str,
    author: str,
    rows: list[tuple[str, str]],
    cover: str | None = None,
) -> str:
    """A description laid out as the library's make-archive.sh writes one (lines 100-135)."""
    last, first, middle = (author.split(" ") + ["", ""])[:3]
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">',
        "    <description>",
        "        <title-info>",
        "            <genre>sf</genre>",
        "            <author>",
        f"                <first-name>{xml_escape(first)}</first-name>",
        f"                <middle-name>{xml_escape(middle)}</middle-name>",
        f"                <last-name>{xml_escape(last)}</last-name>",
        "            </author>",
        f"            <book-title>{xml_escape(title)}</book-title>",
    ]
    if cover:
        lines += [
            "            <coverpage>",
            f'                <image l:href="#{cover}"/>',
            "            </coverpage>",
        ]
    lines += [
        "            <lang>ru</lang>",
        "        </title-info>",
        "        <document-info>",
        "            <version>1.0</version>",
        "        </document-info>",
        "        <publish-info>",
        "        </publish-info>",
    ]
    for info_type, text in rows:
        lines.append(
            f'        <custom-info info-type="{xml_escape(info_type)}">{xml_escape(text)}</custom-info>'
        )
    lines.append("    </description>")
    if cover:
        lines.append(f'    <binary id="{cover}" content-type="image/jpeg">{b64("tiny.jpg")}')
        lines.append("</binary>")
    lines.append("</FictionBook>")
    return "\n".join(lines) + "\n"


def maxlib_role_entry(info_type: str, text: str) -> dict | None:
    """The reading of data-model §3.3: None when the row stays a plain Custom info row."""
    role = MAXLIB_ROLE_BY_INFO_TYPE.get(info_type)  # exact letters
    if role is None:
        return None
    stripped = text.strip(" \t\n\r")
    if stripped == "":
        return None
    parts = stripped.split(" ")
    if len(parts) > 3:
        return None
    last, first, middle = (parts + ["", ""])[:3]
    return {
        "role": role,
        "lastName": last.replace("_", " "),
        "firstName": first.replace("_", " "),
        "middleName": middle.replace("_", " "),
    }


def maxlib_expectations(rows: list[tuple[str, str]]) -> dict:
    """`rows` verbatim and in order, the role entries in list order, grouped per role, and the
    plain rows - mirroring the library's assert_person_in_role / assert_role_count lines."""
    entries = []
    plain = []
    roles: dict[str, list[list[str]]] = {}
    for index, (info_type, text) in enumerate(rows):
        entry = maxlib_role_entry(info_type, text)
        if entry is None:
            plain.append({"infoType": info_type, "text": text})
            continue
        entries.append({**entry, "row": index})
        roles.setdefault(entry["role"], []).append(
            [entry["lastName"], entry["firstName"], entry["middleName"]]
        )
    return {
        "rows": [{"infoType": info_type, "text": text} for info_type, text in rows],
        "entries": entries,
        "roles": roles,
        "plainRows": plain,
    }


def maxlib_expected_json() -> str:
    import json

    expected = {
        "source": MAXLIB_SOURCE_NOTE,
        "file": "maxlib-roles.fbd",
        **maxlib_expectations(MAXLIB_ROLE_ROWS),
        "edge": {
            "file": "maxlib-roles-edge.fbd",
            "cover": "cover.jpg",
            **maxlib_expectations(MAXLIB_EDGE_ROWS),
        },
    }
    return json.dumps(expected, ensure_ascii=False, indent=2) + "\n"


# ----------------------------------------------------------------------------------------------
# spelling-scope-ru.fb2 - the spelling scope journeys (feature 004, User Story 9): a Russian
# book whose description carries 30 English words spread over the publisher, the keywords, the
# city, the book name, a plain custom-info row and the src-title-info annotation (never marked:
# the Description view is not checked) and exactly 10 misspelt Russian words - 6 in the body,
# 4 in the title-info annotation (the Body view's annotation block) - listed with their
# structural paths in spelling-scope-ru.expected.json. Every other word is spelt correctly.
# ----------------------------------------------------------------------------------------------
SPELLING_SCOPE_MISSPELLED = [
    # (misspelt, correct, structural path of its paragraph)
    ("диревне", "деревне", "title-info/annotation[1]/p[1]"),
    ("празнику", "празднику", "title-info/annotation[1]/p[1]"),
    ("кортина", "картина", "title-info/annotation[1]/p[2]"),
    ("пашол", "пошёл", "title-info/annotation[1]/p[2]"),
    ("карова", "корова", "body[1]/section[1]/p[1]"),
    ("сабака", "собака", "body[1]/section[1]/p[1]"),
    ("малако", "молоко", "body[1]/section[1]/p[2]"),
    ("Здраствуйте", "Здравствуйте", "body[1]/section[2]/p[1]"),
    ("агурец", "огурец", "body[1]/section[2]/p[2]"),
    ("сонце", "солнце", "body[1]/section[2]/p[2]"),
]
SPELLING_SCOPE_ENGLISH = {
    "publishInfo.publisher": "Example Publishing House",
    "titleInfo.keywords": "spelling, scope, description, fields, check",
    "publishInfo.city": "London",
    "publishInfo.bookName": "The Great Spelling Scope Test",
    "customInfo.0": "imported from the example library catalogue by hand",
    "srcTitleInfo.annotation": "The original English annotation of this little book.",
}
SPELLING_SCOPE = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_contemporary</genre>
			<author>
				<first-name>Пётр</first-name>
				<last-name>Правописанов</last-name>
			</author>
			<book-title>Проверка правописания</book-title>
			<annotation>
				<p>В диревне готовились к празнику.</p>
				<p>На стене висела кортина, и мальчик пашол домой.</p>
			</annotation>
			<keywords>{SPELLING_SCOPE_ENGLISH["titleInfo.keywords"]}</keywords>
			<lang>ru</lang>
			<src-lang>en</src-lang>
		</title-info>
		<src-title-info>
			<genre>prose_contemporary</genre>
			<author>
				<first-name>Джон</first-name>
				<last-name>Смит</last-name>
			</author>
			<book-title>Проверка правописания (оригинал)</book-title>
			<annotation>
				<p>{SPELLING_SCOPE_ENGLISH["srcTitleInfo.annotation"]}</p>
			</annotation>
			<lang>en</lang>
		</src-title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>генератор тестовых файлов</program-used>
			<date value="2026-01-01">2026</date>
			<id>fixture-spelling-scope-ru</id>
			<version>1.0</version>
			<history>
				<p>Первая версия файла.</p>
			</history>
		</document-info>
		<publish-info>
			<book-name>{SPELLING_SCOPE_ENGLISH["publishInfo.bookName"]}</book-name>
			<publisher>{SPELLING_SCOPE_ENGLISH["publishInfo.publisher"]}</publisher>
			<city>{SPELLING_SCOPE_ENGLISH["publishInfo.city"]}</city>
			<year>2026</year>
		</publish-info>
		<custom-info info-type="catalogue">{SPELLING_SCOPE_ENGLISH["customInfo.0"]}</custom-info>
	</description>
	<body>
		<title>
			<p>Проверка правописания</p>
		</title>
		<section id="s1">
			<title>
				<p>Глава первая</p>
			</title>
			<p>Утром на лугу паслась карова, а рядом бегала сабака.</p>
			<p>На столе стояло малако и лежал свежий хлеб.</p>
			<p>Вечером все собрались у окна и долго смотрели на огни города.</p>
		</section>
		<section id="s2">
			<title>
				<p>Глава вторая</p>
			</title>
			<p>Гость сказал: «Здраствуйте!» — и снял шляпу.</p>
			<p>В саду рос агурец, а над домом светило яркое сонце.</p>
		</section>
	</body>
</FictionBook>
"""


def spelling_scope_expected_json() -> str:
    import json

    english_words = sum(
        len([w for w in text.replace(",", " ").replace(".", " ").split() if w])
        for text in SPELLING_SCOPE_ENGLISH.values()
    )
    assert english_words == 30, english_words
    body = [m for m in SPELLING_SCOPE_MISSPELLED if m[2].startswith("body[")]
    annotation = [m for m in SPELLING_SCOPE_MISSPELLED if m[2].startswith("title-info/")]
    assert (len(body), len(annotation)) == (6, 4), (len(body), len(annotation))
    expected = {
        "$comment": (
            "Generated with spelling-scope-ru.fb2 by make-fixtures.py (feature 004, User Story "
            "9): the 10 Russian words the ru_RU dictionary must flag in the Body view - 6 in the "
            "body, 4 in the annotation block - each with its correct spelling and the structural "
            "path of its paragraph, and the 30 English words of the description that must never "
            "be marked (the Description view is not checked)."
        ),
        "lang": "ru",
        "misspelled": [
            {"word": word, "correct": correct, "path": path}
            for word, correct, path in SPELLING_SCOPE_MISSPELLED
        ],
        "bodyCount": len(body),
        "annotationCount": len(annotation),
        "english": {"count": english_words, "fields": SPELLING_SCOPE_ENGLISH},
    }
    return json.dumps(expected, ensure_ascii=False, indent=2) + "\n"


# ----------------------------------------------------------------------------------------------
# empty-annotation-history.fb2 - a present-but-empty `<annotation/>` in title-info and
# `<history xml:lang="ru"/>` in document-info over a one-section body (feature 004, User
# Story 2, FR-010/FR-015): read as present nodes with empty content and written back
# identically. Laid out exactly as the writer writes a document, so the unedited round trip
# is byte-identical.
# ----------------------------------------------------------------------------------------------
EMPTY_ANNOTATION_HISTORY = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_contemporary</genre>
			<author>
				<first-name>Пустая</first-name>
				<last-name>Аннотация</last-name>
			</author>
			<book-title>Пустые элементы</book-title>
			<annotation/>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>fixture generator</program-used>
			<date value="2026-01-01">2026</date>
			<id>fixture-empty-annotation-history</id>
			<version>1.0</version>
			<history xml:lang="ru"/>
		</document-info>
	</description>
	<body>
		<section>
			<title>
				<p>Глава</p>
			</title>
			<p>Единственный абзац.</p>
		</section>
	</body>
</FictionBook>
"""

# ----------------------------------------------------------------------------------------------
# import-full.fbd - a description with every importable entry of feature 004 FR-032 present
# and non-empty (User Story 4): the 11 title-info entries (genres, authors, book title,
# annotation, keywords, date, a cover with its binary, language, source language, translators,
# sequences), two role entries ("Other persons"), a source title info, the 9 document-info
# entries, the 6 publish-info entries, plus three plain custom-info rows (`mlseriesid` and two
# reader types), each its own line: 31 importable entries, the fixture that fills the import
# dialog completely. No body, as a library descriptor.
# ----------------------------------------------------------------------------------------------
IMPORT_FULL = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>sf</genre>
			<genre match="50">adventure</genre>
			<author>
				<first-name>Полина</first-name>
				<middle-name>Петровна</middle-name>
				<last-name>Полнова</last-name>
				<home-page>https://example.org/polnova</home-page>
				<email>polnova@example.org</email>
				<id>author-polnova</id>
			</author>
			<book-title>Полное описание</book-title>
			<annotation>
				<p>Аннотация полного описания.</p>
				<p>Второй абзац аннотации.</p>
			</annotation>
			<keywords>импорт, описание, проверка</keywords>
			<date value="2020-05-17">17 мая 2020</date>
			<coverpage>
				<image l:href="#cover.jpg"/>
			</coverpage>
			<lang>ru</lang>
			<src-lang>en</src-lang>
			<translator>
				<first-name>Тимофей</first-name>
				<last-name>Переводов</last-name>
			</translator>
			<sequence name="Полные серии" number="3">
				<sequence name="Подсерия" number="1"/>
			</sequence>
		</title-info>
		<src-title-info>
			<genre>sf</genre>
			<author>
				<first-name>Paul</first-name>
				<last-name>Fullman</last-name>
			</author>
			<book-title>The Full Description</book-title>
			<annotation>
				<p>The original annotation.</p>
			</annotation>
			<keywords>import, description</keywords>
			<date value="2018-01-01">2018</date>
			<coverpage>
				<image l:href="#cover.jpg"/>
			</coverpage>
			<lang>en</lang>
		</src-title-info>
		<document-info>
			<author>
				<nickname>maker</nickname>
				<email>maker@example.org</email>
			</author>
			<program-used>Maxima FBD Maker</program-used>
			<date value="2026-10-20">2026-10-20</date>
			<src-url>https://example.org/source</src-url>
			<src-url>https://example.org/mirror</src-url>
			<src-ocr>OCR by hand</src-ocr>
			<id>import-full-0001</id>
			<version>1.5</version>
			<history>
				<p>v1.0 — создание файла</p>
				<p>v1.5 — вычитка</p>
			</history>
			<publisher>
				<nickname>Publisher Nick</nickname>
			</publisher>
		</document-info>
		<publish-info>
			<book-name>Полное описание (бумажное издание)</book-name>
			<publisher>Издательство «Полнота»</publisher>
			<city>Москва</city>
			<year>2021</year>
			<isbn>978-5-00000-000-1</isbn>
			<sequence name="Бумажная серия" number="7"/>
		</publish-info>
		<custom-info info-type="mlillustrator">Илюстраторов Илья Ильич</custom-info>
		<custom-info info-type="mleditor">Редакторов Роман Романович</custom-info>
		<custom-info info-type="mlseriesid">99 Какая-то серия</custom-info>
		<custom-info info-type="fbreader">last position 12%</custom-info>
		<custom-info info-type="coolreader">bookmark: chapter 2</custom-info>
	</description>
	<binary id="cover.jpg" content-type="image/jpeg">{b64("tiny.jpg")}
</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# mapping-corpus.fb2 - feature 004 US7: the book of the 50-position corpus of the Body <-> Source
# journey (ui/tests/e2e/fixtures/mapping-positions.json): body text and titles, a notes body, a
# poem, a table, a cite, an epigraph, an annotation with a subtitle, a history, paragraphs with
# `&amp;`, inline marks (nested ones included), a note link, an inline image and an empty line
# before the caret. Every paragraph's text is unique so that the journey can name a Source
# position by a substring of the serialised text.
# ----------------------------------------------------------------------------------------------
MAPPING_CORPUS = f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Карта</first-name>
				<last-name>Позиций</last-name>
			</author>
			<book-title>Книга о позициях</book-title>
			<annotation>
				<p>Аннотация книги о позициях.</p>
				<subtitle>Подзаголовок аннотации</subtitle>
				<p>Второй абзац аннотации с <emphasis>курсивом</emphasis> внутри.</p>
			</annotation>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-20">2026-10-20</date>
			<id>mapping-corpus</id>
			<version>1.0</version>
			<history>
				<p>Создан для проверки переноса позиций.</p>
			</history>
		</document-info>
	</description>
	<body>
		<title>
			<p>Заглавие книги</p>
		</title>
		<section>
			<title>
				<p>Глава первая</p>
			</title>
			<p>Первый абзац первой главы.</p>
			<p>Второй абзац: Иван &amp; Пётр пошли в лес.</p>
			<p>Третий абзац первой главы, десять символов и больше.</p>
			<p><emphasis>Курсив</emphasis> и <strong>жирный</strong> перед &amp; амперсандом, потом текст.</p>
			<p>Абзац со сноской<a l:href="#note1" type="note">1</a> и ссылкой.</p>
			<p>Абзац с картинкой <image l:href="#dot.png"/> внутри текста.</p>
			<empty-line/>
			<p>Абзац с кавычками «ёлочки» и тире — длинное.</p>
			<poem>
				<title>
					<p>Стихи о позициях</p>
				</title>
				<stanza>
					<v>Первая строка стиха</v>
					<v>Вторая строка стиха</v>
				</stanza>
				<text-author>Автор стиха</text-author>
			</poem>
			<table>
				<tr>
					<th>Заголовок А</th>
					<th>Заголовок Б</th>
				</tr>
				<tr>
					<td>Ячейка один</td>
					<td>Ячейка два</td>
				</tr>
			</table>
			<cite>
				<p>Цитата из книги.</p>
				<text-author>Автор цитаты</text-author>
			</cite>
		</section>
		<section>
			<title>
				<p>Глава вторая</p>
			</title>
			<epigraph>
				<p>Эпиграф второй главы.</p>
			</epigraph>
			<p>Абзац второй главы с <strong><emphasis>вложенными</emphasis></strong> выделениями.</p>
			<subtitle>Подзаголовок второй главы</subtitle>
			<p>Последний абзац книги.</p>
		</section>
	</body>
	<body name="notes">
		<title>
			<p>Примечания</p>
		</title>
		<section id="note1">
			<title>
				<p>1</p>
			</title>
			<p>Текст первой сноски.</p>
		</section>
	</body>
	<binary id="dot.png" content-type="image/png">{b64("tiny.png")}</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# ai-selection.fb2 - the book of the AI assistant journeys (feature 005, User Stories 2-5, 7):
# four sections whose titles are in CAPITALS (the title-case instruction of US3); section 1 with
# two consecutive paragraphs holding <emphasis> and a footnote link to the notes body (US2
# scenarios 1-3); section 2 with six consecutive plain paragraphs of more than 300 characters
# each (the split of US2 scenario 6); section 3 with an epigraph and one <p> holding verse lines
# separated by plain line breaks, no <empty-line/> (US5's poem case); a <stylesheet> and two
# JPEG binaries - the ranges the Source view refuses to send and the tags that travel instead of
# bytes (FR-055); and the unique marker sentence of the SC-007 log scan. Schema-valid.
#
# ai-preexisting.fb2 - the same book with one pre-existing schema error: a <title> after the
# first <p> of section 3, so that an insertion before it moves the error without adding one
# (US4 scenario 2, review C3).
# ----------------------------------------------------------------------------------------------
AI_MARKER_SENTENCE = "Фраза-маркер для журнала 005."
AI_LONG_PARAGRAPHS = [
    "Дорога от станции шла сначала вдоль насыпи, потом сворачивала в поле и терялась между "
    "холмами; Анна шла медленно, часто останавливалась и перекладывала чемодан из руки в руку, "
    "потому что ручка резала ладонь, а оставить вещи на станции она не решилась, хотя дежурный "
    "и предлагал запереть их в своей каморке до вечера.",
    "К полудню небо затянуло, и над холмами повис мелкий серый дождь, от которого не спасали ни "
    "платок, ни тонкое пальто; дорога раскисла, чемодан отяжелел, и Анна всерьёз задумалась, не "
    "вернуться ли на станцию, но позади уже не было видно ни водокачки, ни фонаря, а впереди, за "
    "поворотом, вроде бы показалась крыша.",
    "Крыша оказалась старым сараем без дверей, зато с целым навесом, под которым было сухо и "
    "пахло прошлогодним сеном; Анна села на перевёрнутую бочку, достала из кармана хлеб, "
    "завернула ноги в полу пальто и стала ждать, когда дождь кончится, слушая, как капли "
    "барабанят по железу и как где-то далеко лает собака.",
    "Дождь кончился так же внезапно, как начался; из-за туч выглянуло низкое солнце, лужи на "
    "дороге вспыхнули, и всё вокруг — холмы, мокрая трава, покосившийся сарай — стало вдруг "
    "ярким и чистым, будто кто-то протёр стекло; Анна подхватила чемодан и пошла дальше, "
    "стараясь ступать по траве, где не так скользко.",
    "За третьим холмом дорога разделилась: одна колея уходила вниз, к реке, другая поднималась "
    "к лесу, и ни на одной не было ни указателя, ни следа колёс; Анна постояла, вспоминая слова "
    "письма, в котором говорилось про мельницу и мост, выбрала колею к реке и уже через полчаса "
    "услышала впереди шум воды и скрип старого колеса.",
    "Мельница стояла на самом берегу, серая, с заколоченными окнами, и только колесо всё ещё "
    "медленно поворачивалось под напором воды; у крыльца на лавке сидел старик в телогрейке и "
    "чинил сеть, и когда Анна подошла ближе, он поднял голову, посмотрел на неё без всякого "
    "удивления и сказал, что ждал её ещё вчера.",
]
AI_PREEXISTING_TITLE = "\t\t\t<title>\n\t\t\t\t<p>ЛИШНИЙ ЗАГОЛОВОК</p>\n\t\t\t</title>\n"


def ai_selection(preexisting: bool = False) -> str:
    assert all(len(p) > 300 for p in AI_LONG_PARAGRAPHS), [len(p) for p in AI_LONG_PARAGRAPHS]
    long_paragraphs = "\n".join(f"\t\t\t<p>{p}</p>" for p in AI_LONG_PARAGRAPHS)
    stray_title = AI_PREEXISTING_TITLE if preexisting else ""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<stylesheet type="text/css">p {{ text-indent: 1.5em; }}</stylesheet>
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Анна</first-name>
				<last-name>Дорожная</last-name>
			</author>
			<book-title>Книга для помощника</book-title>
			<annotation>
				<p>Четыре главы с заголовками в верхнем регистре, сносками, стихами и картинками.</p>
			</annotation>
			<coverpage>
				<image l:href="#cover.jpg"/>
			</coverpage>
			<lang>ru</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>fixture generator</program-used>
			<date value="2026-10-22">2026-10-22</date>
			<id>fixture-ai-selection</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Книга для помощника</p>
		</title>
		<section id="ch1">
			<title>
				<p>ГЛАВА ПЕРВАЯ. НОЧЬ НА СТАНЦИИ</p>
			</title>
			<p>Поезд пришёл на станцию <emphasis>далеко за полночь</emphasis>, и на перроне не было ни души, кроме сонного дежурного с фонарём<a l:href="#n1" type="note">[1]</a>.</p>
			<p>Анна вышла из вагона, поставила чемодан на мокрые доски и <emphasis>долго</emphasis> смотрела вслед уходящим огням<a l:href="#n2" type="note">[2]</a>.</p>
			<p>Дежурный подошёл, поднял фонарь и спросил, куда ей.</p>
		</section>
		<section id="ch2">
			<title>
				<p>ГЛАВА ВТОРАЯ. ДОРОГА</p>
			</title>
{long_paragraphs}
		</section>
		<section id="ch3">
			<title>
				<p>ГЛАВА ТРЕТЬЯ. ПЕСНЯ</p>
			</title>
			<epigraph>
				<p>Дорога длинна, а песня коротка.</p>
				<text-author>Поговорка</text-author>
			</epigraph>
			<p>Тихо в поле, тихо в роще,
ветер стих, и дремлет сад;
только месяц, бледный, тощий,
смотрит в окна невпопад.</p>
{stray_title}			<p>Эту песню Анна слышала в детстве от бабушки и теперь напевала её вполголоса, шагая по обочине.</p>
		</section>
		<section id="ch4">
			<title>
				<p>ГЛАВА ЧЕТВЁРТАЯ. УТРО</p>
			</title>
			<image l:href="#picture.jpg" alt="Утро у мельницы"/>
			<p>К утру туман над рекой разошёлся, и мельничное колесо остановилось.</p>
			<p>{AI_MARKER_SENTENCE}</p>
		</section>
	</body>
	<body name="notes">
		<title>
			<p>Примечания</p>
		</title>
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>Дежурный по станции — работник, встречающий и отправляющий поезда.</p>
		</section>
		<section id="n2">
			<title>
				<p>2</p>
			</title>
			<p>Огни последнего вагона.</p>
		</section>
	</body>
	<binary id="cover.jpg" content-type="image/jpeg">{b64("tiny.jpg")}
</binary>
	<binary id="picture.jpg" content-type="image/jpeg">{b64("tiny.jpg")}
</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# Feature 006 (table editing) - the fixture books of data-model §16.2 and quickstart §0.2.
#
# The vector tables come from tests/fixtures/tables/grid-vectors.json, hand-written and reviewed
# (contracts/document-model.md §4.14). This block only copies the cases whose `fixture` names a
# book into that book, each after a paragraph "Case <name> (<spec>)"; it never computes an
# expectation of a case. A cell holds its letter in reading order (a, b, c ...), a raw-xml row is
# an unknown <caption> of the FB2 namespace and a raw-xml cell an unknown <col/>.
#
# tables.fb2 is valid FB2 2.1 in whole-book mode (asserted below) and writes every inline content
# in the writer's canonical form - marks nested link > style > strong > emphasis > strikethrough
# > sub > sup > code, formatting with a name or a language around a link it covers wholly, plain
# formatting inside links, adjacent equal formatting joined, nested marks of one kind outer first
# (document-model §2.4, §3.1, §3.2) - so it comes back exactly after a save. Every table that is
# not an irregular vector case is regular (asserted below), so its marked tables are exactly the
# vectors' irregular ones (SC-011).
# ----------------------------------------------------------------------------------------------
GRID_VECTORS = HERE.parent / "tables" / "grid-vectors.json"

# The model attributes the vector writer writes, in the order the core's writer writes them
# (`known_attrs`, core/src/xml/fb2_writer.cpp); unknownAttrs follow verbatim.
VECTOR_TABLE_ATTRS = ("id", "style")
VECTOR_CELL_ATTRS = ("id", "style", "colspan", "rowspan", "align", "valign", "lang")

# The irregular cases of tables.fb2 that stand outside the "Vector tables" section, so that every
# place of FR-058 holds an irregular table (SC-011); every other case of the book stands there.
TABLES_CASE_PLACES = {
    "overlap-from-two-rows-above": "annotation",  # title-info/annotation
    "plural-forms": "src-annotation",  # src-title-info/annotation
    "three-problems": "history",  # document-info/history
    "short-rows-several": "cite",  # the second cite of "Places"
    "short-row-hole": "section-annotation",  # the second section annotation of "Places"
}

# Inline formatting and links: marks of the model, not nodes (the whole-book weight below).
FB2_MARK_ELEMENTS = {"strong", "emphasis", "style", "a", "strikethrough", "sub", "sup", "code"}


def text_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def grid_vector_cases(fixture: str) -> list[dict]:
    """The cases of grid-vectors.json whose `fixture` is `fixture`, in the file's order."""
    data = json.loads(GRID_VECTORS.read_text(encoding="utf-8"))
    assert data["version"] == 1, data["version"]
    return [case for case in data["cases"] if case.get("fixture") == fixture]


def unknown_attr_name(key: str) -> str:
    """An unknownAttrs key as an attribute name: `{namespace}local` of the XML or the xlink
    namespace with its prefix, a plain name as it is."""
    if key.startswith("{"):
        uri, local = key[1:].split("}", 1)
        prefix = {"http://www.w3.org/XML/1998/namespace": "xml", XLINK_NS: "l"}[uri]
        return f"{prefix}:{local}"
    return key


def model_attrs(attrs: dict, known: tuple[str, ...]) -> str:
    """A model node's attributes as XML: the known ones in the writer's order (`lang` as xml:lang,
    spans as decimal integers), then unknownAttrs verbatim."""
    unexpected = set(attrs) - set(known) - {"unknownAttrs"}
    assert not unexpected, unexpected
    out = []
    for name in known:
        if name not in attrs:
            continue
        value = attrs[name]
        if name in ("colspan", "rowspan"):
            assert isinstance(value, int) and not isinstance(value, bool), (name, value)
            value = str(value)
        out.append(f' {"xml:lang" if name == "lang" else name}="{xml_escape(value)}"')
    for key, value in attrs.get("unknownAttrs", {}).items():
        out.append(f' {unknown_attr_name(key)}="{xml_escape(value)}"')
    return "".join(out)


def vector_case(case: dict, depth: int) -> str:
    """One vector case: the paragraph naming it, then its table, indented by `depth` tabs."""
    tab = "\t" * depth
    table = case["table"]
    lines = [
        f"{tab}<p>Case {case['name']} ({text_escape(case['spec'])})</p>",
        f"{tab}<table{model_attrs(table.get('attrs', {}), VECTOR_TABLE_ATTRS)}>",
    ]
    letters = iter("abcdefghijklmnopqrstuvwxyz")
    for row in table["rows"]:
        if isinstance(row, dict):
            assert row == {"type": "raw-xml"}, row
            lines.append(f"{tab}\t<caption>A caption: a child that is no row</caption>")
            continue
        if not row:
            lines.append(f"{tab}\t<tr/>")
            continue
        lines.append(f"{tab}\t<tr>")
        for cell in row:
            kind = cell.get("type", "td")
            if kind == "raw-xml":
                lines.append(f"{tab}\t\t<col/>")
                continue
            assert kind in ("td", "th"), kind
            attrs = model_attrs(cell.get("attrs", {}), VECTOR_CELL_ATTRS)
            lines.append(f"{tab}\t\t<{kind}{attrs}>{next(letters)}</{kind}>")
        lines.append(f"{tab}\t</tr>")
    lines.append(f"{tab}</table>")
    return "\n".join(lines)


def fb2_table(rows: list, depth: int, attrs: str = "") -> str:
    """A table written by hand. A row is a list of cells or a pair (tr attributes, cells); a cell
    is its inline XML (a `td`) or a pair (start tag without the brackets, inline XML), such as
    ('th colspan="2"', "h2")."""
    tab = "\t" * depth
    lines = [f"{tab}<table{attrs}>"]
    for row in rows:
        tr_attrs, cells = row if isinstance(row, tuple) else ("", row)
        lines.append(f"{tab}\t<tr{tr_attrs}>")
        for cell in cells:
            start, content = cell if isinstance(cell, tuple) else ("td", cell)
            lines.append(f"{tab}\t\t<{start}>{content}</{start.split()[0]}>")
        lines.append(f"{tab}\t</tr>")
    lines.append(f"{tab}</table>")
    return "\n".join(lines)


def position_table(rows: int, columns: int, depth: int, attrs: str = "") -> str:
    """A regular table of plain cells holding their positions, r1c1, r1c2 ... (quickstart §0.2)."""
    return fb2_table(
        [[f"r{r}c{c}" for c in range(1, columns + 1)] for r in range(1, rows + 1)], depth, attrs
    )


def span_value(text: str | None) -> int:
    """A span attribute's text as the grid counts it (document-model §4.2): an integer from 1 to
    10^9 as the core's reader parses it (trimmed, base 10), capped by the caller; otherwise 1."""
    try:
        value = int(text.strip()) if text is not None else 1
    except ValueError:
        return 1
    return value if 1 <= value <= 1_000_000_000 else 1


def fb2_table_grid(table: ET.Element) -> dict:
    """The HTML table model's placement of a parsed FB2 table (document-model §4.3 to §4.6): this
    script's check of the tables it writes by hand and the grid of tables-images.expected.json,
    never applied to a vector case. Cells: (row, column, colspan, rowsIn, element), from 0."""
    rows = [tr for tr in table if tr.tag == f"{{{FB_NS}}}tr"]
    taken: set[tuple[int, int]] = set()
    cells = []
    overlaps = past_end = 0
    for r, tr in enumerate(rows):
        column = 0
        for cell in tr:
            if cell.tag not in (f"{{{FB_NS}}}td", f"{{{FB_NS}}}th"):
                continue
            colspan = min(span_value(cell.get("colspan")), 1000)
            rowspan = min(span_value(cell.get("rowspan")), 65534)
            while (r, column) in taken:
                column += 1
            rows_in = min(rowspan, len(rows) - r)
            places = {
                (rr, cc) for rr in range(r, r + rows_in) for cc in range(column, column + colspan)
            }
            overlaps += bool(places & taken)
            past_end += rowspan > len(rows) - r
            taken |= places
            cells.append((r, column, colspan, rows_in, cell))
            column += colspan
    width = max((c[1] + c[2] for c in cells), default=0)
    covered = [len({cc for rr, cc in taken if rr == r}) for r in range(len(rows))]
    return {
        "rows": len(rows),
        "columns": width,
        "cells": cells,
        "regular": overlaps == 0 and past_end == 0 and all(n == width for n in covered),
    }


def check_tables_book(name: str, text: str, irregular: int = 0) -> None:
    """Asserts what quickstart §0.2 promises of a table book: whole-book mode (at most 40
    top-level sections over all bodies and at most 10,000 element nodes, marks being no nodes;
    `isWholeBook`, ui/src/editor/virtualization.ts:281-286), and that every table is regular but
    the vector cases (a table right after a paragraph "Case <name> ...") and exactly `irregular`
    others; a cell whose text starts with a position r<row>c<column> stands there."""
    root = ET.fromstring(text.encode("utf-8"))
    bodies = root.findall(f"{{{FB_NS}}}body")
    sections = sum(len(body.findall(f"{{{FB_NS}}}section")) for body in bodies)
    nodes = sum(
        1
        for body in bodies
        for element in body.iter()
        if element.tag.split("}")[-1] not in FB2_MARK_ELEMENTS
    )
    assert sections <= 40 and nodes <= 10_000, (name, sections, nodes)
    irregular_found = 0
    for parent in root.iter():
        children = list(parent)
        for index, table in enumerate(children):
            if table.tag != f"{{{FB_NS}}}table":
                continue
            before = children[index - 1] if index > 0 else None
            if before is not None and (before.text or "").startswith("Case "):
                continue  # a vector case: grid-vectors.json is its truth
            grid = fb2_table_grid(table)
            irregular_found += not grid["regular"]
            for row, column, _, _, cell in grid["cells"]:
                position = re.match(r"r(\d+)c(\d+)(?!\d)", "".join(cell.itertext()))
                if position:
                    assert (int(position[1]), int(position[2])) == (row + 1, column + 1), (
                        name,
                        table.get("id"),
                        position[0],
                    )
    assert irregular_found == irregular, (name, irregular_found, irregular)
    print(f"{name}: whole-book mode ({sections} sections, {nodes} element nodes)")


def positions(rows: int, columns: int, cells: dict | None = None, row_attrs: dict | None = None):
    """The rows of a table whose cells hold their positions; `cells` replaces the cell at a
    position (row, column), counted from 1, by its fb2_table form, `row_attrs` gives a row its tr
    attributes."""
    cells, row_attrs = cells or {}, row_attrs or {}
    out = []
    for r in range(1, rows + 1):
        row = [cells.get((r, c), f"r{r}c{c}") for c in range(1, columns + 1)]
        out.append((row_attrs[r], row) if r in row_attrs else row)
    return out


def scenario_section(title: str, items: list[tuple]) -> str:
    """A subsection of "Scenario tables": each item is a paragraph naming the scenarios and the
    table they use (rows for fb2_table, with the table's attributes), or a paragraph alone."""
    lines = ["\t\t\t<section>", f"\t\t\t\t<title>\n\t\t\t\t\t<p>{title}</p>\n\t\t\t\t</title>"]
    for paragraph, table in items:
        lines.append(f"\t\t\t\t<p>{paragraph}</p>")
        if table is not None:
            rows, attrs = table
            lines.append(fb2_table(rows, 4, attrs))
    lines.append("\t\t\t</section>")
    return "\n".join(lines)


def scenario_tables() -> str:
    """The "Scenario tables" section of tables.fb2 (quickstart §0.2 "Scenario tables"; the shapes
    of the manual checks of §2 and §4 to §9): only subsections, one per story, so that its title
    is a place where no table may stand (US4 sc.7). A cell named in the notation holds its name,
    every other cell its position r<row>c<column>; every table is regular."""
    us2 = scenario_section(
        "US2",
        [
            (
                "US2 sc.1, sc.8, sc.9, sc.11, manual step 12",
                (
                    positions(3, 3, {(2, 1): ('td id="us2-r2c1"', "r2c1")}, {2: ' align="center"'}),
                    "",
                ),
            ),
            ("US2 sc.2, sc.4", ([[('td rowspan="2"', "a"), "b"], ["c"]], "")),
            (
                "US2 sc.3 and its edge cases",
                (
                    [
                        [("th", "h1"), ('th colspan="2"', "h2")],
                        ["r2c1", "r2c2", ('td align="right"', "r2c3")],
                        ["r3c1", "r3c2", ('td xml:lang="de"', "r3c3")],
                    ],
                    "",
                ),
            ),
            ("US2 sc.5", ([["x", "y"], [('td rowspan="2"', "a"), "b"], ["c"]], "")),
            (
                "US2 sc.6",
                (positions(5, 3, {(3, 2): 'r3c2<a l:href="#us2-note" type="note">[4]</a>'}), ""),
            ),
            ("US2 sc.7 (one row)", (positions(1, 3), "")),
            ("US2 sc.7 (one column)", (positions(3, 1), "")),
            (
                "US2 sc.10",
                (
                    [
                        ["r1c1", "r1c2"],
                        ["r2c1", "r2c2"],
                        [('td rowspan="2"', "m"), "r3c2"],
                        ["r4c2"],
                        ["r5c1", "r5c2"],
                    ],
                    "",
                ),
            ),
        ],
    )
    us4 = scenario_section(
        "US4",
        [
            (
                "US4 sc.1, sc.3 to sc.6, sc.8",
                (positions(4, 4, {(1, 1): ('td id="us4-r1c1"', "r1c1")}), ""),
            ),
            (
                "US4 sc.2",
                (
                    [
                        ["r1c1", "r1c2", "r1c3", "r1c4"],
                        ["r2c1", "r2c2", ('td colspan="2" rowspan="2"', "m")],
                        ["r3c1", "r3c2"],
                        ["r4c1", "r4c2", "r4c3", "r4c4"],
                    ],
                    "",
                ),
            ),
            ("US4 sc.6, sc.8 (the paste target)", (positions(3, 3), "")),
            ("US4 sc.7 and manual step 9: the paragraph after the tables.", None),
        ],
    )
    us5_th = 'th id="us5-r1c1" style="hd" align="right" xml:lang="de"'
    us5_m = 'th id="us5-m" style="hd" colspan="3" rowspan="2" align="center" xml:lang="fr"'
    us5 = scenario_section(
        "US5",
        [
            (
                "US5 sc.1, sc.3 and the block that holds a merged cell",
                (positions(3, 4, {(1, 1): (us5_th, "r1c1"), (1, 2): ""}), ""),
            ),
            ("US5 sc.1 over the full width", (positions(3, 3), "")),
            (
                "US5 sc.2",
                (
                    [
                        ["<strong>r1c1</strong>", '<a l:href="#t-linked">r1c2</a>'],
                        [
                            'r2c1<a l:href="#us5-note" type="note">[5]</a>',
                            '<style name="mark">r2c2</style> <image l:href="#cell.png"/>',
                        ],
                    ],
                    "",
                ),
            ),
            ("US5 sc.4", (positions(2, 2, {(1, 2): ('td id="us5-target"', "r1c2")}), "")),
            ('The cell <a l:href="#us5-target">r1c2</a> of the table above is linked.', None),
            ("US5 sc.5", ([[(us5_m, "m"), "d"], ["e"]], "")),
        ],
    )
    us6_s = 'td id="us6-s" style="wide" colspan="2" align="center" valign="middle" xml:lang="de"'
    us6 = scenario_section(
        "US6",
        [
            (
                "US6 sc.1, sc.3",
                (
                    [
                        [("th", "r1c1"), "r1c2", "r1c3"],
                        [(us6_s, "s"), "r2c3"],
                        ["r3c1", "r3c2", "r3c3"],
                    ],
                    "",
                ),
            ),
            ("US6 sc.2", (positions(3, 3), "")),
            (
                "US6 sc.4",
                (
                    [
                        [("th", "r1c1"), ('th align="left"', "r1c2"), ("th", "r1c3")],
                        (' align="right"', [("th", "r2c1"), ("th", "r2c2"), ("th", "r2c3")]),
                        ["r3c1", "r3c2", "r3c3"],
                    ],
                    "",
                ),
            ),
        ],
    )
    long_sentence = (
        "r2c3 holds a long sentence that wraps over several lines in a narrow window, so that "
        "the cells beside it are taller than their text and show where their vertical alignment "
        "puts it."
    )
    us7 = scenario_section(
        "US7",
        [
            ("US7 sc.1 to sc.4, manual step 7", (positions(4, 3, {(2, 3): long_sentence}), "")),
            (
                "US7 manual step 7 (a header row)",
                (positions(2, 3, {(1, c): ("th", f"r1c{c}") for c in range(1, 4)}), ""),
            ),
        ],
    )
    us8 = scenario_section(
        "US8",
        [
            ("US8 sc.5, sc.6", (positions(3, 4, {(1, 2): ('td id="us8-r1c2"', "r1c2")}), "")),
            ('The cell <a l:href="#us8-r1c2">r1c2</a> of the table above is linked.', None),
        ],
    )
    us9 = f"""			<section>
				<title>
					<p>US9</p>
				</title>
				<section>
					<title>
						<p>US9 sc.1, sc.3, sc.4: a titled section whose only content is a table</p>
					</title>
{position_table(2, 2, 5)}
				</section>
				<section>
{position_table(2, 2, 5)}
				</section>
				<section>
					<title>
						<p>US9 sc.3, sc.4: a table that ends its section</p>
					</title>
					<p>The table below ends the section.</p>
{position_table(2, 2, 5)}
				</section>
				<section>
					<title>
						<p>US9 sc.3 to sc.5: a table that starts the section's text</p>
					</title>
{position_table(2, 2, 5)}
					<p>A paragraph after the table.</p>
				</section>
				<section>
					<title>
						<p>US9 sc.2, sc.5: a paragraph, a table and a paragraph</p>
					</title>
					<p>A paragraph before the table.</p>
{position_table(2, 2, 5)}
					<p>A paragraph after the table.</p>
				</section>
			</section>"""
    subsections = "\n".join([us2, us4, us5, us6, us7, us8, us9])
    return f"""		<section>
			<title>
				<p>Scenario tables</p>
			</title>
{subsections}
		</section>"""


def tables_book() -> str:
    """tables.fb2 (data-model §16.2): the vector tables, tables at every allowed place, the cell
    and inline shapes of FR-020, FR-047, FR-064, FR-065 and FR-067 to FR-069, and the scenario
    tables of user stories 2 and 4 to 9."""
    cases = grid_vector_cases("tables.fb2")
    names = [case["name"] for case in cases]
    assert set(TABLES_CASE_PLACES) <= set(names), set(TABLES_CASE_PLACES) - set(names)
    by_place: dict[str, list[dict]] = {name: [] for name in TABLES_CASE_PLACES.values()}
    by_place["vector-tables"] = []
    for case in cases:
        by_place[TABLES_CASE_PLACES.get(case["name"], "vector-tables")].append(case)

    def place(name: str, depth: int) -> str:
        return "\n".join(vector_case(case, depth) for case in by_place[name])

    picture = '<image l:href="#cell.png"/>'
    linked_picture = f'<a l:href="#t-linked">{picture}</a>'
    bold_picture = f"<strong>{picture}</strong>"
    latin = '<emphasis xml:lang="la">lingua Latina</emphasis>'
    latin_link = '<emphasis xml:lang="la"><a l:href="#t-linked">nexus</a></emphasis>'
    note_in_style = '<style name="2">Are you sure<a l:href="#n2" type="note">[2]</a>?</style>'
    style_in_note = '<a l:href="#n3" type="note"><style>3</style></a>'
    razmer = '<style name="razmer"><style name="razryadka">Chapter</style> I</style>'
    shorttext = '<style name="shorttext"><style name="SpellE">Spelling</style></style>'
    shorttext_link = (
        '<style name="shorttext"><style name="SpellE"><a l:href="#t-linked">linked text</a>'
        "</style></style>"
    )
    two_orders = (
        '<style name="a"><style name="b">x</style></style> '
        '<style name="b"><style name="a">y</style></style>'
    )
    two_languages = '<emphasis xml:lang="la">a <emphasis xml:lang="de">b</emphasis></emphasis>'
    simple_link = '<a l:href="#t-linked" l:type="simple">a simple link</a>'
    simple_picture = '<image l:href="#cell.png" l:type="simple"/>'
    languages = fb2_table(
        [
            [('th xml:lang="de"', "Zelle"), ('th xml:lang="en-GB"', "Colour")],
            [('td xml:lang="uk"', "Клітинка"), ('td xml:lang="la"', "Cella")],
        ],
        3,
    )
    spans = fb2_table(
        [
            (' align="left"', [('td colspan=" 2 "', "r1c1"), ('td colspan="1"', "r1c3")]),
            [('td align="left" valign="top"', "r2c1"), ('td rowspan="1"', "r2c2"), "r2c3"],
        ],
        3,
    )
    headers = fb2_table(
        [
            [("th", "r1c1"), ("th", "r1c2"), ("th", "r1c3")],
            [("th", "r2c1"), "r2c2", "r2c3"],
            [("th", "r3c1"), "r3c2", "r3c3"],
        ],
        3,
    )
    links = fb2_table(
        [
            [("th", picture), ("th", "A named style, a link and a note link")],
            [
                picture,
                '<style name="hd">named</style>, <a l:href="#t-linked">a link</a> and a note'
                '<a l:href="#n1" type="note">[1]</a>',
            ],
        ],
        3,
    )
    pictures = fb2_table([[linked_picture, bold_picture]], 3)
    attributed = fb2_table([[latin, latin_link], [note_in_style, f"A note{style_in_note}"]], 3)
    nested = fb2_table(
        [
            [razmer, shorttext],
            [shorttext_link, two_orders],
            [two_languages, f"{simple_link} {simple_picture}"],
        ],
        3,
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Tables</book-title>
			<annotation>
				<p>The book's annotation holds a regular table and an irregular one.</p>
{position_table(2, 3, 4)}
{place("annotation", 4)}
			</annotation>
			<lang>en</lang>
		</title-info>
		<src-title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Tables (the source book)</book-title>
			<annotation>
				<p>The source book's annotation holds a regular table and an irregular one.</p>
{position_table(2, 3, 4)}
{place("src-annotation", 4)}
			</annotation>
			<lang>en</lang>
		</src-title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-26">2026-10-26</date>
			<id>fixture-tables</id>
			<version>1.0</version>
			<history>
				<p>The history holds a regular table and an irregular one.</p>
{position_table(2, 3, 4)}
{place("history", 4)}
			</history>
		</document-info>
	</description>
	<body>
		<title>
			<p>Tables</p>
			<empty-line/>
			<p>The table fixture of feature 006</p>
		</title>
		<section>
			<title>
				<p>Vector tables</p>
			</title>
{place("vector-tables", 3)}
		</section>
		<section>
			<title>
				<p>Places</p>
			</title>
			<section>
				<title>
					<p>A table first after a title</p>
				</title>
{position_table(2, 2, 4)}
				<p>The table above is the first content element after the title.</p>
			</section>
			<section>
				<title>
					<p>A table right after a poem</p>
				</title>
				<p>A poem, then a table.</p>
				<poem>
					<stanza>
						<v>The first line of the poem,</v>
						<v>the second line of the poem.</v>
					</stanza>
				</poem>
{position_table(2, 3, 4)}
				<p>A paragraph after the table.</p>
			</section>
			<section>
				<title>
					<p>A table in a cite</p>
				</title>
				<p>A cite whose table stands before its text-author line.</p>
				<cite>
					<p>The cite's paragraph.</p>
{position_table(2, 2, 5)}
					<text-author>The cite's author</text-author>
				</cite>
			</section>
			<section>
				<title>
					<p>A table in the cite of an epigraph</p>
				</title>
				<epigraph>
					<cite>
						<p>The paragraph of the epigraph's cite.</p>
{position_table(2, 2, 6)}
						<text-author>The epigraph cite's author</text-author>
					</cite>
				</epigraph>
				<p>The section's text after its epigraph.</p>
			</section>
			<section>
				<title>
					<p>A table alone in a section annotation</p>
				</title>
				<annotation>
{position_table(2, 2, 5)}
				</annotation>
				<p>The section's text after its annotation.</p>
			</section>
			<section>
				<title>
					<p>An irregular table in a cite</p>
				</title>
				<p>A second cite, which holds an irregular table.</p>
				<cite>
{place("cite", 5)}
					<text-author>The second cite's author</text-author>
				</cite>
			</section>
			<section>
				<title>
					<p>An irregular table in a section annotation</p>
				</title>
				<annotation>
{place("section-annotation", 5)}
				</annotation>
				<p>The section's text after its annotation.</p>
			</section>
		</section>
		<section>
			<title>
				<p>Cells and formatting</p>
			</title>
			<p>Cell languages (US7 sc.5; FR-020).</p>
{languages}
			<p>Span values and explicit defaults (FR-047).</p>
{spans}
			<p>A header row and a header column.</p>
{headers}
			<p>A named style, a link, a note link and pictures in cells.</p>
{links}
			<p>A linked picture and a bold picture in cells (FR-067).</p>
{pictures}
			<p>A linked picture {linked_picture} and a bold picture {bold_picture} in a paragraph.</p>
			<p>Formatting with a language, a style around a note link, a style inside a note link (FR-064, FR-068).</p>
{attributed}
			<p>In a paragraph: {latin}, {latin_link}, {note_in_style} and a note{style_in_note}.</p>
			<subtitle>{razmer}</subtitle>
			<p>Nested formatting of one kind (FR-069); a link and a picture with an xlink:type.</p>
{nested}
			<p>In a paragraph: {shorttext}, {shorttext_link}, {two_orders} and {two_languages}.</p>
			<p>A carriage return&#13;in a paragraph (FR-065).</p>
			<p>The table that the links of this section target:</p>
{position_table(1, 2, 3, ' id="t-linked"')}
		</section>
{scenario_tables()}
	</body>
	<body name="notes">
		<title>
			<p>Notes</p>
		</title>
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>The first note.</p>
		</section>
		<section id="n2">
			<title>
				<p>2</p>
			</title>
			<p>The second note.</p>
		</section>
		<section id="n3">
			<title>
				<p>3</p>
			</title>
			<p>The third note.</p>
		</section>
		<section id="us2-note">
			<title>
				<p>4</p>
			</title>
			<p>The note of the US2 sc.6 table: it stays when its only reference goes.</p>
		</section>
		<section id="us5-note">
			<title>
				<p>5</p>
			</title>
			<p>The note of the US5 sc.2 table, whose cells are merged with their formatting.</p>
		</section>
	</body>
	<binary id="cell.png" content-type="image/png">{b64("tiny.png")}
</binary>
</FictionBook>
"""


def tables_invalid_book() -> str:
    """tables-invalid.fb2 (data-model §16.2; research R8.18): well-formed and invalid on purpose,
    with the census's invalid table shapes - an empty tr, spans that are no integer of the
    reader's range, unknown attributes, empty and invalid cell languages, raw-XML children of a
    table and a row, blocks inside cells, a table inside a paragraph, missing pictures - which must
    open, survive and round trip without a crash or a loss (constitution IV)."""
    vectors = "\n".join(vector_case(case, 3) for case in grid_vector_cases("tables-invalid.fb2"))
    unknown = ' class="{0}" cellpadding="{1}" x:hint="{2}"'
    attributes = fb2_table(
        [
            (
                ' xml:lang="de"' + unknown.format("head", "1", "row"),
                [
                    ('th xml:lang=""' + unknown.format("corner", "2", "header"), "r1c1"),
                    ('th xml:lang="de_DE"', "r1c2"),
                ],
            ),
            [
                ('td rowspan="99999999999"', "r2c1"),
                ('td xml:lang="de_DE"' + unknown.format("cell", "3", "data"), "r2c2"),
            ],
        ],
        3,
        unknown.format("grid", "4", "table"),
    )
    blocks = fb2_table(
        [["<p>A paragraph in a cell</p>", "Before an empty line<empty-line/>after it"]], 3
    )
    pictures = fb2_table(
        [['<image l:href="#missing.png"/>', 'A clear image: <image l:href="#undefined"/>']], 3
    )
    nested = "<table><tr><td>r1c1</td><td>r1c2</td></tr></table>"
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}" xmlns:x="urn:mfbe:test">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Invalid tables</book-title>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-26">2026-10-26</date>
			<id>fixture-tables-invalid</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Invalid tables</p>
		</title>
		<section>
			<title>
				<p>Vector tables</p>
			</title>
			<p>This book is invalid on purpose: it must open and round trip without a loss.</p>
{vectors}
		</section>
		<section>
			<title>
				<p>Attributes</p>
			</title>
			<p>A span outside the reader's range, unknown attributes and cell languages.</p>
{attributes}
		</section>
		<section>
			<title>
				<p>Blocks in cells and a table in a paragraph</p>
			</title>
{blocks}
			<p>A paragraph that holds a table: {nested} and goes on after it.</p>
		</section>
		<section>
			<title>
				<p>Missing pictures in cells</p>
			</title>
{pictures}
		</section>
	</body>
</FictionBook>
"""


def tables_placement_book() -> str:
    """tables-placement.fb2 (data-model §16.2; quickstart §1; U18, C25, C26, C79): every container
    and every kind of caret position of FR-004 for the SC-002 sweeps of the Body and the Source
    view. Valid with 0 errors and 0 warnings (real binaries for the heading images, every link
    resolved), and no comment, CDATA section or processing instruction."""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Table placement</book-title>
			<annotation>
				<p>The first paragraph of the book's annotation.</p>
				<p>The second paragraph of the book's annotation.</p>
			</annotation>
			<lang>en</lang>
		</title-info>
		<src-title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Table placement (the source book)</book-title>
			<annotation>
				<p>The first paragraph of the source book's annotation.</p>
				<p>The second paragraph of the source book's annotation.</p>
			</annotation>
			<lang>en</lang>
		</src-title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-26">2026-10-26</date>
			<id>fixture-tables-placement</id>
			<version>1.0</version>
			<history>
				<p>The first paragraph of the history.</p>
				<p>The second paragraph of the history.</p>
			</history>
		</document-info>
	</description>
	<body>
		<title>
			<p>Table placement</p>
		</title>
		<epigraph>
			<p>A paragraph directly in the body's epigraph.</p>
			<cite>
				<p>A paragraph of the cite in the body's epigraph.</p>
				<text-author>The author of the cite in the body's epigraph</text-author>
			</cite>
		</epigraph>
		<section>
			<title>
				<p>Section 1</p>
			</title>
			<p>The paragraph at the start of section 1, with a note<a l:href="#n1" type="note">[1]</a>.</p>
			<p id="p-split" style="lead" xml:lang="en">A paragraph with an id, a style and a language, which an insertion splits.</p>
			<p></p>
			<p>A non-empty paragraph after the empty one.</p>
			<subtitle></subtitle>
			<p>A paragraph in the middle of section 1.</p>
			<poem>
				<title>
					<p>A poem</p>
				</title>
				<stanza>
					<v>The first line of the poem,</v>
					<v>the second line of the poem.</v>
				</stanza>
				<text-author>The poet</text-author>
			</poem>
			<cite>
				<p>The first paragraph of a cite.</p>
				<p>The second paragraph of the cite.</p>
				<text-author>The cited author</text-author>
			</cite>
{position_table(2, 2, 3)}
			<p>The paragraph at the end of section 1.</p>
		</section>
		<section>
			<title>
				<p>Section 2: a heading part and content</p>
			</title>
			<epigraph>
				<p>The first epigraph of section 2.</p>
			</epigraph>
			<epigraph>
				<cite>
					<p>A paragraph of the cite in the second epigraph.</p>
					<text-author>The author of the cite in the epigraph</text-author>
				</cite>
			</epigraph>
			<image l:href="#heading.jpg"/>
			<annotation>
				<cite>
					<p>A paragraph of the cite in the section annotation.</p>
					<text-author>The author of the cite in the annotation</text-author>
				</cite>
			</annotation>
			<p>The first paragraph of the text of section 2, with a note<a l:href="#n2" type="note">[2]</a>.</p>
		</section>
		<section>
			<title>
				<p>Section 3: a heading image without an annotation</p>
			</title>
			<image l:href="#heading.png"/>
			<p>The text of section 3.</p>
		</section>
		<section>
			<title>
				<p>Section 4: a heading image and an annotation</p>
			</title>
			<image l:href="#heading.jpg"/>
			<annotation>
				<p>The annotation of section 4.</p>
			</annotation>
			<p>The text of section 4.</p>
		</section>
		<section>
			<title>
				<p>Section 5: a section that holds subsections</p>
			</title>
			<epigraph>
				<cite>
					<p>A paragraph of the cite in the epigraph of a section with subsections.</p>
					<text-author>The author of the cite in that epigraph</text-author>
				</cite>
			</epigraph>
			<section>
				<title>
					<p>Subsection 5.1</p>
				</title>
				<p>The text of subsection 5.1.</p>
			</section>
			<section>
				<title>
					<p>Subsection 5.2</p>
				</title>
				<p>The text of subsection 5.2.</p>
			</section>
		</section>
	</body>
	<body name="notes">
		<title>
			<p>Notes</p>
		</title>
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>The first note.</p>
		</section>
		<section id="n2">
			<title>
				<p>2</p>
			</title>
			<p>The second note.</p>
		</section>
	</body>
	<binary id="heading.jpg" content-type="image/jpeg">{b64("tiny.jpg")}
</binary>
	<binary id="heading.png" content-type="image/png">{b64("tiny.png")}
</binary>
</FictionBook>
"""


# tables-images.fb2 (research R9.5; data-model §16.2, §9.8; quickstart §0.2 "tables-images.fb2 in
# detail" and §3; decisions 17 to 19; vR9 N1, N3, N5): pictures in cells, each table followed by
# its control, the same table without its pictures, which the layout gates compare it with.
TI_PNGS = [  # (binary id, width, height, transparent ground)
    ("pic-16x16.png", 16, 16, False),
    ("pic-48x48.png", 48, 48, False),
    ("pic-120x90.png", 120, 90, False),
    ("pic-400x300.png", 400, 300, False),
    ("pic-800x600.png", 800, 600, False),
    ("pic-1600x1200.png", 1600, 1200, False),
    ("pic-4000x3000.png", 4000, 3000, False),
    ("pic-2000x2000.png", 2000, 2000, False),
    ("pic-300x3000.png", 300, 3000, False),
    ("pic-64x512.png", 64, 512, False),
    ("pic-3000x100.png", 3000, 100, False),
    ("pic-200x200-alpha.png", 200, 200, True),
]
TI_JPEG = ("pic-8x6.jpg", 8, 6)  # tests/fixtures/images/tiny.jpg
TI_SVG = "banner-3000x100.svg"  # the core does not decode it; the browser shows it (s02)
TI_BROKEN = "not-a-picture.png"  # bytes that are no picture, under image/png (c23)
TI_EXTERNAL = "http://example.org/pictures/external.png"
TI_MISSING_LONG = "missing-" + "a-very-long-reference-to-a-picture-no-binary-of-the-book-holds-" * 2
TI_CONTROL = "Control: the same table without its pictures"
TI_LONG_TEXT = (
    "A long text beside the picture: it runs over several lines in a narrow window, so the table "
    "shares its width between the picture and the words; the picture shrinks with its "
    "proportions while the words wrap, as the automatic table layout does for every table that "
    "fills its text area."
)
TI_LONG_URL = "https://example.org/" + "averylongwebaddresswithoutanyplacewherealinecouldbreak" * 2
TI_GERMAN = "Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft"


def ti_png(width: int, height: int, transparent: bool = False) -> bytes:
    """An 8-bit palette PNG (standard library only) with a frame, both diagonals and a circle on a
    plain ground, so that any distortion of the shown picture is visible; with `transparent` the
    ground is transparent (tRNS)."""
    frame, diagonal, circle = 1, 2, 3  # palette indices; 0 is the ground
    line = max(1, min(width, height) // 40)
    radius = min(width, height) * 0.4
    inner = max(0.0, radius - line)
    raw = bytearray()

    def paint(row: bytearray, start: float, end: float, colour: int) -> None:
        a, b = max(0, math.floor(start)), min(width, math.ceil(end))
        if b > a:
            row[a:b] = bytes([colour]) * (b - a)

    for y in range(height):
        row = bytearray(width)
        dy = y + 0.5 - height / 2
        if abs(dy) < radius:
            outer_x = math.sqrt(radius * radius - dy * dy)
            inner_x = math.sqrt(inner * inner - dy * dy) if abs(dy) < inner else 0.0
            paint(row, width / 2 - outer_x, width / 2 - inner_x, circle)
            paint(row, width / 2 + inner_x, width / 2 + outer_x, circle)
        x0, x1 = y * width / height, (y + 1) * width / height
        paint(row, x0 - line / 2, x1 + line / 2, diagonal)
        paint(row, width - x1 - line / 2, width - x0 + line / 2, diagonal)
        if y < line or y >= height - line:
            paint(row, 0, width, frame)
        else:
            paint(row, 0, line, frame)
            paint(row, width - line, width, frame)
        raw += b"\x00" + row  # filter type 0 for every row

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data)
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    palette = bytes.fromhex("e8eef4" "1f3a5f" "c0392b" "27ae60")
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0)),
            chunk(b"PLTE", palette),
            chunk(b"tRNS", bytes([0])) if transparent else b"",
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )


def ti_svg() -> bytes:
    """The 3000 × 100 SVG banner of s02, drawn like the PNGs."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="100" viewBox="0 0 3000 100">'
        '<rect x="1" y="1" width="2998" height="98" fill="#e8eef4" stroke="#1f3a5f" '
        'stroke-width="2"/>'
        '<path d="M0 0L3000 100M3000 0L0 100" stroke="#c0392b" stroke-width="2"/>'
        '<circle cx="1500" cy="50" r="40" fill="none" stroke="#27ae60" stroke-width="2"/>'
        "</svg>\n"
    ).encode("ascii")


def b64_bytes(data: bytes) -> str:
    return "\n".join(textwrap.wrap(base64.b64encode(data).decode("ascii"), 76))


def img(href: str) -> str:
    """An inline image: `href` is a binary id, or an external address."""
    return f'<image l:href="{href if "://" in href else "#" + href}"/>'


def without_pictures(rows: list) -> list:
    """The rows of a table's control: every picture removed, with one space beside it and the
    formatting or link left empty by it; the attributes and the text stay."""

    def strip(content: str) -> str:
        content = re.sub(r" <image [^>]*/>|<image [^>]*/> ?", "", content)
        empty = r"<(strong|emphasis|strikethrough|sub|sup|code|style|a)\b[^>]*></\1>"
        previous = None
        while previous != content:
            previous, content = content, re.sub(empty, "", content)
        return content.strip()

    out = []
    for row in rows:
        tr_attrs, cells = row if isinstance(row, tuple) else ("", row)
        cells = [(c[0], strip(c[1])) if isinstance(c, tuple) else strip(c) for c in cells]
        out.append((tr_attrs, cells) if tr_attrs else cells)
    return out


def picture_case(table_id: str, rows: list, depth: int) -> str:
    """A table with pictures, the control paragraph, and the control `<id>-ctl`."""
    return "\n".join(
        [
            fb2_table(rows, depth, f' id="{table_id}"'),
            "\t" * depth + f"<p>{TI_CONTROL}</p>",
            fb2_table(without_pictures(rows), depth, f' id="{table_id}-ctl"'),
        ]
    )


def ti_curated_cases() -> list[tuple[str, str, str, list]]:
    """R9's curated cases c01 to c23 and vR9's cases: (table id, placement, title, rows)."""
    p16, p48, p120 = img("pic-16x16.png"), img("pic-48x48.png"), img("pic-120x90.png")
    p400, p800 = img("pic-400x300.png"), img("pic-800x600.png")
    p1600, p4000 = img("pic-1600x1200.png"), img("pic-4000x3000.png")
    p2000, tall, tall2 = img("pic-2000x2000.png"), img("pic-300x3000.png"), img("pic-64x512.png")
    banner, alpha, jpeg = img("pic-3000x100.png"), img("pic-200x200-alpha.png"), img(TI_JPEG[0])
    url_rows = [[p48, TI_LONG_URL], [p16, "A short line"]]
    return [
        ("c01", "section", "a picture-only 1 × 1 table", [[p400]]),
        (
            "c02",
            "section",
            "a photo in a 2 × 2 table",
            [[p800, "A photo of 800 × 600 pixels"], ["The second row", "of a 2 × 2 table"]],
        ),
        ("c03", "section", "picture, text, text", [[p120, "Text beside the picture", "More text"]]),
        (
            "c04",
            "section",
            "a picture column in a catalogue",
            [
                [("th", "Picture"), ("th", "Item"), ("th", "Price")],
                [p48, "A small item", "12.50"],
                [p120, "A larger item", "99.00"],
                [p16, "A tiny item", "0.99"],
            ],
        ),
        (
            "c05",
            "section",
            "ten columns of icons",
            [[p16, p48] * 5, [str(n) for n in range(1, 11)]],
        ),
        (
            "c06",
            "section",
            "pictures in header cells",
            [[("th", alpha), ("th", p48), ("th", "A text header")], ["r2c1", "r2c2", "r2c3"]],
        ),
        (
            "c07",
            "section",
            "a picture under colspan",
            [[('td colspan="2"', p400), "r1c3"], ["r2c1", "r2c2", "r2c3"]],
        ),
        (
            "c08",
            "section",
            "a picture under rowspan",
            [[('td rowspan="2"', p120), "r1c2"], ["r2c2"]],
        ),
        (
            "c09",
            "section",
            "text, a picture and text in one cell",
            [[f"Text, {p48} and text in one cell", "Another cell"]],
        ),
        (
            "c10",
            "section",
            "several pictures in one cell",
            [[f"{p16} {p48} {p120}", "Several pictures in the cell beside"]],
        ),
        (
            "c11",
            "section",
            "pictures in links",
            [
                [
                    f'<a l:href="#c01">{p16}</a>',
                    f'<a l:href="#c02">see {p16} here</a>',
                    f'<a l:href="#c03">{p16} at the start</a>',
                    f'<a l:href="#c04">at the end {p16}</a>',
                ]
            ],
        ),
        (
            "c12",
            "section",
            "align and valign on picture cells",
            [
                [
                    ('td align="center" valign="middle"', p48),
                    ('td align="right" valign="bottom"', alpha),
                    "Words that make the row taller than the pictures beside them.",
                ]
            ],
        ),
        ("c13", "section", "long text beside a photo", [[p4000, TI_LONG_TEXT]]),
        ("c14", "section", "long text beside a banner", [[banner, TI_LONG_TEXT]]),
        (
            "c15",
            "section",
            "tall pictures",
            [[tall, tall2, "Two tall pictures beside this text"]],
        ),
        (
            "c16",
            "section",
            "a banner in a header cell over three columns",
            [[('th colspan="3"', banner)], ["r2c1", "r2c2", "r2c3"]],
        ),
        (
            "c17",
            "section",
            "a missing binary and a very long missing reference",
            [[img("missing.png"), img(TI_MISSING_LONG + ".png"), "Two missing pictures"]],
        ),
        ("c18", "section", "the clear image", [[img("undefined"), "The clear image"]]),
        ("c19", "cite", "a table in a cite", [[p120, "A table in a cite"]]),
        ("c20", "epigraph-cite", "a table in the cite of an epigraph", [[p48, "A table there"]]),
        (
            "c21",
            "annotation",
            "a table in the book's annotation",
            [[p400, "A table in the book's annotation"], ["r2c1", "r2c2"]],
        ),
        (
            "c22",
            "section",
            "a 3 × 3 gallery",
            [[p400, alpha, p2000], [p120, p4000, p48], [p800, jpeg, p1600]],
        ),
        (
            "c23",
            "section",
            "an undecodable binary and an external reference",
            [[img(TI_BROKEN), img(TI_EXTERNAL), "An undecodable and an external picture"]],
        ),
        ("v01", "section", "a picture-only column beside a long web address", url_rows),
        (
            "v05",
            "section",
            "long German and Russian words beside pictures",
            [
                [p48, TI_GERMAN],
                [p16, "превысокомногорассмотрительствующий"],
                [p48, "человеконенавистничество"],
            ],
        ),
        (
            "v20",
            "section",
            "picture-only columns on both sides of a web address",
            [[p48, TI_LONG_URL, p48], [p16, "A short line", p16]],
        ),
        (
            "v08",
            "section",
            "pictures inside formatting and a note link",
            [
                [
                    f"strong <strong>{p16}</strong>",
                    f"emphasis <emphasis>{p16}</emphasis>",
                    f"strikethrough <strikethrough>{p16}</strikethrough>",
                    f"code <code>{p16}</code>",
                ],
                [
                    f"sup <sup>{p16}</sup>",
                    f"sub <sub>{p16}</sub>",
                    f'style <style name="picture">{p16}</style>',
                    f'note <a l:href="#n1" type="note">{p16}</a>',
                ],
            ],
        ),
        ("d01", "annotation", "v01 in the book's annotation", url_rows),
        (
            "s02",
            "section",
            "an SVG banner beside text",
            [[img(TI_SVG), "Text beside an SVG banner of 3000 × 100 that the core cannot decode"]],
        ),
    ]


def ti_sc006_pictures() -> list[str]:
    """The 13 pictures of the SC-006 family, by binary id."""
    return [binary for binary, _, _, _ in TI_PNGS] + [TI_JPEG[0]]


def ti_sc006_id(columns: int, binary: str) -> str:
    return f"sw-{columns:02d}c-{binary.split('.')[0].removeprefix('pic-')}"


def tables_images_book() -> str:
    """tables-images.fb2: R9's curated cases c01 to c23, vR9's cases (v01, v05, v20, v08, d01,
    s02) and the SC-006 family sw-NNc-<picture>: each of the 13 pictures alone in the first cell
    of a 2-row table of NN columns (NN from 1 to 10), a short word in every other cell. Every table
    is regular and followed by its control; 15 binaries."""
    cases = {case[0]: case for case in ti_curated_cases()}

    def section(case_id: str) -> str:
        _, _, title, rows = cases[case_id]
        return (
            f"\t\t<section>\n\t\t\t<title>\n\t\t\t\t<p>{case_id}: {title}</p>\n\t\t\t</title>\n"
            f"{picture_case(case_id, rows, 3)}\n\t\t</section>"
        )

    curated = [section(f"c{n:02d}") for n in range(1, 19)]
    c19 = f"""		<section>
			<title>
				<p>c19: {cases["c19"][2]}</p>
			</title>
			<p>A cite that holds a table with a picture.</p>
			<cite>
{picture_case("c19", cases["c19"][3], 4)}
				<text-author>The cite's author</text-author>
			</cite>
		</section>"""
    c20 = f"""		<section>
			<title>
				<p>c20: {cases["c20"][2]}</p>
			</title>
			<epigraph>
				<cite>
{picture_case("c20", cases["c20"][3], 5)}
					<text-author>The author of the epigraph's cite</text-author>
				</cite>
			</epigraph>
			<p>The section's text after its epigraph.</p>
		</section>"""
    verification = ["\t\t<section>", "\t\t\t<title>\n\t\t\t\t<p>vR9's cases</p>\n\t\t\t</title>"]
    for case_id in ("v01", "v05", "v20", "v08", "s02"):
        verification.append(f"\t\t\t<p>{case_id}: {cases[case_id][2]}.</p>")
        verification.append(picture_case(case_id, cases[case_id][3], 3))
    verification.append("\t\t</section>")
    sc006 = []
    for binary in ti_sc006_pictures():
        lines = [
            "\t\t<section>",
            f"\t\t\t<title>\n\t\t\t\t<p>SC-006: {binary} in tables of 1 to 10 columns</p>\n"
            "\t\t\t</title>",
        ]
        for columns in range(1, 11):
            rows = [[img(binary)] + ["word"] * (columns - 1), ["word"] * columns]
            lines.append(picture_case(ti_sc006_id(columns, binary), rows, 3))
        lines.append("\t\t</section>")
        sc006.append("\n".join(lines))
    body = "\n".join(
        [*curated, c19, c20, section("c22"), section("c23"), "\n".join(verification), *sc006]
    )
    binaries = [(binary, "image/png", ti_png(w, h, alpha)) for binary, w, h, alpha in TI_PNGS]
    binaries += [
        (TI_JPEG[0], "image/jpeg", (IMAGES / "tiny.jpg").read_bytes()),
        (TI_SVG, "image/svg+xml", ti_svg()),
        (TI_BROKEN, "image/png", b"These bytes are no picture.\n"),
    ]
    binary_xml = "\n".join(
        f'\t<binary id="{binary}" content-type="{kind}">{b64_bytes(data)}\n</binary>'
        for binary, kind, data in binaries
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Pictures in tables</book-title>
			<annotation>
				<p>c21: {cases["c21"][2]}.</p>
{picture_case("c21", cases["c21"][3], 4)}
				<p>d01: {cases["d01"][2]}.</p>
{picture_case("d01", cases["d01"][3], 4)}
			</annotation>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-26">2026-10-26</date>
			<id>fixture-tables-images</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Pictures in tables</p>
		</title>
{body}
	</body>
	<body name="notes">
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>The note whose link holds a picture in v08.</p>
		</section>
	</body>
{binary_xml}
</FictionBook>
"""


def preview_size(width: int, height: int, max_width: int = 800) -> list[int]:
    """The size `preview?w=800` serves (decision 19): as stored up to 800 px wide, else scaled as
    `scale_to_fit` does (core/src/images/converter.cpp:156-171; std::lround, at least 1)."""
    if width <= max_width:
        return [width, height]
    factor = max_width / width
    return [max(1, math.floor(width * factor + 0.5)), max(1, math.floor(height * factor + 0.5))]


def tables_images_expected(text: str) -> str:
    """tables-images.expected.json: the pictures' natural and preview sizes, the placeholders,
    each curated and vR9 table's placement, grid and picture cells (rows and columns from 0; a row
    or column "without pictures" is one that no cell holding a picture covers), the SC-006 tables
    and the expected validation warnings."""
    sizes = {binary: (w, h) for binary, w, h, _ in TI_PNGS}
    sizes[TI_JPEG[0]] = TI_JPEG[1:]
    pictures = {
        binary: {"natural": preview_size(w, h), "preview": preview_size(w, h), "decodable": True}
        for binary, (w, h) in sizes.items()
    }
    pictures[TI_SVG] = {"natural": [3000, 100], "preview": None, "decodable": False}
    root = ET.fromstring(text.encode("utf-8"))
    tables = {table.get("id"): table for table in root.iter(f"{{{FB_NS}}}table")}
    href_key = f"{{{XLINK_NS}}}href"
    placeholders = []
    described = {}
    for case_id, placement, _, _ in ti_curated_cases():
        grid = fb2_table_grid(tables[case_id])
        picture_cells = []
        rows_with, columns_with = set(), set()
        for row, column, colspan, rows_in, cell in grid["cells"]:
            hrefs = [image.get(href_key) for image in cell.iter(f"{{{FB_NS}}}image")]
            if not hrefs:
                continue
            picture_cells.append({"row": row, "col": column, "hrefs": hrefs})
            rows_with.update(range(row, row + rows_in))
            columns_with.update(range(column, column + colspan))
            for href in hrefs:
                binary = href[1:] if href.startswith("#") else None
                kind = (
                    "external"
                    if binary is None
                    else "clear"
                    if binary == "undefined"
                    else "undecodable"
                    if binary == TI_BROKEN
                    else None
                    if binary in pictures
                    else "missing"
                )
                if kind:
                    placeholders.append({"table": case_id, "href": href, "kind": kind})
        described[case_id] = {
            "placement": placement,
            "rows": grid["rows"],
            "cols": grid["columns"],
            "rowsWithoutPictures": [r for r in range(grid["rows"]) if r not in rows_with],
            "colsWithoutPictures": [c for c in range(grid["columns"]) if c not in columns_with],
            "pictureCells": picture_cells,
        }
    sc006 = {
        ti_sc006_id(columns, binary): {"columns": columns, "picture": binary}
        for binary in ti_sc006_pictures()
        for columns in range(1, 11)
    }
    assert all(table_id in tables and f"{table_id}-ctl" in tables for table_id in sc006)
    warnings = {
        "image.missingBinary": sum(p["kind"] in ("missing", "clear") for p in placeholders),
        "image.externalHref": sum(p["kind"] == "external" for p in placeholders),
        "binary.notImage": sum(p["kind"] == "undecodable" for p in placeholders) + 1,  # + the SVG
    }
    assert warnings == {"image.missingBinary": 3, "image.externalHref": 1, "binary.notImage": 2}
    expected = {
        "$comment": (
            "Generated with tables-images.fb2 by make-fixtures.py (feature 006, research R9.5): "
            "per picture its natural size - the size preview?w=800 serves for a picture the core "
            "decodes, the SVG's own size for s02 - its preview size and whether the core decodes "
            "it; the placeholders; per curated and vR9 table its placement, its grid and its "
            "picture cells, rows and columns counted from 0; the SC-006 tables; and the warnings "
            "mfbe-core validate gives. not-a-picture.png is no picture: only a placeholder."
        ),
        "pictures": pictures,
        "placeholders": placeholders,
        "tables": described,
        "sc006": sc006,
        "warnings": warnings,
    }
    return json.dumps(expected, ensure_ascii=False, indent=2) + "\n"


def ai_tables_book() -> str:
    """ai-tables.fb2 (research R7.12; contracts/ai-catalogue.md Δ§9.1; quickstart §11): tables 1
    to 3 in sections 1 to 3 (body[1]/section[n]/table[1], the manual check's T1 to T3) and table
    4 in the book's annotation. Table 1, 4 × 3: a header cell over two columns, a cell over two
    rows, an inline image, a cell with xml:lang, a cell whose id the paragraph after the table
    links to, and the plain block of rows 2-3 × columns 1-2 (US11 sc.6). Table 2, 300 × 10 with a
    header row, every cell its position (SC-010). Table 3, irregular by a short row (repair).
    Table 4, a regular 2 × 2 table (the Description view)."""
    first = fb2_table(
        [
            [('th colspan="2"', "h1"), ("th", "h3")],
            ["r2c1", "r2c2", ('td rowspan="2"', "m")],
            ["r3c1", "r3c2"],
            [img("picture.png"), ('td xml:lang="de"', "r4c2"), ('td id="ai-linked"', "r4c3")],
        ],
        3,
    )
    large = fb2_table(positions(300, 10, {(1, c): ("th", f"r1c{c}") for c in range(1, 11)}), 3)
    ragged = fb2_table([["a", "b", "c"], ["d", "e"], ["f", "g", "h"]], 3)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Table</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Tables for the assistant</book-title>
			<annotation>
				<p>The book's annotation holds table 4.</p>
{position_table(2, 2, 4)}
			</annotation>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-26">2026-10-26</date>
			<id>fixture-ai-tables</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Tables for the assistant</p>
		</title>
		<section>
			<title>
				<p>Table 1</p>
			</title>
{first}
			<p>This paragraph links to the cell <a l:href="#ai-linked">r4c3</a> of table 1.</p>
		</section>
		<section>
			<title>
				<p>Table 2</p>
			</title>
{large}
		</section>
		<section>
			<title>
				<p>Table 3</p>
			</title>
{ragged}
		</section>
	</body>
	<binary id="picture.png" content-type="image/png">{b64("tiny.png")}
</binary>
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# Feature 007 (US6, US7; tasks T003, T099, T106, T107): pictures at their natural size.
# inline-pictures.fb2 - a 572 x 603 JPEG and a 16 x 16 PNG as inline pictures in every place a
#   paragraph can hold one, the description's annotation and history included, plus one picture
#   in a table cell and one block picture;
# picture-view.fb2 - the binaries of the picture view: small.jpg (572 x 603), big.jpg
#   (3000 x 4000), scan.tif (a TIFF, which the engine does not show) and blob.bin (undecodable);
# many-inline-pictures.fb2 - 300 distinct inline pictures of 800 x 600 in 300 paragraphs.
# ----------------------------------------------------------------------------------------------

# The DC table of JPEG Annex K.3, used for every component. The AC table holds the end-of-block
# code alone, since every block of these pictures is one flat colour.
JPEG_DC_BITS = bytes([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
JPEG_DC_VALUES = bytes(range(12))
PHOTO = ("photo-572x603.jpg", 572, 603)
ICON = ("icon-16x16.png", 16, 16)
PV_SMALL = ("small.jpg", 572, 603)
PV_BIG = ("big.jpg", 3000, 4000)
PV_SCAN = ("scan.tif", 640, 480)
PV_BLOB = "blob.bin"
MANY_PICTURES = 300
MANY_SIZE = (800, 600)
MANY_PER_SECTION = 30


def flat_jpeg(width: int, height: int, colour_at) -> bytes:
    """A baseline JPEG (standard library only) made of 8 x 8 blocks of one colour each: YCbCr
    4:4:4, every block holding its DC coefficient alone, quantised by 8. `colour_at(x, y)` gives
    the (r, g, b) of the block whose top-left pixel is (x, y)."""
    codes, code, k = {}, 0, 0
    for length in range(1, 17):
        for _ in range(JPEG_DC_BITS[length - 1]):
            codes[JPEG_DC_VALUES[k]] = (code, length)
            code, k = code + 1, k + 1
        code <<= 1
    data = bytearray()
    acc = nbits = 0

    def put(value: int, length: int) -> None:
        nonlocal acc, nbits
        acc, nbits = (acc << length) | value, nbits + length
        while nbits >= 8:
            nbits -= 8
            byte = (acc >> nbits) & 0xFF
            data.append(byte)
            if byte == 0xFF:
                data.append(0)  # byte stuffing
        acc &= (1 << nbits) - 1

    previous = [0, 0, 0]
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            r, g, b = colour_at(x, y)
            ycc = (
                0.299 * r + 0.587 * g + 0.114 * b,
                -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
                0.5 * r - 0.418688 * g - 0.081312 * b + 128,
            )
            for component, value in enumerate(ycc):
                dc = max(-128, min(127, round(value) - 128))  # (8 x mean) / 8
                diff, previous[component] = dc - previous[component], dc
                size = abs(diff).bit_length()
                put(*codes[size])
                if size:
                    put(diff if diff > 0 else diff + (1 << size) - 1, size)
                put(0, 1)  # end of block, the AC table's only code
    if nbits:
        put((1 << (8 - nbits)) - 1, 8 - nbits)

    def segment(marker: int, body: bytes) -> bytes:
        return struct.pack(">HH", 0xFF00 | marker, len(body) + 2) + body

    components = b"".join(bytes([c, 0x11, 0]) for c in (1, 2, 3))
    return b"".join(
        [
            b"\xff\xd8",
            segment(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"),
            segment(0xDB, b"\x00" + bytes([8]) * 64),
            segment(0xC0, struct.pack(">BHHB", 8, height, width, 3) + components),
            segment(
                0xC4,
                b"\x00" + JPEG_DC_BITS + JPEG_DC_VALUES + b"\x10" + bytes([1] + [0] * 15) + b"\x00",
            ),
            segment(0xDA, b"\x03" + b"".join(bytes([c, 0]) for c in (1, 2, 3)) + b"\x00\x3f\x00"),
            bytes(data),
            b"\xff\xd9",
        ]
    )


def picture_pattern(width: int, height: int, ground, frame, diagonal, circle, line: int = 8):
    """`colour_at(x, y)` of a picture with a frame, both diagonals and a circle on a plain ground,
    like ti_png's, judged at the centre of the 8 x 8 block (or pixel) whose corner is (x, y)."""
    radius, diagonal_length = min(width, height) * 0.4, math.hypot(width, height)

    def colour_at(x: int, y: int):
        cx, cy = x + 4, y + 4
        if x < line or y < line or x + line >= width or y + line >= height:
            return frame
        across = abs(cy * width - cx * height) / diagonal_length
        down = abs(cy * width - (width - cx) * height) / diagonal_length
        if min(across, down) < line * 0.75:
            return diagonal
        if abs(math.hypot(cx - width / 2, cy - height / 2) - radius) < line * 0.75:
            return circle
        return ground

    return colour_at


def deflate_tiff(width: int, height: int, colour_at) -> bytes:
    """A baseline RGB TIFF in one Deflate-compressed strip (compression 8), little-endian."""
    rows = bytearray()
    for y in range(height):
        for x in range(width):
            rows += bytes(colour_at(x, y))
    strip = zlib.compress(bytes(rows), 9)
    short, long_, rational = 3, 4, 5
    entries = 13
    extra = 8 + 2 + entries * 12 + 4  # BitsPerSample, then the two resolutions, then the strip
    bits_at, xres_at, yres_at, strip_at = extra, extra + 6, extra + 14, extra + 22

    def entry(tag: int, kind: int, count: int, value: int) -> bytes:
        if kind == short and count == 1:
            return struct.pack("<HHIHH", tag, kind, count, value, 0)
        return struct.pack("<HHII", tag, kind, count, value)

    ifd = b"".join(
        [
            struct.pack("<H", entries),
            entry(256, long_, 1, width),
            entry(257, long_, 1, height),
            entry(258, short, 3, bits_at),
            entry(259, short, 1, 8),  # Adobe Deflate
            entry(262, short, 1, 2),  # RGB
            entry(273, long_, 1, strip_at),
            entry(277, short, 1, 3),
            entry(278, long_, 1, height),
            entry(279, long_, 1, len(strip)),
            entry(282, rational, 1, xres_at),
            entry(283, rational, 1, yres_at),
            entry(284, short, 1, 1),  # chunky
            entry(296, short, 1, 2),  # inches
            struct.pack("<I", 0),
        ]
    )
    return b"".join(
        [
            b"II" + struct.pack("<HI", 42, 8),
            ifd,
            struct.pack("<HHH", 8, 8, 8),
            struct.pack("<II", 300, 1) * 2,
            strip,
        ]
    )


def frame_png(width: int, height: int, ground, frame, line: int = 4) -> bytes:
    """A palette PNG of a plain ground in a frame: an 800 x 600 one compresses to under 1 KB, so
    that 300 distinct pictures fit a small fixture."""
    edge = b"\x00" + bytes([1]) * width
    middle = b"\x00" + bytes([1]) * line + bytes(width - 2 * line) + bytes([1]) * line
    raw = edge * line + middle * (height - 2 * line) + edge * line

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0)),
            chunk(b"PLTE", bytes(ground) + bytes(frame)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def hue_colour(index: int, count: int, saturation: float, value: float) -> tuple[int, int, int]:
    """The colour of hue index / count (HSV), so that every picture of a set differs."""
    return tuple(round(c * 255) for c in colorsys.hsv_to_rgb(index / count, saturation, value))


PHOTO_COLOURS = ((0xE8, 0xEE, 0xF4), (0x1F, 0x3A, 0x5F), (0xC0, 0x39, 0x2B), (0x27, 0xAE, 0x60))


def photo_jpeg(width: int, height: int) -> bytes:
    return flat_jpeg(width, height, picture_pattern(width, height, *PHOTO_COLOURS))


def binaries_xml(binaries: list[tuple[str, str, bytes]]) -> str:
    return "\n".join(
        f'\t<binary id="{binary}" content-type="{kind}">{b64_bytes(data)}\n</binary>'
        for binary, kind, data in binaries
    )


def inline_pictures_book() -> str:
    """inline-pictures.fb2 (T003, T106): every paragraph that holds a picture has an id, which
    names the place, for the journeys."""
    photo, icon = img(PHOTO[0]), img(ICON[0])
    cell = fb2_table([[f"{photo} A picture in a table cell", "The next cell"]], 3, ' id="cell"')
    binaries = binaries_xml(
        [
            (PHOTO[0], "image/jpeg", photo_jpeg(PHOTO[1], PHOTO[2])),
            (ICON[0], "image/png", ti_png(ICON[1], ICON[2])),
        ]
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Picture</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Inline pictures</book-title>
			<annotation>
				<p id="annotation">The annotation holds a photo {photo} and an icon {icon} in its text.</p>
			</annotation>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-31">2026-10-31</date>
			<id>fixture-inline-pictures</id>
			<version>1.0</version>
			<history>
				<p id="history">The history holds a photo {photo} in its text.</p>
			</history>
		</document-info>
	</description>
	<body>
		<title>
			<p>Inline pictures</p>
		</title>
		<section>
			<title>
				<p id="title">A title with a photo {photo} and an icon {icon}</p>
			</title>
			<epigraph>
				<p id="epigraph">An epigraph with a photo {photo} in its text.</p>
			</epigraph>
			<p id="alone">{photo}</p>
			<p id="running">Running text before the photo {photo} and after it, then an icon {icon} in the middle of a sentence that goes on long enough to wrap in a narrow window.</p>
			<p id="first-child">{photo} The paragraph starts with the photo: no indent, and no horizontal scroll bar.</p>
			<p id="icon-alone">{icon}</p>
			<p id="sup">A superscript picture<sup>{icon}</sup> and a superscript photo<sup>{photo}</sup> in the text.</p>
			<p id="note-link">A note link that holds a picture<a l:href="#n1" type="note">{icon}</a> and one that holds a photo<a l:href="#n2" type="note">{photo}</a>.</p>
			<poem>
				<stanza>
					<v id="poem">A verse with a photo {photo} in it</v>
					<v>and a verse with no picture.</v>
				</stanza>
			</poem>
			<cite>
				<p id="cite">A cite with a photo {photo} in its text.</p>
			</cite>
{cell}
			<p>A block picture follows.</p>
			<image l:href="#{PHOTO[0]}" id="block"/>
			<p id="last">The last paragraph.</p>
		</section>
	</body>
	<body name="notes">
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>The note whose link holds an icon.</p>
		</section>
		<section id="n2">
			<title>
				<p>2</p>
			</title>
			<p>The note whose link holds a photo.</p>
		</section>
	</body>
{binaries}
</FictionBook>
"""


def picture_view_book() -> str:
    """picture-view.fb2 (T003, T099): each picture once in the body; blob.bin is referenced by
    none."""
    small, big, scan = PV_SMALL, PV_BIG, PV_SCAN
    scan_colours = ((0xF4, 0xEC, 0xD8), (0x5A, 0x3E, 0x1B), (0x8E, 0x44, 0xAD), (0x16, 0xA0, 0x85))
    scan_pattern = picture_pattern(scan[1], scan[2], *scan_colours, line=4)
    binaries = binaries_xml(
        [
            (small[0], "image/jpeg", photo_jpeg(small[1], small[2])),
            (big[0], "image/jpeg", photo_jpeg(big[1], big[2])),
            (scan[0], "image/tiff", deflate_tiff(scan[1], scan[2], scan_pattern)),
            (PV_BLOB, "application/octet-stream", b"These bytes are no picture of any kind.\n" * 4),
        ]
    )
    sections = "\n".join(
        f"""		<section>
			<title>
				<p>{name}: {width} × {height}</p>
			</title>
			<image l:href="#{name}"/>
			<p>The picture {name} above.</p>
		</section>"""
        for name, width, height in (small, big, scan)
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Picture</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>The picture view</book-title>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-31">2026-10-31</date>
			<id>fixture-picture-view</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>The picture view</p>
		</title>
{sections}
	</body>
{binaries}
</FictionBook>
"""


def many_inline_pictures_book() -> str:
    """many-inline-pictures.fb2 (T003, T107): 300 paragraphs, each with its own 800 x 600 inline
    picture, in sections of 30."""
    width, height = MANY_SIZE
    names = [f"many-{n:03d}.png" for n in range(1, MANY_PICTURES + 1)]
    sections = []
    for start in range(0, MANY_PICTURES, MANY_PER_SECTION):
        paragraphs = "\n".join(
            f"\t\t\t<p>Paragraph {n + 1} with its picture {img(names[n])} in the text.</p>"
            for n in range(start, start + MANY_PER_SECTION)
        )
        sections.append(
            f"\t\t<section>\n\t\t\t<title>\n\t\t\t\t<p>Pictures {start + 1} to "
            f"{start + MANY_PER_SECTION}</p>\n\t\t\t</title>\n{paragraphs}\n\t\t</section>"
        )
    binaries = binaries_xml(
        [
            (
                name,
                "image/png",
                frame_png(
                    width,
                    height,
                    hue_colour(n, MANY_PICTURES, 0.2, 0.96),
                    hue_colour(n, MANY_PICTURES, 0.8, 0.45),
                ),
            )
            for n, name in enumerate(names)
        ]
    )
    body = "\n".join(sections)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">
	<description>
		<title-info>
			<genre>prose_classic</genre>
			<author>
				<first-name>Picture</first-name>
				<last-name>Fixture</last-name>
			</author>
			<book-title>Many inline pictures</book-title>
			<lang>en</lang>
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<program-used>make-fixtures.py</program-used>
			<date value="2026-10-31">2026-10-31</date>
			<id>fixture-many-inline-pictures</id>
			<version>1.0</version>
		</document-info>
	</description>
	<body>
		<title>
			<p>Many inline pictures</p>
		</title>
{body}
	</body>
{binaries}
</FictionBook>
"""


# ----------------------------------------------------------------------------------------------
# Feature 008 fixtures: footnote sequences (US3), the Links bar list (US5), the FBE-like picture
# book (US6) and the spelling set (US4).

F008_WORDS = ("лорем ипсум долор сит амет консектетур адиписцинг элит сед до эиусмод темпор "
              "инцидидунт ут лаборе эт долоре магна аликуа").split()


def f008_sentence(seed: int, length: int) -> str:
    words = [F008_WORDS[(seed * 7 + i * 3) % len(F008_WORDS)] for i in range(length)]
    return " ".join(words).capitalize() + "."


def f008_book(title: str, bodies: str, binaries: str = "", lang: str = "ru",
              coverpage: str = "") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Test</first-name><last-name>Author</last-name></author><book-title>{title}</book-title>{coverpage}<lang>{lang}</lang></title-info>
<document-info><author><nickname>tester</nickname></author><date>2026-11-01</date><id>f008-{title.lower().replace(" ", "-")}</id><version>1.0</version></document-info></description>
{bodies}
{binaries}</FictionBook>
"""


def f008_notes_book(chapters: int, per_chapter: int, paragraphs: int) -> str:
    n = 0
    sections = []
    for c in range(1, chapters + 1):
        notes_at = {1 + (c * 5 + k * 7) % (paragraphs - 1) for k in range(per_chapter)}
        ps = []
        for k in range(paragraphs):
            text = f008_sentence(c * 31 + k, 14)
            if k in notes_at:
                n += 1
                cut = text.find(" ", len(text) // 2)
                text = text[:cut] + f'<a l:href="#n_{n}" type="note">[{n}]</a>' + text[cut:]
            ps.append(f"<p>{text}</p>")
        sections.append(f"<section><title><p>Глава {c}</p></title>{''.join(ps)}</section>")
    notes = "".join(
        f'<section id="n_{i}"><title><p>{i}</p></title><p>{f008_sentence(i, 8)}</p></section>'
        for i in range(1, n + 1))
    return f008_book(f"Notes {n}",
                     f"<body><title><p>Notes {n}</p></title>{''.join(sections)}</body>\n"
                     f'<body name="notes"><title><p>Примечания</p></title>{notes}</body>')


def f008_notes_none() -> str:
    ps = "".join(f"<p>Paragraph {i} of a book without notes, with some words.</p>" for i in range(1, 21))
    return f008_book("Notes none", f"<body><title><p>No notes</p></title><section><title><p>Chapter</p></title>{ps}</section></body>")


def f008_fbe_pictures() -> str:
    cover = '<coverpage><image l:href="#cover.jpg"/></coverpage>'
    body = ("<body><title><p>Pictures</p></title><section><title><p>Chapter</p></title>"
            '<p>Text with an inline picture <image l:href="#inline.png"/> in the middle of a line.</p>'
            '<image l:href="#block.png"/><p>Text after a block picture.</p></section></body>')
    binaries = (f'<binary id="cover.jpg" content-type="image/jpeg">{b64("tiny.jpg")}</binary>\n'
                f'<binary id="inline.png" content-type="image/png">{b64("tiny.png")}</binary>\n'
                f'<binary id="block.png" content-type="image/png">{b64("opaque-rgb.png")}</binary>\n')
    return f008_book("FBE pictures", body, binaries, coverpage=cover)


def f008_href_200() -> str:
    chapters = "".join(
        f'<section id="ch_{c}"><title><p>Chapter {c}</p></title>'
        f'<p>{f008_sentence(c, 10)}<a l:href="#n_{c}" type="note">[{c}]</a></p>'
        f'<image l:href="#pic_{c}.png"/></section>' for c in range(1, 51))
    notes = "".join(f'<section id="n_{i}"><title><p>{i}</p></title><p>Note {i}.</p></section>'
                    for i in range(1, 151))
    binaries = "".join(f'<binary id="pic_{c}.png" content-type="image/png">{b64("tiny.png")}</binary>\n'
                       for c in range(1, 51))
    return f008_book("Href 200", f"<body><title><p>Href 200</p></title>{chapters}</body>\n"
                     f'<body name="notes"><title><p>Примечания</p></title>{notes}</body>', binaries)


F008_EN_CORRECT = ("the and that have with this from they would there their what about which when "
    "make like time just know take people into year your good some could them other than then now "
    "look only come over think also back after work first well even want because these give most "
    "house water light night world school story music garden window letter mother father friend "
    "family country morning evening summer winter spring autumn river mountain forest flower "
    "animal city street market church bridge island ocean village teacher student doctor writer "
    "reader picture paper pencil kitchen bottle table chair door wall floor roof garden green "
    "yellow purple orange silver golden happy little small large quiet early often never always "
    "together already almost enough second minute hour today tomorrow yesterday question answer "
    "problem reason number moment history language science nature system power money business "
    "service health future office police party report record program company market energy "
    "theory culture memory freedom silence journey kingdom dragon castle knight wizard poem novel "
    "chapter author library pocket ticket travel island planet rocket engine machine message "
    "letter window shadow sunrise sunset thunder rainbow butterfly elephant apple bread cheese "
    "coffee dinner lunch breakfast basket candle carpet cloud desert feather glass hammer honey "
    "jacket ladder mirror needle pillow rabbit saddle tiger violin wagon").split()
F008_EN_WRONG = ("recieve teh adress begining beleive calender cemetary concious definately "
    "embarass enviroment existance goverment independant knowlege libary neccessary occurence "
    "posession seperate").split()
F008_RU_WRONG = ("превет кароче сабака малако коммисия расчитать извените сдесь вообщем "
    "жызнь ложить карова типо щас скока чо поцелуить дествительно агенство инциндент").split()


def f008_spell_book() -> str:
    en = list(dict.fromkeys(F008_EN_CORRECT))[:200]
    assert len(en) == 200, len(en)
    ps = [f"<p>Русский абзац с английскими словами: {' '.join(en[i:i + 20])}.</p>" for i in range(0, 200, 20)]
    ps.append(f"<p>Ошибки по-английски: {' '.join(F008_EN_WRONG)}.</p>")
    ps.append(f"<p>Ошибки по-русски: {' '.join(F008_RU_WRONG)}.</p>")
    return f008_book("Spell en in ru", f"<body><section><title><p>Проверка</p></title>{''.join(ps)}</section></body>")


def f008_spell_expected() -> str:
    en = list(dict.fromkeys(F008_EN_CORRECT))[:200]
    return json.dumps({"correctEnglish": en, "misspelledEnglish": F008_EN_WRONG,
                       "misspelledRussian": F008_RU_WRONG}, ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    write("legacy-cp1251.fb2", LEGACY, "cp1251")
    write("modern-utf8.fb2", MODERN)
    write("utf16-bom.fb2", UTF16, "utf-16-le", bom=True)
    write("koi8r.fb2", KOI8R, "koi8_r")
    write("malformed.fb2", MALFORMED)
    write("unknown-elements.fb2", UNKNOWN)
    write("descriptor.fbd", DESCRIPTOR)
    write("mismatched-declaration.fb2", MISMATCH, "cp1251")
    write("no-declaration.fb2", NODECL)
    write("many-sections.fb2", many_sections())
    write("nbsp-layout.fb2", NBSP_LAYOUT)
    # Feature 004.
    write(
        "maxlib-roles.fbd",
        maxlib_description("Проверочная книга", "Тестовый Автор Тестович", MAXLIB_ROLE_ROWS),
    )
    write(
        "maxlib-roles-edge.fbd",
        maxlib_description(
            "Проверочная книга (крайние случаи)",
            "Обычнов Олег Олегович",
            MAXLIB_EDGE_ROWS,
            cover="cover.jpg",
        ),
    )
    write("maxlib-roles.expected.json", maxlib_expected_json())
    write("spelling-scope-ru.fb2", SPELLING_SCOPE)
    write("spelling-scope-ru.expected.json", spelling_scope_expected_json())
    write("empty-annotation-history.fb2", EMPTY_ANNOTATION_HISTORY)
    write("import-full.fbd", IMPORT_FULL)
    write("mapping-corpus.fb2", MAPPING_CORPUS)
    # Feature 005.
    write("ai-selection.fb2", ai_selection())
    write("ai-preexisting.fb2", ai_selection(preexisting=True))
    # Feature 006.
    tables = tables_book()
    check_tables_book("tables.fb2", tables)
    write("tables.fb2", tables)
    write("tables-invalid.fb2", tables_invalid_book())
    placement = tables_placement_book()
    assert not re.search(r"<!--|<!\[CDATA\[|<\?(?!xml )", placement), "comment, CDATA or PI"
    check_tables_book("tables-placement.fb2", placement)
    write("tables-placement.fb2", placement)
    images = tables_images_book()
    check_tables_book("tables-images.fb2", images)
    write("tables-images.fb2", images)
    write("tables-images.expected.json", tables_images_expected(images))
    ai_tables = ai_tables_book()
    check_tables_book("ai-tables.fb2", ai_tables, irregular=1)
    write("ai-tables.fb2", ai_tables)
    # Feature 007.
    write("inline-pictures.fb2", inline_pictures_book())
    write("picture-view.fb2", picture_view_book())
    write("many-inline-pictures.fb2", many_inline_pictures_book())
    # Feature 008
    write("notes-6.fb2", f008_notes_book(1, 6, 13))
    write("notes-400.fb2", f008_notes_book(100, 4, 30))
    write("notes-none.fb2", f008_notes_none())
    write("fbe-pictures.fb2", f008_fbe_pictures())
    write("href-200.fb2", f008_href_200())
    write("spell-en-in-ru.fb2", f008_spell_book())
    write("spell-en-in-ru.expected.json", f008_spell_expected())
    write("reference-all-elements.fb2", f012_reference_all_elements())
    write("invalid-for-export.fb2", f012_invalid_for_export())
    write("pictures-alt.fb2", f012_pictures(True))
    write("pictures-no-alt.fb2", f012_pictures(False))
    write("no-pictures.fb2", f012_pictures(None))
    write("russian-untitled-notes.fb2", f012_notes_book("ru", "Книга", "Текст с примечанием", "Примечание."))
    write("german-book.fb2", f012_notes_book("de", "Ein Buch", "Ein Text mit Anmerkung", "Die Anmerkung."))
    write("book-styles-reference.fb2", f012_reference_all_elements(F012_LOOK_STYLESHEET, "f012-book-styles"))
    write("book-styles-hostile.fb2", f012_reference_all_elements(F012_HOSTILE_STYLESHEET, "f012-book-styles-hostile"))
    write("named-style-tips.fb2", f012_named_style_tips())


# ----------------------------------------------------------------------------------------------
# Feature 012 (EPUB export, T006): the reference books of the export. reference-all-elements.fb2
# holds every FB2 2.1 element, captions on block pictures (D12), the FBD Maker's labelled people
# (D6) and a stylesheet with element and named-style rules (D12); the others test D4's gaps, D43's
# accessibility data and D8's words in the book's language.
# ----------------------------------------------------------------------------------------------
def f012_book(lang: str | None, title: str, body: str, *, notes: str = "", binaries: str = "",
              stylesheet: str = "", extra_title_info: str = "", extra_description: str = "",
              coverpage: str = "", doc_id: str = "f012-book", title_info_after: str = "") -> str:
    lang_el = f"\n\t\t\t<lang>{lang}</lang>" if lang is not None else ""
    style_el = f'\n\t<stylesheet type="text/css">{stylesheet}</stylesheet>' if stylesheet else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="{FB_NS}" xmlns:l="{XLINK_NS}">{style_el}
	<description>
		<title-info>
			<genre>sf_fantasy</genre>
			<author>
				<first-name>Anna</first-name>
				<middle-name>B.</middle-name>
				<last-name>Example</last-name>
			</author>
			<book-title>{title}</book-title>{extra_title_info}{coverpage}{lang_el}{title_info_after}
		</title-info>
		<document-info>
			<author>
				<nickname>fixture</nickname>
			</author>
			<date value="2026-11-10">2026</date>
			<id>{doc_id}</id>
			<version>1.0</version>
		</document-info>{extra_description}
	</description>
	<body>
{body}
	</body>{notes}{binaries}
</FictionBook>
"""


# Feature 012 (Show Book Styles, T050; SC-014, SC-015): the reference book under the two reference
# stylesheets. The look one has every kind of property the Styles view accepts, on every FB2 element
# kind and on both named styles, in absolute units so that the Body view and Preview compute the same
# values; the hostile one holds the rules that would take an editing function away.
F012_LOOK_STYLESHEET = """
p { text-indent: 24px; line-height: 22px; letter-spacing: 0.5px; word-spacing: 2px; margin-top: 4px; margin-bottom: 6px; hyphens: auto; }
p::first-letter { color: #990000; }
section { padding-left: 10px; border-left: 3px solid #336699; background-color: #f4f8ff; }
title { text-align: center; font-family: Georgia, serif; font-size: 22px; font-weight: 700; text-transform: uppercase; text-shadow: 1px 1px 0 #cccccc; }
subtitle { font-style: italic; text-align: right; color: #884400; direction: ltr; }
subtitle::before { content: "\\00a7  "; }
epigraph { font-size: 13px; margin-left: 120px; color: #335577; max-width: 420px; }
cite { border: 2px dashed #aa7733; border-radius: 6px; padding: 8px; background-image: linear-gradient(#ffffff, #eeeeee); columns: 2; column-gap: 20px; }
annotation { outline: 1px dotted #557755; outline-offset: 2px; box-shadow: 2px 2px 4px #999999; clear: both; }
poem { margin-left: 40px; min-width: 200px; counter-reset: verse; writing-mode: horizontal-tb; }
stanza { margin-bottom: 10px; }
v { font-variant: small-caps; counter-increment: verse; }
v::after { content: " [" counter(verse) "]"; }
text-author { font-weight: 600; text-align: right; font-stretch: condensed; }
date { color: #666666; text-decoration-line: overline; opacity: 0.8; }
emphasis { color: #aa0000; }
strong { font-weight: 900; letter-spacing: 1px; }
strikethrough { text-decoration-line: line-through; text-decoration-style: wavy; text-decoration-color: #ff0000; }
sub { font-size: 10px; }
sup { font-size: 10px; position: relative; top: -2px; }
code { font-family: monospace; background-color: #eeeeee; display: inline-block; }
a { color: #0055aa; }
table { width: 300px; }
th { background-color: #ddeeff; }
td { border: 1px solid #888888; }
empty-line { min-height: 12px; }
.letter { font-style: italic; text-align: right; color: #2266aa; }
.smallcaps { font-variant-caps: small-caps; background-color: #ffffcc; }
"""
F012_HOSTILE_STYLESHEET = """
@import url(https://example.com/remote.css);
@font-face { font-family: Remote; src: url(https://example.com/remote.woff2); }
@keyframes spin { to { transform: rotate(360deg); } }
p { display: none; }
title { visibility: hidden; }
epigraph { opacity: 0.05; }
subtitle { color: transparent; }
cite { font-size: 0; }
section { position: fixed; top: 0; left: 0; }
stanza { transform: rotate(90deg); }
v { height: 0; overflow: hidden; }
emphasis { pointer-events: none; user-select: none; }
strong { animation: spin 1s infinite; transition: color 10s; }
code { background-image: url(https://example.com/remote.png); }
text-author { cursor: none; caret-color: transparent; }
annotation { max-height: 1px; }
.letter { font-size: 1px; }
"""


def f012_reference_all_elements(stylesheet: str | None = None, doc_id: str | None = None) -> str:
    stylesheet = stylesheet or (
        "p { text-indent: 2em; }\n.letter { font-style: italic; text-align: right; }\n"
        "epigraph { font-size: 80%; }\n.smallcaps { font-variant: small-caps; }"
    )
    body = """		<image l:href="#pic-jpg" alt="Body picture" title="The body picture's caption"/>
		<title>
			<p>Anna Example</p>
			<p>The Reference Book</p>
		</title>
		<epigraph>
			<p>An epigraph of the body.</p>
			<text-author>Someone Wise</text-author>
		</epigraph>
		<section id="ch1">
			<title>
				<p>Chapter One</p>
				<p>with a second title line</p>
			</title>
			<epigraph>
				<p>A chapter epigraph.</p>
			</epigraph>
			<image l:href="#pic-png" alt="A section picture" title="A caption under the picture"/>
			<annotation>
				<p>A section annotation.</p>
			</annotation>
			<p id="p1">Plain, <strong>strong</strong>, <emphasis>emphasis</emphasis>, <strikethrough>struck</strikethrough>, H<sub>2</sub>O, x<sup>2</sup>, <code>code()</code>, <style name="smallcaps">small caps</style> and an inline <image l:href="#pic-png" alt="inline"/> picture.</p>
			<p>A note<a l:href="#n1" type="note">[1]</a>, a second note<a l:href="#n2" type="note">[2]</a>, a link to <a l:href="#ch2">chapter two</a> and to <a l:href="https://example.com/">a web page</a>.</p>
			<p style="letter">A paragraph in the named style letter.</p>
			<empty-line/>
			<subtitle>A subtitle</subtitle>
			<cite>
				<p>A quotation.</p>
				<text-author>Its Author</text-author>
			</cite>
			<poem>
				<title>
					<p>A Poem</p>
				</title>
				<epigraph>
					<p>The poem's epigraph.</p>
				</epigraph>
				<stanza>
					<title>
						<p>Stanza one</p>
					</title>
					<subtitle>Its subtitle</subtitle>
					<v>First verse line,</v>
					<v>second verse line.</v>
				</stanza>
				<stanza>
					<v>Another stanza.</v>
				</stanza>
				<text-author>The Poet</text-author>
				<date value="2026-01-01">1 January 2026</date>
			</poem>
			<table>
				<tr>
					<th>Head A</th>
					<th align="center">Head B</th>
				</tr>
				<tr>
					<td colspan="2" align="right">Two columns</td>
				</tr>
				<tr>
					<td rowspan="2" valign="middle">Two rows</td>
					<td>Cell</td>
				</tr>
				<tr>
					<td>Cell</td>
				</tr>
			</table>
		</section>
		<section id="part2">
			<title>
				<p>Part Two</p>
			</title>
			<section id="ch2-1">
				<title>
					<p>A subsection</p>
				</title>
				<p xml:lang="de">Ein deutscher Absatz.</p>
			</section>
			<section id="ch2">
				<title>
					<p>Chapter Two</p>
				</title>
				<p>The last chapter.</p>
			</section>
		</section>"""
    notes = """
	<body name="notes">
		<title>
			<p>Notes</p>
		</title>
		<section id="n1">
			<title>
				<p>1</p>
			</title>
			<p>The first note.</p>
		</section>
		<section id="n2">
			<title>
				<p>2</p>
			</title>
			<p>The second note.</p>
		</section>
	</body>"""
    binaries = f"""
	<binary id="pic-jpg" content-type="image/jpeg">{b64("tiny.jpg")}</binary>
	<binary id="pic-png" content-type="image/png">{b64("tiny.png")}</binary>
	<binary id="cover" content-type="image/jpeg">{b64("tiny.jpg")}</binary>"""
    title_info = """
			<annotation>
				<p>The annotation of the reference book.</p>
			</annotation>
			<keywords>reference, export, epub</keywords>
			<date value="2026-11-10">2026</date>"""
    title_info_after = """
			<src-lang>en</src-lang>
			<translator>
				<first-name>Peter</first-name>
				<last-name>Translator</last-name>
			</translator>
			<sequence name="The Series" number="3"/>"""
    description = """
		<publish-info>
			<book-name>The Reference Book</book-name>
			<publisher>Example Press</publisher>
			<city>Kyiv</city>
			<year>2026</year>
			<isbn>978-0-00-000000-2</isbn>
		</publish-info>
		<custom-info info-type="mlillustrator">Van_Gogh Vincent</custom-info>
		<custom-info info-type="mleditor">Редактор Ю.</custom-info>"""
    cover = '\n\t\t\t<coverpage>\n\t\t\t\t<image l:href="#cover"/>\n\t\t\t</coverpage>'
    return f012_book("en", "The Reference Book", body, notes=notes, binaries=binaries,
                     stylesheet=stylesheet, extra_title_info=title_info,
                     extra_description=description, coverpage=cover, title_info_after=title_info_after,
                     doc_id=doc_id or "5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10")


def f012_named_style_tips() -> str:
    """Feature 012 (US5, T058; D41): every case of the named-style tooltip - a span, a paragraph,
    a span in a paragraph, a table and a cell, an id over styled text, a style no stylesheet defines."""
    stylesheet = (".sign { font-weight: bold; }\n.letter { font-style: italic; }\n"
                  ".grid { border: 1px solid #888888; }\n.cell { color: #333333; }")
    body = """		<section>
			<title>
				<p>Named styles</p>
			</title>
			<p><style name="letter">A styled span</style> in plain text.</p>
			<p style="sign">A styled paragraph.</p>
			<p style="sign">Signed and <style name="letter">lettered</style>.</p>
			<table style="grid">
				<tr>
					<td>Plain cell</td>
					<td style="cell">Styled cell</td>
				</tr>
			</table>
			<p id="chapter-2">An id with <style name="letter">styled text</style> inside.</p>
			<p><style name="ghost">An undefined style</style>.</p>
		</section>"""
    return f012_book("en", "Named style tips", body, stylesheet=stylesheet, doc_id="f012-named-style-tips")


def f012_invalid_for_export() -> str:
    body = """		<section id="dup">
			<p>A link to <a l:href="#nowhere">a missing place</a>.</p>
			<image l:href="#missing-binary" alt="no data"/>
		</section>
		<section id="dup">
			<p>A second element with the same id.</p>
		</section>"""
    return f012_book(None, "", body, doc_id="f012-invalid")


def f012_pictures(all_alt: bool | None) -> str:
    if all_alt is None:
        return f012_book("en", "No pictures", "\t\t<section>\n\t\t\t<p>Only text.</p>\n\t\t</section>",
                         doc_id="f012-no-pictures")
    second = 'alt="The second picture"' if all_alt else ""
    body = f"""		<section>
			<image l:href="#a" alt="The first picture"/>
			<p>Text between the pictures.</p>
			<image l:href="#b" {second}/>
			<p>Text.</p>
		</section>"""
    binaries = f"""
	<binary id="a" content-type="image/png">{b64("tiny.png")}</binary>
	<binary id="b" content-type="image/jpeg">{b64("tiny.jpg")}</binary>"""
    name = "f012-pictures-alt" if all_alt else "f012-pictures-no-alt"
    return f012_book("en", "Pictures", body, binaries=binaries, doc_id=name)


def f012_notes_book(lang: str, title: str, text: str, note: str) -> str:
    body = f'\t\t<section>\n\t\t\t<p>{text}<a l:href="#n1" type="note">1</a>.</p>\n\t\t</section>'
    notes = f'\n\t<body name="notes">\n\t\t<section id="n1">\n\t\t\t<p>{note}</p>\n\t\t</section>\n\t</body>'
    return f012_book(lang, title, body, notes=notes, doc_id=f"f012-{lang}")


if __name__ == "__main__":
    main()

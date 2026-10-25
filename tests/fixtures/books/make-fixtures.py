#!/usr/bin/env python3
"""Regenerates the FB2 fixtures in this folder (T037).

The generated files are committed; run this script only when a fixture needs to change:
    python3 tests/fixtures/books/make-fixtures.py
Images come from tests/fixtures/images/ (tiny 8x6 pictures, < 1 KB each).
"""
from __future__ import annotations

import base64
import json
import pathlib
import re
import textwrap
import xml.etree.ElementTree as ET

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
    script's check of the tables it writes by hand, never applied to a vector case. Cells: (row,
    column, colspan, rowsIn, element), counted from 0."""
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


def tables_book() -> str:
    """tables.fb2 (data-model §16.2): the vector tables, tables at every allowed place, and the
    cell and inline shapes of FR-020, FR-047, FR-064, FR-065 and FR-067 to FR-069."""
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


if __name__ == "__main__":
    main()

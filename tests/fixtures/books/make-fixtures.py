#!/usr/bin/env python3
"""Regenerates the FB2 fixtures in this folder (T037).

The generated files are committed; run this script only when a fixture needs to change:
    python3 tests/fixtures/books/make-fixtures.py
Images come from tests/fixtures/images/ (tiny 8x6 pictures, < 1 KB each).
"""
from __future__ import annotations

import base64
import pathlib
import textwrap

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


if __name__ == "__main__":
    main()

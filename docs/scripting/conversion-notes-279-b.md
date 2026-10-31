# FictionBook Editor 2.7.9 scripts — groups 10 to 19 (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## 10_Статистика

8 scripts in 2.7.9: 5 new, 3 successors of converted packages. Not yet converted or rechecked.

## 11_Сделать подписи к картинкам из их атрибута title

5 scripts in 2.7.9: 0 new, 5 successors of converted packages. Not yet converted or rechecked.

## 12_Обработка кавычек

15 scripts in 2.7.9: 2 new, 13 successors of converted packages. Not yet converted or rechecked.

## 13_Заголовки, подзаголовки, пустые строки

19 scripts in 2.7.9: 14 new, 5 successors of converted packages. Not yet converted or rechecked.

## 14_Цитаты

10 scripts in 2.7.9: 10 new, 0 successors of converted packages. Not yet converted or rechecked.

## 16_Поиск форматирования

73 scripts in 2.7.9: **49 new, all converted** here (T057, T058), none left out; the 24 successors of
the packages `01_` to `24_` converted from 2.7beta1 are left for their recheck (they still carry
their 2.7beta1 `legacy` and have no Ukrainian texts yet). Packages:
`scripts/16_find-formatting/<NN>_<slug>/` with the 2.7.9 number as written (`025_`, `026_`, `125_`
... `201_`), ids `16/<slug>`, `legacy.source` the 2.7.9 path - the path `mfbe.scripts.run` resolves
when a combo of another group runs one of them. Every package has `name` and `description` in ru,
en and uk, `needsSelection: false`, the 2.7.9 icon (all but 025/026, which have none) and, in
`index.js`, the original's leading comment verbatim (`check-notices.py --package`: OK for all 49).

### The common ground

**The book as the originals saw it.** The scripts walked FictionBook Editor's `fbw_body`: the
book's annotation and its history first (DIVs of class `annotation` and `history`, each holding one
empty paragraph when the book has none), then every body; a text block was a `P` (an empty line an
empty `P`, a subtitle `P.subtitle`, a text author and a poem's date `P.text-author`, table cells
`P.td` / `P.th`), a container a `DIV` named by its FB2 element, a block picture `DIV.image`
(`files/fb2.xsl` of 2.7.9). The Body view has the same shape - the annotation and history blocks
above the first body, with an empty paragraph to type into when the book has none - so
`nav-lib.js` rebuilds that tree from `mfbe.doc.get()` (description and bodies) and the scripts
walk it exactly like the originals' `getNextP` / `getPreviousP` / `getNextPOrDiv` /
`getPreviousPOrDiv`; the book annotation counts as an annotation (145/146) as it did. The empty
paragraphs of the two blocks have UI ids the model does not know: with only one of them the
caret's id can only name it, with both the script selects each block once to learn its id and
puts the selection back. `selection.selectNode` selects a container (the description blocks by
their fixed ids `desc:annotation` / `desc:history`), `selection.set` a range.

**Engines** (each package carries copies; byte-identical, md5-checked):
`nav-lib.js` (all 49), `block-search.js` (135-168, 200, 201: 36), `regexp-set.js` (125-134, 169:
11), `combo-search.js` (025, 026).

**Run from other scripts.** The 2.7.9 combos call these scripts in loops
(`while (runScriptInFolder("16_Поиск форматирования\\154_Выделить следующий стих (poem).js")=="Found") {...}`).
The conversions return exactly what the originals' `Run()` returned and work from the selection the
previous script of the run left (the chain shares the Body view's selection); the messages the
originals showed when nothing more is found stay, so such a loop ends with that message as in
2.7.9. A `run()` that returns nothing reaches the caller as `null`. The table for the agent
converting the combos:

| Script | Starts from | Selects | `run()` returns |
|--------|-------------|---------|-----------------|
| 025 / 026 combination of italics and bold | selection start / end | caret at the end / start of the run | `"Found"`; `"NotFound"` (nothing found, or Cancel at the question); nothing for a selected picture |
| 125-131, 133, 134 regexp searches | selection end | the match | `"Found"` / `"NotFound"` (after the message); nothing for a selected picture |
| 132 empty line | selection end | caret (see 132) or the spaces | always nothing |
| 135-144 entirely italic / bold paragraphs | previous: start, next: end | the paragraph | `"Found"` / `"NotFound"` (after the message) |
| 145-160 annotation, title, epigraph, cite, poem, poem title, stanza, table | selection end (both directions) | the whole element | `"Found"` / `"NotFound"` (after the message) |
| 161-166 subtitles | previous: start, next: end | the subtitle | `"Found"` / `"NotFound"` (after the message) |
| 167 / 168 text authors | start / end | the group of text authors | `"Found"` / `"NotFound"` (after the message) |
| 169 CAPS title or subtitle | selection end | the paragraph | always nothing |
| 200 / 201 consecutive elements of one type | start / end | first paragraph of the element found | `"Found"` / `"NotFound"` (after the message) |

Every one of 135-168, 200, 201 and 125-134, 169 returns nothing (no message besides the refusal)
for a selected block picture, see below. The 2.7.9 scripts of other groups that call this group
use `136_`, `138_`, `148_`, `150_`, `152_` and `154_` (13/590, 09/38-39, 14/057-062, 37/06-07), which
resolve. Their commented-out examples name 2.7beta1-era files (`48_Перейти на следующий
заголовок.js`, `50_…эпиграф.js`, `52_…цитату.js`, `24_…код.js`) that 2.7.9 no longer has, and
31/50-51 call `16_Поиск форматирования\\12_Перейти на следующий абзац с верхним индексом.js`,
which 2.7.9 itself cannot load (its file is `012_…`); the package `12_next-paragraph-with-sup`
(2.7beta1 path `12_Переход на…`) does not resolve under that name either - for the recheck of
01-24 and the combos' conversion to settle.

**Differences that apply throughout** (each entry of `updates-279/16.json` lists those of its script):
- *A selected picture.* 025/026 refused a picture selection with a message, the regexp scripts
  with "Не обрабатываемый тип выделения: sel.type", the others stopped with a script error (their
  code took the picture's selection for text). Here a selected **block** picture is refused with
  025/026's message (the regexp scripts: their own, fixed, see 125) and the script returns
  nothing; a selected **inline** picture counts as a one-character text selection, the search
  starting from it (025/026 and the regexp scripts refused it too).
- *Empty lines* hold no caret in the Body view (an `empty-line` is a leaf, not a paragraph):
  where the original put the caret into an empty line (132; 200/201 when the element found starts
  with one), the caret goes to the start of the text after it, where Backspace removes the line.
- *Status texts* ("Переходим на следующий стих…", then "ОК") are shown while the script runs; the
  editor clears them at the run's end and reports the run itself. The regexp searches' "Найдено: …"
  descriptions and "Поиск завершен!" stay in the status bar, as there.
- *Scrolling*: the editor scrolls the selection into view; the originals' `scrollIfItNeeds`
  (the selection to the middle of the window) is not reproduced; 135-144 did not scroll at all.
- *Input fields*: the check "Ошибка. Должно быть выделение в тексте книги, а не в поле ввода." is
  dropped: scripts see the Body view's selection only.
- *Size*: above the API's 64 MB document snapshot the description's annotation and history are
  not read and are left out of the walk.

**Reference books and tests** (`tests/scripts/fixtures/279/16/`, valid FB2 2.1):
`containers.fb2` (book annotation; body title and epigraph; two consecutive epigraphs, an
annotation, two cites with an empty line between, a poem with title, epigraph, stanza title, text
author and date, two consecutive poems, two subtitles, a table, a section annotation, a cite
holding a poem whose epigraph holds a cite; a notes body), `paragraphs.fb2` (no annotation and no
history: both empty description paragraphs; entirely italic / bold / both paragraphs with spaces,
pictures and nested marks; spaces-only and empty lines; six subtitles; text-author groups with a
date), `combinations.fb2` (bold italics in the book annotation, nested both ways, adjacent
elements, separated by an italic space, around a picture), `regexps.fb2` (a history; lists,
Cyrillic and Latin, CAPS, addresses, empty lines and spaces, "сказа", a soft hyphen and a picture,
CAPS titles and subtitles). Node ids: `run-script.mjs --list-nodes`.
- One snapshot per package (`tests/scripts/snapshots/16/<slug>.xml`, from the selection noted
  below) - the document is unchanged, so every snapshot of a book equals the book as the editor
  writes it (checked against a script that does nothing; `paragraphs` and `combinations` differ
  from the source only in the editor's nesting order of bold and italic); 025/026 have `.wrap`
  (question: OK), `.cancel` and `.none` (a book without combinations) variants.
- The navigation itself is tested by four **chain drivers** (`fixtures/279/16/chains/<book>/`,
  test packages, never bundled): each runs the scripts through `mfbe.scripts.run` by their 2.7.9
  paths - as the combos do, `ctx.startedBy: 'script'` - from given selections, and writes one line
  per call to the clipboard: `<NN> from <start> #<call>: <run() value> <anchor>-<head> "<text>"`
  (the description blocks' empty paragraphs as `ui_block`). The harness records it in
  `chain-<book>.outputs.json`; 253 calls in all. Every line equals the expected result below,
  derived from the 2.7.9 code before the first run (snapshots `16/chain-containers.xml`,
  `chain-paragraphs.xml`, `chain-combinations.xml` with `--answer ok --answer cancel --answer ok`,
  `chain-regexps.xml`).
- The runs with their selections and answers: `tests/scripts/snapshots/16/suite.json` (59 entries).
- Group gate: `tests/scripts/run-all.sh --group 16` - 83 snapshots (59 new, 24 of 01-24) pass.

### 025 Перейти на предыдущее совмещение курсива с жирностью

`025_previous-bold-italic`, `16/previous-bold-italic`; v1.0. Moves the caret to the end of the
previous run of text that is both italic and bold. The original walked the HTML backwards from the
start of the selection counting the EM and STRONG it was in, passed the combination the caret was
in (or that ended right at it) up to the paragraph's border, and stopped at an EM inside a STRONG
or a STRONG inside an EM; at the start of the book `confirm("Достигнуто начало документа.
Продолжить поиск с конца документа?")`, then from the end up to the selection, "Ничего не
найдено, поиск завершен." when it got there. Converted on marks (`combo-search.js`): a
combination is a maximal run of text with both marks within one paragraph (a picture with both
marks inside it belongs to it); the run ending at or containing the caret is passed; the question
is a message with OK and Cancel; `selection.set` puts the caret. Adjacent elements
(`<strong><emphasis>раз</emphasis></strong><emphasis><strong>два</strong></emphasis>`) are one
stop, as the original's first loop passed them together; two runs separated by an italic space are
two. Book `combinations.fb2`; snapshots `previous-bold-italic.xml` (`--select n10:20:20`),
`.wrap.xml` (`n13:27:27`, OK: back to n10:20), `.cancel.xml`, `.none.xml` (containers.fb2: the
question, OK, "Ничего не найдено…", `NotFound`). Expected and recorded (chain): from n10:20 -
n9:8, n9:2, n7:12, n6:10, n5:29, n5:20, n13:27 (the book annotation), then the question, OK,
n10:20; all `"Found"`. Differences: a combination is a run of marks (an empty italic element in
bold text, a stop in 2.7.9, does not exist in the model); a selected inline picture is a text
selection; scrolling; the size limit.

### 026 Перейти на следующее совмещение курсива с жирностью

`026_next-bold-italic`, `16/next-bold-italic`; v1.0. The same forward: from the end of the
selection the caret goes to the start of the next combination; the run starting at or containing
the caret is passed; at the end `confirm("Достигнут конец документа.\nПродолжить поиск с начала
документа?")`. Snapshots `next-bold-italic.xml` (`--select n5:0:0`), `.wrap.xml` (`n10:5:5`, OK:
n13:12), `.cancel.xml` (`NotFound`, the caret stays), `.none.xml`. Expected and recorded: from
n5:0 - n5:14, n5:23, n6:0, n7:6, n9:0, n9:3, n10:0, the question (OK), n13:12, n5:14, all
`"Found"`; from n10:5 the question, Cancel, `"NotFound"`, caret n10:5. Differences as 025.

### 125 Выделить следующий список

`125_next-list`, `16/next-list`; v5.1. A search by a set of regular expressions (Sclex's "Поиск по
набору регэкспов", TaKir's build 5.x; `regexp-set.js`, engine 'current'): paragraph by paragraph
from the end of the selection to the end of the book, in the first paragraph with a match the
earliest match of all expressions is selected (`selection.set`) and its description goes to the
status bar; a match right at the caret counts, the caret's paragraph is skipped when the caret is
at its end; a description starting with "Пропустить" would mark an exception (none here); "Поиск
завершен!" and "От позиции курсора до конца документа ничего не найдено." at the end. The
expressions, as JScript read the original's strings ("\)" and "\." are ")" and "."):
`(^[0-9]{1,}[)|.](.*?)$)` "Нумерованный список - с цифрами в начале строки",
`(^[a-zA-Zа-яА-Я][)|.](.*?)$)` "Маркированный список - с буквами в начале строки",
`(^[♠♣♦♥•■∙▶~][\x20\xA0]{0,1}(.*?)$)` "…с графическими маркерами в начале строки"; the whole list
paragraph is selected. Book `regexps.fb2`, snapshot `next-list.xml` (`--select n6:0:0`). Expected
and recorded: from n6:0 - n7, n8, n9 («а) …»), n10 («• …») whole, then `"NotFound"` with the
message. Differences (all the regexp scripts): a picture is one character of the text (2.7.9 wrote
"~~~", shifting a selection after it by two per picture); the original's `addMacros` definitions,
which only `tagRegExp` expressions use and these scripts have none of, are not carried over;
leading look-behinds (none here) would use the engine's own; a selected inline picture; scrolling;
the size limit. Fix (all the regexp scripts): the picture-selection message printed the words
"sel.type"; it reads "Не обрабатываемый тип выделения: выделена картинка." now.

### 126 Выделить следующую кириллицу

`126_next-cyrillic`, `16/next-cyrillic`; v5.1. `[а-яёА-ЯЁ]{1,}`, "Найдено: Слово или буква
кириллицей." - repeated runs walk word by word. Snapshot `next-cyrillic.xml` (`n12:0:0`).
Expected and recorded: from n31:0 (the history) - n31:14-21 «история», n3:0-5 «КНИГА», n3:6-15
«РЕГЭКСПОВ», n6:0-5 «Глава»; from n12:0 - n12:12-13 «и»; `"Found"`. Differences and fix as 125.

### 127 Выделить следующий абзац с кириллицей

`127_next-paragraph-with-cyrillic`, `16/next-paragraph-with-cyrillic`; v5.1.
`^(.*?)[а-яёА-ЯЁ]{1,}(.*?)$`, "Найдено: Абзац с кириллицей." - the whole paragraph; since `^`
only matches at 0, the caret's paragraph is found again only from its start. Snapshot
`next-paragraph-with-cyrillic.xml` (`n11:5:5`). Expected and recorded: from n11:5 - n12, n14,
n15, n18; from n12:0 - n12 itself. Differences and fix as 125.

### 128 Выделить следующую латиницу

`128_next-latin`, `16/next-latin`; v5.1. `[a-zA-Z]{1,}`, "Найдено: Слово или буква латиницей."
Snapshot `next-latin.xml` (`n7:0:0`). Expected and recorded: from n7:0 - n12:0-5, n12:6-11,
n13:0-4, n13:5-10, n13:11-15, n14:18-21 «ABC». Differences and fix as 125.

### 129 Выделить следующий абзац с латиницей

`129_next-paragraph-with-latin`, `16/next-paragraph-with-latin`; v5.1.
`^(.*?)[a-zA-Z]{1,}(.*?)$`, "Найдено: Абзац с латиницей." Snapshot
`next-paragraph-with-latin.xml` (`n6:0:0`). Expected and recorded: n12, n13, n14, n15, n25
(«Http://…») whole, then `"NotFound"`. Differences and fix as 125.

### 130 Выделить следующий КАПС (рус-лат)

`130_next-caps`, `16/next-caps`; v5.1. `[A-ZА-ЯЁ]{2,}`, "Найдено: Слово заглавными буквами -
КАПС." Snapshot `next-caps.xml` (`n12:0:0`). Expected and recorded: from n31:0 - n3:0-5,
n3:6-15, n14:11-15 «КАПС», n14:18-21 «ABC», n19:0-12, n19:13-19, n28:0-5, then `"NotFound"` (a
lone capital such as «Я» or «V» is not CAPS). Differences and fix as 125.

### 131 Выделить следующий абзац с КАПС (рус-лат)

`131_next-paragraph-with-caps`, `16/next-paragraph-with-caps`; v5.1.
`^(.*?)[A-ZА-ЯЁ]{2,}(.*?)$`, "Найдено: Абзац со словами заглавными буквами - КАПС." Snapshot
`next-paragraph-with-caps.xml` (`n12:0:0`). Expected and recorded: from n31:0 - n3, n14, n19,
n28 whole, then `"NotFound"`. Differences and fix as 125.

### 132 Выделить следующую пустую строку

`132_next-empty-line`, `16/next-empty-line`; v5.3 ("СТАРАЯ" - the older engine, kept on purpose by
its authors for empty lines): `regexp-set.js`, engine 'old' - a collapsed caret starts one
character on and a match right at it is skipped; `(^$)` "Найдено: Пустая строка" and
`(^[\x20\xA0]+$)` "Найдено: Строка из одних пробелов"; `Run()` returns nothing. An empty line found
gets the caret at the start of the text after it (`selection.selectNode` of the empty line); a
collapsed caret at the start of the text right after an empty line counts as standing on that
empty line, so a line of spaces right after it is found next. The description blocks' empty
paragraphs are empty lines to the script, as they were. Snapshot `next-empty-line.xml`
(`n15:0:0`). Expected and recorded: on regexps.fb2 from n15:0 - caret n17:0 (after the empty line
n16), n17:0-3 (the spaces), caret n25:0 (after n23 and n24), then the message; on paragraphs.fb2
from the annotation's empty paragraph - the history's empty paragraph, n13:0-3, caret n15:0 (after
n14), then the message; every result `null`. Differences: the caret after the empty line; empty
lines that follow each other are one stop (n24 above), the caret cannot tell them apart; an empty
line with no text after it in the Body view leaves the caret at the end of the text before it and
is found again by the next run; the original's `cursorShift` (moving the start one word on, a
workaround for Internet Explorer's caret at DIV borders) is dropped; pictures, inline picture
selections, scrolling, size limit as 125. Fix: as 125.

### 133 Выделить следующую ссылку

`133_next-url`, `16/next-url`; v5.1. `(ftp.*|mail.*|.*@.*|file.*|www.*|http.*|https.*)` with
`i`, "Найдено: Ссылка": from the next address to the end of its paragraph - and because `.*@.*` is
tried at every position, from the search start (the caret, or the paragraph's start) when the
paragraph holds an @, as in 2.7.9. Snapshot `next-url.xml` (`n6:0:0`). Expected and recorded:
from n6:0 - n15 whole (from 0, the @ later), n25 whole («Http://…», any case), then `"NotFound"`;
from n15:5 - n15:5-44. Differences and fix as 125.

### 134 Выделить следующий абзац с искомым текстом

`134_next-paragraph-with-text`, `16/next-paragraph-with-text`; v5.0. `^(.*?)(сказа)(.*?)$` with
`i`, "Найдено: Слово или часть слова \-сказа-\." - the text is meant to be edited ("Тут впишите в
скобках нужный вам текст…", kept with an English line: in a copy of the package in one's own
scripts folder, with an id of its own). Snapshot `next-paragraph-with-text.xml` (`n6:0:0`).
Expected and recorded: from n6:0 - n18 («сказал», in italics), n21 («Сказание», with a soft hyphen
and a picture: n21:0-29) whole, then `"NotFound"`. Differences as 125. Fixes: as 125; and soft
hyphens - unlike its siblings this script left "&shy;" undecoded, so each soft hyphen counted five
characters and the selection ran four characters per hyphen past the paragraph's end; here it is
one character and exactly the paragraph is selected.

### 135 Выделить предыдущий целиком курсивный абзац

`135_previous-all-italic-paragraph`, `16/previous-all-italic-paragraph`; v1.2. From the start of
the selection, the previous paragraph (any `P`: title, epigraph, poem lines, text authors, cells)
that is not empty and is italic throughout - the original removed every `<EM>…</EM>` from the
paragraph's HTML and accepted it when only spaces and non-breaking spaces were left, so pictures
do not count; here every text that has no `emphasis` mark must be spaces (`block-search.js`
`entirely`, `runParagraphSearch`); the paragraph is selected (`selectNode`), "До начала документа
не нашлось ни одного целиком курсивного абзаца." otherwise. Book `paragraphs.fb2` (entirely
italic: n6 title, n8, n10, n11 with trailing plain spaces, n16 with a picture, n28 a text author;
bold: n9, n10, n12, n35 with a plain space); snapshot `previous-all-italic-paragraph.xml`
(`n35:0:0`). Expected and recorded: from n35:0 - n28, n16, n11, n10, n8, n6, then `"NotFound"`.
Differences (all of 135-144): a selected picture; status texts; the editor scrolls the paragraph
into view (the original did not scroll); the input-field check; the size limit.

### 136 Выделить следующий целиком курсивный абзац

`136_next-all-italic-paragraph`, `16/next-all-italic-paragraph`; v1.2. Forward, from the end of
the selection. Snapshot `next-all-italic-paragraph.xml` (`n3:0:0`). Expected and recorded: n6,
n8, n10, n11, n16, n28, then `"NotFound"`. Differences as 135.

### 137 Выделить предыдущий целиком жирный абзац

`137_previous-all-bold-paragraph`, `16/previous-all-bold-paragraph`; v1.2. As 135 for bold
(`<STRONG>`, the `strong` mark). Snapshot `previous-all-bold-paragraph.xml` (`n34:0:0`). Expected
and recorded: n12, n10, n9, then `"NotFound"`. Differences as 135.

### 138 Выделить следующий целиком жирный абзац

`138_next-all-bold-paragraph`, `16/next-all-bold-paragraph`; v1.2. Snapshot
`next-all-bold-paragraph.xml` (`n3:0:0`). Expected and recorded: n9, n10, n12, n35, then
`"NotFound"`. Differences as 135.

### 139 Выделить предыдущий целиком курсивный и жирный абзац

`139_previous-all-bold-italic-paragraph`, `16/previous-all-bold-italic-paragraph`; v1.2. Both
tests. Snapshot `previous-all-bold-italic-paragraph.xml` (`n35:0:0`). Expected and recorded: n10,
then `"NotFound"`. Differences as 135.

### 140 Выделить следующий целиком курсивный и жирный абзац

`140_next-all-bold-italic-paragraph`, `16/next-all-bold-italic-paragraph`; v1.2. Snapshot
`next-all-bold-italic-paragraph.xml` (`n3:0:0`). Expected and recorded: n10, then `"NotFound"`.
Differences as 135.

### 141 Выделить предыдущий целиком курсивный, но НЕ целиком жирный абзац

`141_previous-all-italic-not-bold-paragraph`, `16/previous-all-italic-not-bold-paragraph`; v1.2.
Snapshot `previous-all-italic-not-bold-paragraph.xml` (`n35:0:0`). Expected and recorded: n28,
n16, n11, n8, n6, then `"NotFound"`. Differences as 135.

### 142 Выделить следующий целиком курсивный, но НЕ целиком жирный абзац

`142_next-all-italic-not-bold-paragraph`, `16/next-all-italic-not-bold-paragraph`; v1.2. Snapshot
`next-all-italic-not-bold-paragraph.xml` (`n3:0:0`). Expected and recorded: n6, n8, n11, n16, n28,
then `"NotFound"`. Differences as 135.

### 143 Выделить предыдущий целиком жирный, но НЕ целиком курсивный абзац

`143_previous-all-bold-not-italic-paragraph`, `16/previous-all-bold-not-italic-paragraph`; v1.2.
Snapshot `previous-all-bold-not-italic-paragraph.xml` (`n35:0:0`). Expected and recorded: n12,
n9, then `"NotFound"` (n35, where the caret is, is passed). Differences as 135.

### 144 Выделить следующий целиком жирный, но НЕ целиком курсивный абзац

`144_next-all-bold-not-italic-paragraph`, `16/next-all-bold-not-italic-paragraph`; v1.2. Snapshot
`next-all-bold-not-italic-paragraph.xml` (`n3:0:0`). Expected and recorded: n9, n12, n35, then
`"NotFound"`. Differences as 135.

### 145 Выделить предыдущую аннотацию

`145_previous-annotation`, `16/previous-annotation`; v1.1. From the **end** of the selection (the
originals of 145-160 all start there, also backwards), the previous paragraph inside an annotation
other than the one the caret is in; that annotation is selected whole (`runContainerSearch`,
`selectNode`). The book's annotation counts, as its DIV did, also when it is empty (its empty
paragraph); "До начала документа не нашлось ни одной аннотации." when nothing is found. Book
`containers.fb2`; snapshot `previous-annotation.xml` (`n78:0:0`). Expected and recorded: from
n78:0 - n57 (n58), n14 (n15), the book annotation (n80), then `"NotFound"`; on paragraphs.fb2
(no annotation) from n7:0 - the annotation's empty paragraph (`desc:annotation`), then
`"NotFound"`. Differences (all of 145-160): a selected picture; status texts; scrolling; the
input-field check; the size limit.

### 146 Выделить следующую аннотацию

`146_next-annotation`, `16/next-annotation`; v1.2. Snapshot `next-annotation.xml` (`n3:0:0`).
Expected and recorded: n14 (n15), n57 (n58), then `"NotFound"`, the selection staying; on
paragraphs.fb2 from the book annotation's empty paragraph `"NotFound"`. Differences as 145.

### 147 Выделить предыдущий заголовок

`147_previous-title`, `16/previous-title`; v1.2. Any title: of a body, a section, a poem, a stanza.
Snapshot `previous-title.xml` (`n78:0:0`). Expected and recorded: n76, n73 (the notes body), n60,
n55, n42, n29 (a stanza title), n24, n8, n2 (the body title), then `"NotFound"`. Differences as
145.

### 148 Выделить следующий заголовок

`148_next-title`, `16/next-title`; v1.3 (called in a loop by 13/590). Snapshot `next-title.xml`
(`n3:0:0`). Expected and recorded: from n80:0 (the book annotation) - n2, n8, n24, n29, n42, n55,
n60, n73, n76, then `"NotFound"`. Differences as 145.

### 149 Выделить предыдущий эпиграф

`149_previous-epigraph`, `16/previous-epigraph`; v1.3. The nearest epigraph of the paragraph
found (an epigraph may hold a poem with an epigraph of its own). Snapshot
`previous-epigraph.xml` (`n78:0:0`). Expected and recorded: n65 (inside a poem inside a cite), n26
(a poem's), n12, n10 (two consecutive epigraphs, two stops), n4 (the body's, n5-n6), then
`"NotFound"`. Differences as 145. Open question: nested containers of one kind - the nearest one
is taken, so a search from the outer one's end passes the inner one and the backward search
alternates between them (see 151); kept as 2.7.9 behaves.

### 150 Выделить следующий эпиграф

`150_next-epigraph`, `16/next-epigraph`; v1.4 (looped by 37/06-07). Snapshot
`next-epigraph.xml` (`n3:0:0`). Expected and recorded: n4 (n5-n6), n10, n12, n26, n65 (n67), then
`"NotFound"`. Differences and open question as 149.

### 151 Выделить предыдущую цитату

`151_previous-cite`, `16/previous-cite`; v1.3. Snapshot `previous-cite.xml` (`n37:0:0`). Expected
and recorded: from n37:0 - n21, n17 (n18-n19), then `"NotFound"`; from n71:0 - n62 (n63-n70),
n66 (the cite in the epigraph of the poem inside n62), n62 again - the alternation of nested cites.
Differences and open question as 149.

### 152 Выделить следующую цитату

`152_next-cite`, `16/next-cite`; v1.5 (looped by 14/057-058). Snapshot `next-cite.xml`
(`n16:0:0`). Expected and recorded: from n16:0 - n17 (n18-n19), n21 (past the empty line), n62
(n63-n70), then `"NotFound"` (the inner cite lies inside the selection, before its end); from n63:0
- n66 (n67), n62 again, then `"NotFound"`. Differences and open question as 149.

### 153 Выделить предыдущий стих (poem)

`153_previous-poem`, `16/previous-poem`; v1.3. Snapshot `previous-poem.xml` (`n53:0:0`). Expected
and recorded: n41 (n43-n45), n38 (n40), n23 (n25-n36: title to date), then `"NotFound"`.
Differences and open question as 149.

### 154 Выделить следующий стих (poem)

`154_next-poem`, `16/next-poem`; v1.3 (looped by 09/38-39). Snapshot `next-poem.xml`
(`n22:0:0`). Expected and recorded: n23 (n25-n36), n38, n41 (consecutive poems, separate stops),
n64 (inside a cite, n67-n69), then `"NotFound"`. Differences and open question as 149.

### 155 Выделить предыдущий заголовок стиха

`155_previous-poem-title`, `16/previous-poem-title`; v1.4. A title inside a poem and outside its
stanzas (the original's `checkP`); the title is selected. Snapshot `previous-poem-title.xml`
(`n78:0:0`). Expected and recorded: n42 (n43), n24 (n25), then `"NotFound"` (the stanza title n29
and the section titles are not poem titles). Differences as 145.

### 156 Выделить следующий заголовок стиха

`156_next-poem-title`, `16/next-poem-title`; v1.4. Snapshot `next-poem-title.xml` (`n3:0:0`).
Expected and recorded: n24, n42, then `"NotFound"`. Differences as 145.

### 157 Выделить предыдущую строфу (stanza)

`157_previous-stanza`, `16/previous-stanza`; v1.3. Snapshot `previous-stanza.xml` (`n37:0:0`).
Expected and recorded: n33 (n34), n28 (n30-n32, with its title), then `"NotFound"`. Differences
as 145.

### 158 Выделить следующую строфу (stanza)

`158_next-stanza`, `16/next-stanza`; v1.3. Snapshot `next-stanza.xml` (`n27:0:0`). Expected and
recorded: n28, n33, n39, n44, n68, then `"NotFound"`. Differences as 145.

### 159 Выделить предыдущую таблицу

`159_previous-table`, `16/previous-table`; v1.3. Snapshot `previous-table.xml` (`n78:0:0`).
Expected and recorded: n48, then `"NotFound"`. The table is selected as a block of all its cells
(the Body view's table selection: cells n50 and n52) rather than as a text range;
`mfbe.selection.get()` reports such a block as `n52:0-n52:0` with the first cell's text, which the
chain shows - the next search still starts at the table's end. Differences: the cell block; and as
145.

### 160 Выделить следующую таблицу

`160_next-table`, `16/next-table`; v1.3. Snapshot `next-table.xml` (`n3:0:0`). Expected and
recorded: n48 (the cell block), then `"NotFound"`. Differences as 159.

### 161 Выделить предыдущий подзаголовок (любой)

`161_previous-subtitle`, `16/previous-subtitle`; v1.4. From the start of the selection, the
previous subtitle whose text (tags removed) matches `^.*` - any; the subtitle is selected
(`runParagraphSearch`). Book `paragraphs.fb2` (n18 «* * *», n19 text, n20 «* * *» with
non-breaking spaces, n21 «#», n22 «+ 1 +», n23 «— & —»); snapshot `previous-subtitle.xml`
(`n35:0:0`). Expected and recorded: n23, n22, n21, n20, n19, n18, then `"NotFound"`. Differences
(all of 161-168): a selected picture; status texts; scrolling; the input-field check; the size
limit.

### 162 Выделить следующий подзаголовок (любой)

`162_next-subtitle`, `16/next-subtitle`; v1.4. Snapshot `next-subtitle.xml` (`n3:0:0`). Expected
and recorded: n18 ... n23, then `"NotFound"`. Differences as 161.

### 163 Выделить предыдущий подзаголовок (текст)

`163_previous-text-subtitle`, `16/previous-text-subtitle`; v1.4. A subtitle matching
`[A-Za-zА-яЁё|0-9](.*)` - a letter, a digit or "|". Snapshot `previous-text-subtitle.xml`
(`n35:0:0`). Expected and recorded: n22 («+ 1 +»), n19, then `"NotFound"`. Differences as 161.
Fix: the original tested the paragraph's HTML with the tags removed, so the entity names Internet
Explorer wrote for a non-breaking space, "&", "<" and ">" counted as letters - n20
(«*&nbsp;*&nbsp;*») and n23 («— &amp; —») were "text" subtitles in 2.7.9; the test runs on the
text now.

### 164 Выделить следующий подзаголовок (текст)

`164_next-text-subtitle`, `16/next-text-subtitle`; v1.4. Snapshot `next-text-subtitle.xml`
(`n3:0:0`). Expected and recorded: n19, n22, then `"NotFound"` (2.7.9: n19, n20, n22, n23).
Differences and fix as 163.

### 165 Выделить предыдущий подзаголовок (звездочки)

`165_previous-asterisk-subtitle`, `16/previous-asterisk-subtitle`; v1.4. A subtitle matching
`\*|#|•|\+\s?\*|#|•|\+\s?\*|#|•|\+` - for want of brackets, any subtitle containing an asterisk,
a hash, a bullet or a plus. Snapshot `previous-asterisk-subtitle.xml` (`n35:0:0`). Expected and
recorded: n22, n21, n20, n18, then `"NotFound"`. Differences as 161. Open question: the expression
also takes a text subtitle with a "*" or "+" ("Глава 1*"); kept as 2.7.9 behaves.

### 166 Выделить следующий подзаголовок (звездочки)

`166_next-asterisk-subtitle`, `16/next-asterisk-subtitle`; v1.4. Snapshot
`next-asterisk-subtitle.xml` (`n3:0:0`). Expected and recorded: n18, n20, n21, n22, then
`"NotFound"`. Differences and open question as 165.

### 167 Выделить предыдущих авторов текста

`167_previous-text-authors`, `16/previous-text-authors`; v1.7. From the start of the selection,
the previous group of text authors that follow each other in the paragraph order; the group the
caret is in is passed (the original's `state = -1`); selected from the group's first author to its
last (`runTextAuthorSearch`, `selection.set`). A poem's date counts, FictionBook Editor showing it
as a text author. Snapshot `previous-text-authors.xml` (`n35:0:0`). Expected and recorded: n33-n34
(«Поэт», the date «1901»), n27-n28, then `"NotFound"`; from n28:3 (the caret in the italic second
author) `"NotFound"`. Differences as 161. Fix: the original passed the caret's own group only when
Internet Explorer named the text author paragraph as the caret's element - with the caret in
italics or bold of it, the rest of the caret's group was taken for the next group (from n28:3
2.7.9 selected n27 alone); the caret anywhere in a text author passes its group now. Open
question: dates as text authors; kept.

### 168 Выделить следующих авторов текста

`168_next-text-authors`, `16/next-text-authors`; v1.7. Snapshot `next-text-authors.xml`
(`n24:0:0`). Expected and recorded: n27-n28, n33-n34, then `"NotFound"`. Differences, fix and
open question as 167.

### 169 Выделить заглавный заголовок или подзаголовок (КАПС)

`169_caps-title`, `16/caps-title`; v5.3 (TaKir's expressions of May 2025). The regexp engine
('current'; its `Run()` returns nothing): in title paragraphs (`+title`) and subtitles
(`+subtitle`), `^(.*?)[A-ZА-ЯЁ]{2,}([-—–d.,;:'’?\!…«»()“”„s]){1,}(.*?)$` ("…ЗАГЛАВНЫМИ БУКВАМИ со
знаками препинания в конце") and `^(.*?)[A-ZА-ЯЁ]{2,}(.*?)$` ("…без знаков препинания в
конце"); the whole paragraph is selected, the first expression's description winning when both
match. Snapshot `caps-title.xml` (`n6:0:0`). Expected and recorded: from n31:0 - n3 («КНИГА
РЕГЭКСПОВ», "без знаков"), n19 («ПОДЗАГОЛОВОК КАПСОМ!», "со знаками"), n28 («ГЛАВА 2», "без
знаков"), then the message; results `null`. Differences as 125, and the `null` result. Fix: as
125. Open question: in the original's string "\d" and "\s" are a plain "d" and "s" (a JScript
string escape), so the first class lacks digits and spaces - only the status text depends on it;
kept as 2.7.9 reads it.

### 200 Найти предыдущие подряд идущие однотипные элементы

`200_previous-repeated-elements`, `16/previous-repeated-elements`; v1.3. From the start of the
selection, every paragraph and container in the original's backward order (a container before its
content, `previousNode`); the first cite, poem, subtitle or epigraph (`^(cite|poem|subtitle|epigraph)$`)
whose previous sibling - empty paragraphs (spaces, non-breaking spaces, pictures only) between
them left out - is of the same kind; its first paragraph is selected (`runRepeatedSearch`).
Snapshot `previous-repeated-elements.xml` (`n78:0:0`). Expected and recorded: n47 (the second
subtitle), n43 (the first paragraph of the second poem n41), n22 (the cite n21, after the empty
line), n13 (the second epigraph), then `"NotFound"`. Differences: a found element whose first
paragraph is an empty line gets the caret after it; and as 145. Open question: the header says
poems are searched only when they have no author, the code (2.7.9 too) does not test it; its start
check compares an element with a regular expression (always unequal) - without effect, since the
walk never returns to the caret's element; kept.

### 201 Найти следующие подряд идущие однотипные элементы

`201_next-repeated-elements`, `16/next-repeated-elements`; v1.3. Forward (`nextNode`), the
element whose next sibling is of its kind; its first paragraph is selected. Snapshot
`next-repeated-elements.xml` (`n3:0:0`). Expected and recorded: n11 (the first epigraph), n18 (the
first cite), n40 (the first of the two poems), n46 (the first subtitle), then `"NotFound"`.
Differences and open question as 200.

### Not converted

None: every script of the group needs only the Body view's document and selection and the
editor's messages.

## 17_Перенос примечаний в скобки

3 scripts in 2.7.9: 0 new, 3 successors of converted packages. Not yet converted or rechecked.

## 18_Мелочи редактирования

13 scripts in 2.7.9: 6 new, 7 successors of converted packages. Not yet converted or rechecked.

## 19_Обработка форматирования

27 scripts in 2.7.9 (and a disabled `64_Создать эпиграф из полных абзацев.js_`): **25 new, all
converted** here (T060, T061); the successors of the two packages converted from 2.7beta1
(`01_Обзор и превращение элементов...` → `19/element-browser`, `05_Снять форматирование блочным
элементом` → `18/unwrap-poem-cite-epigraph`) are left for their recheck. Packages:
`scripts/19_formatting/<NN>_<slug>/` with the 2.7.9 number, ids `19/<slug>`, `legacy.source` the
2.7.9 path (the one `mfbe.scripts.run` resolves when a combo runs them; `sourceVersion` from the
header, absent for 20 and 35, whose version 1.2 is in their code only). Every package has `name`
and `description` in ru, en and uk, `needsSelection: false` (the originals' "nothing selected"
check is commented out), the 2.7.9 icon where there is one (11, 16, 17, 18, 35, 57), `undoLabel`
the name, and in `index.js` the skeleton's comment lines verbatim (`check-notices.py --package`: OK
for all 25); 35 keeps the credit line of its message (`–= Sclex Script =–`) and the commented-out
`–=Jürgen Script=–` line of its header.

### The common ground

**The book as the originals saw it.** They worked on FictionBook Editor's `fbw_body`: the book
annotation and the history first (DIVs `annotation` and `history`, each with one empty paragraph
when the book has none), then the bodies; every text block was a `P` (a subtitle `P.subtitle`, a
text author and a poem's date `P.text-author`, a table cell `P.td` / `P.th`, an empty line an
empty `P`), a container a `DIV` named by its element (`files/fb2.xsl`). The Body view has the same
order - the annotation and history blocks above the first body, with an empty paragraph when the
book has none - so a selection may start or end in the description, and the caret of a fresh
document stands there (`selection.get()` reports the annotation's first paragraph).

**Text blocks of the Body view** (`lib/text-blocks.js`, in 20, 25 and every paragraph script):
`doc.getNode` / `doc.replaceNode` address the bodies only, so a block of the book annotation or
the history is found in `doc.get().description` and written with one `doc.setDescription` at the
end; the empty paragraph the Body view shows for a missing annotation or history (an id like
`ui_block_1` the model does not know) is skipped.

**The paragraph engine** (`lib/paragraph-format.js`, 40-46, 55-63, and 20 for its subtitle rule).
The originals pasted an empty marker element at each end of the selection, took every `P` from the
one holding the start marker to the one holding the end marker (`getNextP` over the DOM), rewrote
the `innerHTML` of each with one expression and selected the processed paragraphs from the start
of the first to the end of the last. Here the blocks are those `selection.get().nodes` lists: the
text blocks from the one holding the selection's start to the one holding its end, a caret its own
block, the end at offset 0 of a block including that block, as the marker pasted there did. A
mark transform replaces the expression - "remove every mark of these types (any attributes: the
expressions removed the tags whatever their attributes) and put these around the whole content,
outermost" - which equals the expression on the IE notation for every inline node: text, inline
pictures (formatted too: `<STRONG>` wrapped them), unknown inline elements. A poem's date is left
alone (FB2 allows no formatting in it). The run leaves the processed blocks selected as the
originals did and shows "ОК" in the status bar.

**Containers** (`lib/containers.js`, 10, 11, 16, 18, 25). The originals removed each `DIV` from the
last to the first, with its content (`removeNode(true)`) or leaving its children in its place
(`removeNode(false)`). That page was not checked: a dissolved body epigraph left paragraphs in the
body, a dissolved section epigraph before an annotation left paragraphs before it, and 2.7.9's
save then failed its validation ("save anyway?", No by default). Here every change is a new
content of the container's parent written with `doc.replaceNode`, which the editor checks before
anything changes; the places are tried in order and the first one the schema accepts is taken:
(1) in the container's place, as the originals did; (2) in a section, at the start of its text,
after its title, epigraphs, picture and annotation; (3) in a body or a section of sections, as a
section of its own, untitled, before the first child section; (4) in a poem, as stanzas (paragraphs
as verses, an empty line between two stanzas). A container none of them fits stays, and the status
bar says how many stayed. Where the originals' result was valid, (1) gives exactly it.

**35** runs its expression verbatim on the inline HTML of each paragraph through
`lib/legacy-html.js` (copied unchanged; md5 `72451573…`, as in 06/02 and its siblings).

**Run from other scripts.** The combos of 2.7.9 (09/38, 09/39, 13/590, 14/057-062, 31/50, 31/51,
37/06, 37/07 and the templates 31/30-33) call `40`, `41`, `43`-`46`, `55`, `56`, `60`, `05` and
`34/001` between navigation steps that select an element:
`while (runScriptInFolder("16_Поиск форматирования\\154_Выделить следующий стих (poem).js")=="Found") { runScriptInFolder("\\19_Обработка форматирования\\55_Расформатировать абзац(ы) от жирности.js"); ... }`.
The conversions work on the selection the previous script of the run left (the chain shares the
Body view's selection), behave the same when `ctx.startedBy` is `'script'`, and keep the
originals' messages (a "not found" message of 10-18 shows in a chain too, as in 2.7.9). Both
forms of a 2.7.9 path resolve, with and without the leading backslash
(`19/*.chain` snapshots). For the agent converting the combos:

| Script | Acts on | Selection afterwards | `run()` returns |
|--------|---------|----------------------|-----------------|
| 40-46, 55-62, 63 | every text block from the one holding the selection's start to the one holding its end (a caret: its block), the book annotation and history included | from the start of the first processed block to the end of the last (63: of the verse when a block became a stanza) | nothing (`null` in the caller) |
| 20 | the text block holding the selection's start (the caret) | unchanged | nothing |
| 10, 11, 25, 35 | the whole document: the bodies, the book annotation and the history | unchanged | nothing |
| 15, 16, 17, 18 | the whole document: the bodies | unchanged | nothing |

**Reference books and expected results.** `tests/scripts/fixtures/279/19/`: `formatting.fb2`
(40-46, 55-62; and the "none found" runs of 10-18), `cites.fb2` (10, 11), `epigraphs.fb2` (15, 16),
`annotations.fb2` (17, 18), `subtitles.fb2` (20, 63), `tables.fb2` (25), `underscores.fb2` (35),
all valid against `FictionBook.xsd`. Before any conversion ran, the expected result of every run
was written down from the original's code as a book (the reference book with the changes the
original makes, and the recorded differences where it wrote invalid FB2); for 35 the expected
paragraphs came from the original expression itself, run verbatim on the IE `innerHTML` of each
test paragraph written by hand. Every snapshot of `tests/scripts/snapshots/19/suite.json` (42 runs)
equals its expected book in a canonical form (the block tree, each text block as runs of text with
their marks, so that the editor's choice of nesting does not matter). The chain runs use the test
package `tests/scripts/fixtures/279/19/chain-runner` (never bundled): it runs the scripts its
prompt names through `mfbe.scripts.run` and reports, in a report window recorded in
`<snapshot>.outputs.json`, what each returned and the selection it left.

### 10 Удалить все цитаты и их содержимое

`10_remove-all-cites`, id `19/remove-all-cites` (v1.0, Sclex). Removes every cite with its
content, from the last to the first (a cite nested in another one, through a poem's epigraph, goes
first; both count), in the bodies (`doc.removeNode`) and in the book annotation and the history
(`doc.setDescription`), as the original's page held those too. A cite that is all the content of a
section leaves an empty line (`removeNode` refuses to empty the section: `replaceNode` with
`empty-line`). An annotation or history left with nothing but empty lines goes, as 2.7.9 saved no
such element (`main.js`, `MakeTitleInfo` / `MakeDocInfo` with `IsEmpty`). Status bar: "Удалено
цитат с их содержимым: N."; without a cite the message "Цитат в документе не нашлось.". Acts on
the whole document, returns nothing.

Snapshots (`cites.fb2`, 9 cites): `remove-all-cites.xml` - the annotation keeps its paragraph, the
history (only a cite) goes, the body epigraph keeps its paragraph and author, chapter 1 its two
paragraphs, chapter 2 (a cite only) holds an empty line, chapter 3's annotation and last cite
lose their cites, chapter 4 its nested cites; `remove-all-cites.none.xml` (`formatting.fb2`): the
message, the book unchanged.
Difference: the empty line of chapter 2 (the original left a section with its title only).

### 11 Расформатировать все цитаты

`11_unformat-all-cites`, id `19/unformat-all-cites` (v1.2, Sclex). Dissolves every cite, from the
last to the first: its text authors (those whose parent is the cite) become paragraphs, its other
children stay as they are in its place, the cite and its id go - in the bodies (containers rule
(1)) and in the book annotation and the history. Inside an epigraph a subtitle of the cite becomes
a paragraph too (an epigraph holds no subtitles); a cite whose content still cannot stand there (a
table) stays; an empty cite that was a section's whole content leaves an empty line. Status bar:
"Расформатировано цитат: N." (with " Оставлено цитат: M — …" when some stayed); without a cite the
same message as 10. Acts on the whole document, returns nothing.

Snapshots: `unformat-all-cites.xml` (`cites.fb2`) - every cite's lines in its place: in the
annotation and history paragraphs, in the body epigraph the cite's paragraph, subtitle and author
as paragraphs before the epigraph's own author, in chapter 1 the paragraph, subtitle, poem (its
text author and date untouched, they are the poem's), empty line and table, then the two authors
as paragraphs, chapter 3's annotation and last cite, in chapter 4 the inner cite's lines in the
poem's epigraph and the outer cite's poem and author in the section; `unformat-all-cites.none.xml`.
Differences: the epigraph's subtitle as a paragraph, a cite left where its content cannot stand,
the empty line for an empty sole cite (the original wrote invalid FB2 in each case).

### 15 Удалить все эпиграфы и их содержимое

`15_remove-all-epigraphs`, id `19/remove-all-epigraphs` (v1.0, Sclex). Removes every epigraph of
the bodies - of bodies, sections and poems - with its content, from the last to the first
(`doc.removeNode`; an epigraph is never required, so it always goes). Status bar "Удалено
эпиграфов с их содержимым: N."; without an epigraph "Эпиграфов в документе не нашлось.". Acts on
the whole document, returns nothing.
Snapshots: `remove-all-epigraphs.xml` (`epigraphs.fb2`, 8 epigraphs: two of the body, four of
sections - before the text, before a picture, before an annotation, before subsections - and two
of poems), `remove-all-epigraphs.none.xml`. No difference.

### 16 Расформатировать все эпиграфы

`16_unformat-all-epigraphs`, id `19/unformat-all-epigraphs` (v1.2, Sclex). Dissolves every
epigraph from the last to the first: its own text authors become paragraphs (a cite's stay with
the cite), its content goes to the first place of the containers rule that fits. Status bar
"Расформатировано эпиграфов: N." (with the count of those that stayed); without an epigraph the
message of 15. Acts on the whole document, returns nothing.

Snapshot `unformat-all-epigraphs.xml` (`epigraphs.fb2`), place by place:
- chapter 1 (epigraph before the text) and chapter 2 (before the section's picture): in the
  epigraph's place, as in the original (the picture then stands in the section's text);
- chapter 3 (before an annotation): after the annotation, at the start of the text (rule 2);
- chapter 4 (a section of sections) and the two body epigraphs: a section of its own, untitled,
  before the first section (rule 3; the body's two in their order);
- chapter 5 (a poem's epigraph of two paragraphs, an empty line and an author): stanzas
  `[Эпиграф стиха.]`, `[Вторая часть…, Автор…]` before the poem's stanza (rule 4);
- chapter 6 (a poem's epigraph holding a poem): stays, "Оставлено эпиграфов: 1".
`unformat-all-epigraphs.none.xml`: the message, the book unchanged.
Differences: rules 2-4 and the epigraph that stays (the original left paragraphs where FB2 allows
none: in the body, before the annotation and subsections, in the poem).

### 17 Удалить все аннотации разделов и их содержимое

`17_remove-section-annotations`, id `19/remove-section-annotations` (v1.0, Sclex). Removes the
annotation of every section with its content (`doc.removeNode`). The original skipped the
annotation standing directly in its page's body - the book's own; here the book annotation is not
a node of the bodies (`getElementsByTagName` does not list it) and stays. Status bar "Удалено
аннотаций разделов с их содержимым: N."; without one "Аннотаций разделов в документе не
нашлось.". Acts on the whole document (the bodies), returns nothing.
Snapshots: `remove-section-annotations.xml` (`annotations.fb2`, 5 annotations: before the text,
after a picture, in a section of sections, in a subsection, an empty one; the book annotation
stays), `remove-section-annotations.none.xml` (`formatting.fb2`, whose book annotation stays). No
difference.

### 18 Расформатировать все аннотации разделов

`18_unformat-section-annotations`, id `19/unformat-section-annotations` (v1.0, Sclex). Dissolves
the annotation of every section, from the last to the first: its content opens the section's text
in its place (rule 1); in a section of sections it becomes a section of its own, untitled, before
the first subsection (rule 3). The book annotation stays. Status bar "Расформатировано аннотаций
разделов: N."; without one the message of 17. Acts on the whole document, returns nothing.
Snapshots: `unformat-section-annotations.xml` - chapter 1's paragraph, poem and subtitle open its
text, chapter 2's paragraph, cite, table and empty line follow its picture, chapter 3's paragraph
is a section before subsection 3.1, whose own annotation opens its text, chapter 4's empty
annotation is gone; `unformat-section-annotations.none.xml`.
Difference: the section of its own for the annotation of a section of sections.

### 20 Расформатировать подзаголовок

`20_unformat-subtitle`, id `19/unformat-subtitle` (version 1.2 by its code, no header). When the
text block holding the selection's start (the caret) is a subtitle, makes it plain text keeping
its content and attributes: a paragraph (the original set its class to `normal` with `SetStyleEx`
and removed it), a verse inside a stanza (what that `P` became on saving), a stanza of one verse
directly in a poem (a paragraph there is invalid FB2; 19/element-browser does the same). Also in
the book annotation. The selection is not changed; a selected picture or another block leaves
everything as it is. Acts on the caret's block, returns nothing.
Snapshots (`subtitles.fb2`): `unformat-subtitle.xml` (`--select n10:3:3`: the subtitle with an id,
a style and bold → `<p id="s2" style="center">Второй <strong>подзаголовок</strong></p>`),
`.stanza.xml` (n24 → a verse), `.poem.xml` (n27 → a stanza of one verse), `.annotation.xml` (n39,
the book annotation's subtitle → a paragraph, through `setDescription`), `.paragraph.xml` (a
paragraph: nothing changes).
Difference: the stanza of one verse in a poem.

### 25 Превратить таблицы в простой текст

`25_tables-to-text`, id `19/tables-to-text` (v1.3, Sclex). Every table, from the last to the
first, in the bodies and in the book annotation and the history: each cell, row by row, becomes a
paragraph with the cell's content; the table, the rows and the cells' id, style, alignment and
spans go (the original removed exactly those attributes; a cell's `xml:lang`, which 2.7.9 never
read, stays on its paragraph). A cell with nothing but spaces (non-breaking ones included)
becomes an empty line, as 2.7.9 saved such a paragraph (`FBDoc.cpp` `ProcessP`). The original
also split a cell's paragraph at each inline picture (`re0`) and made the picture a block (with its
href and title; here its href and alt), dropping the empty paragraphs left (`re1`); where FB2
allows no block picture - in a cite or an annotation, right after a section's annotation, as a
section's only content - the pictures of that table stay inline (containers rule: the parent's
content with block pictures, else with inline ones). Text after a picture keeps its own
formatting. Status bar "Все таблицы успешно превращены в текст.". Acts on the whole document,
returns nothing.
Snapshot `tables-to-text.xml` (`tables.fb2`): chapter 1's table → `Заголовок 1`, `Заголовок 2`,
`Текст <strong>ячейки</strong>` (without the cell's id, style, valign), two empty lines (an empty
cell, a cell of one space), `До `, a picture with its alt, ` после`, a picture, `English cell` with
`xml:lang="en"`; chapter 2 (table right after the annotation, starting with a picture), chapter 3
(table in a cite) and chapter 4 (a table of one picture, the section's only content) keep their
pictures inline; the book annotation's table → two paragraphs, the picture inline.
Differences: the inline pictures where FB2 allows no block, the alt kept, the cell's language
kept, the formatting after a picture kept.

### 35 Разметить курсивом буквы рядом со знаками подчеркивания

`35_underscored-letters-to-italics`, id `19/underscored-letters-to-italics` (version 1.2 by its
code; author Sclex by its message; the header lines kept are the commented-out code of the
original, the `Jürgen Script` credit among them). Every paragraph of the bodies, the book
annotation and the history (its `ObrabotkaAnnotation` / `ObrabotkaHistory` switches are true)
whose text holds an underscore gets the original `regExp01` applied to its inline HTML: a run of
letters spaced out with underscores (`_т_е_к_с_т`, `т_е_к_с_т`), with the short words between
such words, a leading `«`, `«…` or (at the very start) `— `, and the trailing `.,…?!»`, is wrapped
in emphasis without its underscores; the non-breaking space is `mfbe.edit.nbsp` (`&nbsp;` in the
notation, as `GetNBSP()` gave). Latin letters count as the original's classes say (`snake_case`
→ `snak`*`ec`*`as`*`en`*`ame`). The message gives the count of emphasis tags added and the time
with the original's credit line. A poem's date is skipped. Acts on the whole document, returns
nothing.
Snapshot `underscored-letters-to-italics.xml` (`underscores.fb2`): 20 matches - the annotation
(`разрядкой.`), the history (`разрядка`, `д.`), the body title, the paragraphs (`Мы вышли и пошли`,
`— Нет,`, `«Да!»`, `слову`, `слово.`, `стиля` inside its named style, `ec` and `en`, `Они в доме, а
мы`, `раз два` and `«… три».` over non-breaking spaces, `уже` inside italics, `жирный` inside
bold), the verse, the cell, the note; a paragraph of lone underscores unchanged, the date
`д_а_т_а` unchanged, the note link `#n_1`, the picture `#pic_1.png` and the style `my_style`
intact.
Fix (FR-023): the expression's look-ahead `(?=[^>]*(<|$))` ("not inside a tag") applies to its last
part only, so a letter next to an underscore inside a tag was matched too: 2.7.9 rewrote the link
to `#n_1` as `#<EM>n</EM>1`, the picture `#pic_1.png` (both its `href` and its `src`) and the style
class `my_style` the same way, and counted them (on this book 2.7.9 counts 25 matches, 4 of them
inside tags; the conversion counts 20 - the 21 of the text less the skipped date). Here the tags
are matched first and kept (`<[^>]*>|` in front of the expression), so no match starts inside a
tag. Differences: the date skipped; a match inside italics gives one emphasis (the editor keeps
no formatting nested in an equal one; 2.7.9 wrote `<emphasis>` inside `<emphasis>`).

### 40-46 Сформатировать абзац(ы) …

`40_paragraphs-to-bold` (`19/paragraphs-to-bold`, strong), `41_paragraphs-to-italics` (emphasis),
`42_paragraphs-to-bold-italics` (strong and emphasis inside it), `43_paragraphs-to-strikethrough`,
`44_paragraphs-to-superscript`, `45_paragraphs-to-subscript`, `46_paragraphs-to-code` (v1.5,
Sclex). The paragraph engine with `remove` = `add` = the kind(s): each block of the selection
loses its marks of the kind (with or without a language) and its whole content gets the mark(s),
outermost, pictures included. Act on the selection's blocks (a caret: its block), leave them
selected, return nothing.
Snapshots (`formatting.fb2`; P1 n7 holds every kind of formatting, a note link and an external
link, P2 n8 formatting with languages and two pictures, one bold, P3 n11 bold-italic overlaps):
- `paragraphs-to-bold.xml` (`n7:9-n8:3`): P1 and P2 bold as a whole, their italics, strikethrough,
  sub, sup, code, style and links inside; P2's `<strong xml:lang="en">` gone into the whole;
  `.caret.xml` (`n11:3:3`): P3 only; `.annotation.xml` (no selection: the caret of a fresh document,
  in the book annotation): the annotation's paragraph, through `setDescription`;
- `paragraphs-to-italics.xml` (`n7:0-n8:5`), `paragraphs-to-bold-italics.xml` (the poem: title,
  verses, author; the date stays), `paragraphs-to-strikethrough.xml` (`n13:2-n25:1`: subtitle, poem
  lines, author, th, td; not the date), `paragraphs-to-superscript.xml` (`--select n7`, the whole
  block: `x2` and the note's `1` inside the one sup), `paragraphs-to-subscript.xml` (td and the last
  paragraph), `paragraphs-to-code.xml` (`n7:0-n8:0`: the end at the start of P2 takes P2; the code
  spans, P2's with a language too, go into the whole; `H<sub>2</sub>O` keeps its sub).
- `paragraphs-to-bold.chain.xml`: the chain runner runs 40 by its 2.7.9 path and then
  `19/paragraphs-remove-italics` on the same selection: after 40 the selection is `n7:0`-`n8:57`, and
  56 works on exactly those blocks (bold P1 and P2 without italics).
Fix (46): the original also removed every subscript - its `/<\/?SUB( [^>]*)?>/gi` is 45's line,
copied unchanged; formatting as code leaves subscripts alone.
Differences: the date stays; Select All and a selected picture change nothing (below).
Open question: a mark of the reformatted kind with a language (`xml:lang`, kept by the editor
since feature 006) goes with its language, as the original's expression removed the tags whatever
their attributes (2.7.9 dropped every mark's language when it read a book).

### 55-62 Расформатировать абзац(ы) от …

`55_paragraphs-remove-bold` (strong), `56_paragraphs-remove-italics` (emphasis),
`57_paragraphs-remove-bold-and-italics` (both), `58_paragraphs-remove-bold-italics-overlaps`,
`59_paragraphs-remove-strikethrough`, `60_paragraphs-remove-superscript`,
`61_paragraphs-remove-subscript`, `62_paragraphs-remove-code` (v1.5, 58 v1.6, Sclex). The engine
with `remove` only: every mark of the kind goes, with or without a language; a picture loses its
bold too, a footnote link keeps its link (60). 58 removes strong and emphasis from exactly the text
that has both: the original walked the tags with two counters, closed the outer tag on entering
italics in bold (or bold in italics), reopened it on leaving and dropped the tags met while both
were open - text under both lost both, the rest kept its formatting - which a look at each text
node's marks reproduces. Act on the selection's blocks, leave them selected, return nothing.
Snapshots (`formatting.fb2`): `paragraphs-remove-bold.xml`, `-italics`, `-bold-and-italics`,
`-bold-italics-overlaps` (`n7:3-n11:4`: P1, P2, P3; 58 leaves P2 alone and turns
`<strong>Жирный <emphasis>и курсивный</emphasis> жирный</strong>` into bold - plain - bold, keeps
the lone `<emphasis xml:lang="la">lingua</emphasis>` and frees the `lingua` inside bold),
`paragraphs-remove-bold.annotation.xml` (no selection: the book annotation's paragraph),
`-strikethrough`, `-superscript`, `-subscript`, `-code` (`n7:0-n8:10`; 62 keeps `H<sub>2</sub>O`).
Fix (62): as 46 - the copied `SUB` line of 61 removed every subscript; left alone here.
Difference (58): formatting of one kind nested in itself (here only with different languages) is
handled like any other - the original's counters lost track of nested tags of one kind and let
italics or bold run on past their end.

### 63 Расформатировать подзаголовок(-ки)

`63_unformat-subtitles`, id `19/unformat-subtitles` (v1.6, Sclex). The engine with 20's rule:
every subtitle among the selection's blocks becomes a paragraph, a verse in a stanza or a stanza of
one verse directly in a poem; the run selects the processed blocks (the verse where a block became
a stanza). Acts on the selection's blocks, returns nothing.
Snapshots (`subtitles.fb2`): `unformat-subtitles.xml` (`n7:3-n15:2`: two section subtitles, the
second with its id and style, and the cite's subtitle → paragraphs), `.poem.xml` (`n22:0-n27:5`:
the poem's two subtitles → stanzas, the stanza's → a verse), `.annotation.xml` (`n39:0-n3:2`, from
the book annotation into the body: the annotation's subtitle → a paragraph); `.chain.xml` (the
`.poem` range, 63 by its 2.7.9 path with a leading backslash): the selection afterwards runs from
the start of the first new verse `sc_1` to the end of the last, `sc_2:27`.
Difference: the stanza of one verse (as 20).

### Paragraph scripts: Select All and pictures

After **Select All** (Ctrl+A) in the Body view, `mfbe.selection.get()` returns `null`, although a
book is open (`docs/scripting/en.md` §4.2 says null only without one): the Body view makes a
ProseMirror `AllSelection`, whose ends lie outside every node with an id. The paragraph scripts
(40-46, 55-63) and 20 then change nothing, where the originals processed every paragraph (checked
with a harness copy that presses Ctrl+A before the run). A selected picture gives no text block
(`nodes: []`): nothing changes, where the originals stopped with a script error (a control range
has no `parentElement`).

### Harness commands

The runs are `tests/scripts/snapshots/19/suite.json` (42 entries; the 6 `element-browser` runs stay
in the main manifest). Gate: `tests/scripts/run-all.sh --group 19` - 48 snapshots, all pass.

```bash
F=tests/scripts/fixtures/279/19; G=scripts/19_formatting; S=tests/scripts/snapshots/19
node tests/scripts/run-script.mjs $G/40_paragraphs-to-bold $F/formatting.fb2 --select-range n7:9-n8:3 --snapshot $S/paragraphs-to-bold.xml
node tests/scripts/run-script.mjs $G/58_paragraphs-remove-bold-italics-overlaps $F/formatting.fb2 --select-range n7:3-n11:4 --snapshot $S/paragraphs-remove-bold-italics-overlaps.xml
node tests/scripts/run-script.mjs $G/16_unformat-all-epigraphs $F/epigraphs.fb2 --snapshot $S/unformat-all-epigraphs.xml
node tests/scripts/run-script.mjs $G/63_unformat-subtitles $F/subtitles.fb2 --select-range n22:0-n27:5 --snapshot $S/unformat-subtitles.poem.xml
node tests/scripts/run-script.mjs $F/chain-runner $F/formatting.fb2 --select-range n7:9-n8:3 \
     --answer '19_Обработка форматирования\40_Сформатировать абзац(ы) жирностью.js | 19/paragraphs-remove-italics' \
     --snapshot $S/paragraphs-to-bold.chain.xml
```

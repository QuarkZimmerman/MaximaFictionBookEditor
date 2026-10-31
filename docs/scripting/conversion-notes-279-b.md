# FictionBook Editor 2.7.9 scripts — groups 10 to 19 (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## 10_Статистика

8 scripts in 2.7.9: 5 new, 3 successors of converted packages. Not yet converted or rechecked.

## 11_Сделать подписи к картинкам из их атрибута title

5 scripts in 2.7.9, all successors of the 5 packages converted from 2.7beta1 (task T081, recheck
of `scripts/11_image-captions/`; the 2.7beta1 conversion is in conversion-notes-b.md, group 11).
All 5 **unchanged**: 2.7.9 renamed the group (*Заголовки картинок в подписи* before) and the
scripts, and kept their code (Sclex, version 1.1) byte for byte. The packages keep their code,
their 2.7beta1 `legacy.source` and `fbeVersion` "2.7", their ids, folders and snapshots (on
`tests/scripts/fixtures/books/conv-b-11.fb2`); only the names follow 2.7.9. The Russian names and
undo labels are 2.7.9's *Сделать подписи к картинкам из их атрибута title (…)*, the English ones
*Make picture captions from their title attribute (…)*, and each package gained `name.uk`
(*Зробити підписи до малюнків з їхнього атрибута title (…)*, «картинка» being *малюнок* in the
glossary) and `description.uk`.

Difference kept from the 0.0.1 conversion, still true against 2.7.9, in all five: where the
schema allows no caption after the image (an image in front of the nested sections of a section,
or the body's image in front of its title) the image is left as it is and counted in the final
message; the original wrote invalid FB2 there. No fixes, no open questions.

### 600 Сделать подписи к картинкам из их атрибута title (разметить жирностью)

`scripts/11_image-captions/600_caption-strong`, id `11/caption-strong` (2.7beta1 *600_Заголовок
картинки в подпись (strong)*): unchanged. en *(mark bold)*, uk *(розмітити жирним)*. Snapshot
`caption-strong.conv-b-11.xml` stays.

### 601 Сделать подписи к картинкам из их атрибута title (разметить курсивом)

`scripts/11_image-captions/601_caption-emphasis`, id `11/caption-emphasis` (*…(emphasis)*):
unchanged. en *(mark italic)*, uk *(розмітити курсивом)*. Snapshot
`caption-emphasis.conv-b-11.xml` stays.

### 602 Сделать подписи к картинкам из их атрибута title (разметить как подзаголовок)

`scripts/11_image-captions/602_caption-subtitle`, id `11/caption-subtitle` (*…(subtitle)*):
unchanged. en *(mark as a subtitle)*, uk *(розмітити як підзаголовок)*. Snapshot
`caption-subtitle.conv-b-11.xml` stays.

### 603 Сделать подписи к картинкам из их атрибута title (разметить как подзаголовок с жирностью)

`scripts/11_image-captions/603_caption-subtitle-strong`, id `11/caption-subtitle-strong`
(*…(subtitle, strong)*): unchanged. en *(mark as a bold subtitle)*, uk *(розмітити як жирний
підзаголовок)*. Snapshot `caption-subtitle-strong.conv-b-11.xml` stays.

### 604 Сделать подписи к картинкам из их атрибута title (разметить как подзаголовок с курсивом)

`scripts/11_image-captions/604_caption-subtitle-emphasis`, id `11/caption-subtitle-emphasis`
(*…(subtitle, emphasis)*): unchanged. en *(mark as an italic subtitle)*, uk *(розмітити як
курсивний підзаголовок)*. Snapshot `caption-subtitle-emphasis.conv-b-11.xml` stays.

## 12_Обработка кавычек

15 scripts in 2.7.9: 2 new, 13 successors of converted packages. Not yet converted or rechecked.

## 13_Заголовки, подзаголовки, пустые строки

Task T055: the 13 scripts new in 2.7.9, except *590_Расформатировать все заголовки_Комбо*, which
runs other scripts and is converted with the combos. The packages 525–528 (2.7beta1 conversions,
see conversion-notes-c.md) are rechecked under T083. Originals: `files/Scripts/13_…` and the
dialogs in `files/HTML/` of 2.7.9. Reference books: `tests/scripts/fixtures/279/13/` (valid FB2
2.1); snapshots and the group's `suite.json`: `tests/scripts/snapshots/13/`. Every expected
result below was written from the original's code before the run; each snapshot equals it.

Shared technique. Most of these scripts rewrote the `innerHTML` of paragraphs; they run here on
the legacy inline-HTML notation of `lib/legacy-html.js` (copied unchanged), so the originals'
expressions and character counting work as written and inline formatting survives. As in the
other conversions, formatting with a language (`<EM lang="…">`, which 2.7.9 did not keep) is
not matched by expressions written for bare tags. FictionBook Editor showed an `<empty-line/>`
as an empty `<P>` and saved any `<P>` holding only white space as `<empty-line/>`; the scripts'
"empty line" is both. Edits the schema forbids (a section left with its title only) are skipped
and reported where 2.7.9 wrote invalid FB2. Helpers each package carries (identical copies):
`numerals.js` ×3, `roman-titles.js` ×2, `section-split.js` ×2, `lib/legacy-html.js` ×9.

### 06 Разметить заголовки разделов либо подзаголовки, найденные по регэкспу... (расширенная версия)

`scripts/13_subtitles/06_regexp-titles-extended`, id `13/regexp-titles-extended`, Tier 3. The
script only opened the modeless dialog `HTML/…(расширенная версия) - задание параметров.htm`,
which held the logic (functions `markupTitles` and `markupSubtitles` evaluated in the main
window). The dialog is one `ui.form`: a field of kind `'regexp'` (feature 007, contract §4)
with the dialog's 52 ready-made patterns as presets (`presets.js`, extracted mechanically, HTML
entities decoded; the initial pattern is `[^ \xA0]`, "Любой непустой абзац", the option the
dialog selected last), the checkboxes (case, entirely bold, entirely italic, after a (sub)title,
between empty lines, first non-empty paragraph of an untitled section), the maximum length, the
paragraphs to take before and after (0–3), and the choice "Разметить": titles or subtitles. In
every body except the notes and comments bodies, each section is walked after its sub-sections.
Titles: a matching paragraph (not a subtitle) and the paragraphs taken with it become the title
of a new sibling section that starts there; the original did it with marker paragraphs and an
`outerHTML` rewrite, and its tests of the previous and next paragraph saw those markers, so
`section-split.js` keeps markers in the list of children exactly where the original put them and
cuts the section afterwards. Subtitles: the paragraph (and the ones taken) becomes a subtitle.
Book `regexp-titles.fb2`; snapshots `regexp-titles-extended.titles.xml` (preset «Глава 123»,
one paragraph after), `.subtitles.xml` (preset «***»), `.bold-untitled.xml` (default pattern,
entirely bold, first paragraph of an untitled section), `.empty-lines.xml` (between empty
lines), `.after-title.xml` (preset «123», subtitles, after a (sub)title).

Expected and obtained: titles — the flat section is cut into four (the name line under each
"Глава N" goes into its title; the subtitle "Глава 3" is never a candidate; the cite after
"Глава 4" stops the capture; the 80-character "Глава 5. …" is too long); in the titled section
the first part keeps only its title and gets an `<empty-line/>`, and so does the new section
"Глава 8" with nothing after its title; the untitled section with id `s3` keeps the id on its
first new section; count 6. Subtitles — the two asterisk paragraphs (`* * *`, `***`) become
subtitles, the existing subtitle and the notes stay; count 2. Bold/untitled — the empty line in
front of the bold first paragraph is removed and that paragraph (a note link in it does not
count against "entirely bold") becomes the title; count 1. Empty lines — the line framed by empty
lines becomes a title; the empty line after it is no candidate (its previous sibling is the end
marker); count 1. After a title — "1" after the title and "2" after the subtitle "1" just made
become subtitles, "3" after a paragraph stays; count 2.

Differences: one run per invocation (the modeless dialog stayed open); the buttons are the
choice and OK, the presets and validity check of the `'regexp'` field replace the dropdown and
the compile-error message; title-only parts and new sections get an `<empty-line/>`; the first
new section keeps the section's id when nothing precedes it (2.7.9 dropped the emptied section
and its id when saving); an empty line chosen as a subtitle stays one (2.7.9 saved its empty
subtitle as `<empty-line/>`); the caret stays where it was; the "after a (sub)title" test is made
per paragraph (the legacy JScript engine shared one `/…/gi` literal whose `lastIndex` could make
consecutive tests alternate). No fixes, no open questions.

### 07 Разметить заголовки разделов согласно оглавлению документа...

`scripts/13_subtitles/07_titles-from-contents`, id `13/titles-from-contents`, Tier 3,
`needsSelection`. The script opened `HTML/…согласно оглавлению документа - основной диалог.htm`
with the selected paragraphs of the book's contents. The form holds the list (the selected text
blocks' texts, one per line), the choice "Действие" — "Удалить из оглавления лишние символы"
(the dialog's `removeSymbols`: page numbers, dot leaders, the dash before a number) or "Разметить
заголовки разделов согласно списку" — the comparison (exact, or ignoring punctuation, numbers and
note marks after the line: link texts, `[1]`, `{1}`, asterisks and digits after letters are left
out), "case as in the contents" and "join titles that touch". The form returns after each action,
with the cleaned list or with the lines no title matched, until it is closed. Marking up walks
every body (notes too): the titles of the sections consume the lines they match, then every
paragraph or subtitle of a section outside the contents that matches a line becomes the title of
a new section (the same marker technique and `section-split.js` as 06); with the case option the
letters take the case of the line (`adaptCase`, as written). The message counts paragraphs and
subtitles turned into titles. Book `contents.fb2`; snapshots `titles-from-contents.xml`
(clean, exact match, then ignoring), `.plain.xml` (no case, no joining), `.toc-title.xml`
(selection from the contents' title, the fix).

Expected and obtained: cleaning gives "Часть первая / Глава 1. Начало / Глава 2. Дорога / Глава
4. Буря / «Встреча» / Эпилог / Приложение". Exact match: "Часть первая" and "ГЛАВА 1. НАЧАЛО"
(case from the list: "Глава 1. Начало") touch and form one title; the subtitle "Глава 2. Дорога"
and «Встреча» (`«»` compare as `"`) become titles; "Глава 4. Буря" with its note link (the link's
"1" is part of the exact text) and "Эпилог." (the dot) do not; 3 paragraphs + 1 subtitle. Then
ignoring: those two become titles; "Приложение" is left in the list. Without the options:
"Часть первая" is a section of its own (title only, padded with `<empty-line/>`) and "ГЛАВА 1.
НАЧАЛО" keeps its case. From the contents' title: nothing is marked up.

Fixes: (1) the contents are skipped wherever the selection starts and ends — 2.7.9 recognised them
only when their first paragraph was a paragraph of a section, so a selection starting in the
contents' title turned the contents' own lines into one joined title (and one ending in a cite or
poem skipped the rest of the book); (2) an empty list gives the message the original meant to show;
2.7.9 stopped with a script error (`Arr.length` of null). Differences: the dialog loop as a form;
title-only parts padded and the section id kept, as in 06. Open question: a line may match several
paragraphs (used lines are still compared), kept.

### 30 Привести заголовки глав к виду 'Глава 1'

`scripts/13_subtitles/30_chapter-titles`, id `13/chapter-titles`, Tier 1. Every paragraph of a
section title (not the body's title, not poem or stanza titles; the notes and comments bodies
are skipped) is tried against the original's branches in their order: "XII", "12", "Глава XII",
"Глава двенадцатая", "XII. …", "Глава XII. …", "Глава двенадцатая. …", "12. …", "Двенадцатая
глава", "Двенадцатая глава. …", "глава 12", "Глава 12. …"; the matching part becomes "Глава 12"
(the rest of the title stays). The original's expressions are spliced in as written (with
`nbspChar` = U+00A0); `removeSymbolsBeyondTags` counts the characters outside the tags of the
legacy HTML and writes the replacement where the first removed character was, so formatting is
kept (a bold title stays bold; `<emphasis>XXI.</emphasis> Встреча` becomes `<emphasis>Глава 21.
</emphasis>Встреча`). The tables a1 (Roman → Arabic) and a2 (ordinal words → Arabic, 1000 phrases)
are in `numerals.js`: the ordinal phrases extracted in the original's order, the Roman numerals
generated and checked to equal the tables of 30, 40 and 50 exactly. Books `chapters.fb2` (the
journey book of us3-scripts-279: 20 titles changed, the rest left alone) and `chapters-edge.fb2`;
snapshots `chapter-titles.xml`, `chapter-titles.edge.xml`.

Expected and obtained (chapters.fb2): "I"→"Глава 1", "2"→"Глава 2", "3."→"Глава 3", "Глава IV"→
"Глава 4", "ГЛАВА v"→"Глава 5", "Глава шестая"→"Глава 6", "ГЛАВА СЕДЬМАЯ."→"Глава 7", "Глава
восьмая. Переправа"→"Глава 8. Переправа", "Глава девятая: Лес"→"Глава 9: Лес", "X. Город"→"Глава
10. Город", "Глава XI. Мост"→"Глава 11. Мост", "Глава XII Башня"→"Глава 12. Башня" (a dot is
added), "13. Река"→"Глава 13. Река", "Четырнадцатая глава"→"Глава 14", "Пятнадцатая глава.
Возвращение"→"Глава 15. Возвращение", "глава 16"→"Глава 16", "ГЛАВА 19. Утро"→"Глава 19. Утро",
bold "Глава двадцатая"→bold "Глава 20", "Глава двадцать вторая"→"Глава 22" (the second line of the
title stays); unchanged: the body title "I", "Пролог", "Глава 17", "Глава 18: Ночь", "Глава 23."
(no expression takes the dot alone), "Глава MMXX" (beyond 1000), "Глава двадцать" (no ordinal),
"Часть первая", the poem title "XXX", "Эпилог", a subtitle "Глава 5", the notes' "1"; the message
counts 20. Edge book: "Пролог. Глава XII. Ночь"→"ПрологГлава 12. Ночь", "XIII. "→"Глава 13.",
"Глава четырнадцатая,"→"Глава 14,", "Пятнадцатая глава, Встреча"→"Глава 15 Встреча", "Глава
сорок&#160;первая" unchanged, "Глава XXIII [1]"→"Глава 23. [1]", "Первая глава "→"Глава 1",
"Глава шестнадцатая[2]"→"Глава 16 [2]", "  Глава XVII. Дождь"→"Глава 17. Дождь", "Глава 18 & 19"
unchanged (but counted), "1001"→"Глава 1001", "Liv"→"Глава 54", "Mix" unchanged; count 11.

Fix: where the replaced part reaches the end of the title, the space the replacement ends with is
not written ("Четырнадцатая глава" → "Глава 14"; 2.7.9 wrote "Глава 14 "). Open questions, kept as
2.7.9: text before "Глава" ("ПрологГлава 12. Ночь": the 0-based search position used as the
1-based start); a non-breaking space inside a numeral stops the lookup; the comma after "глава"
is dropped; words of Roman letters ("Liv") are numerals; the "Глава 30" branches count formatted
titles as replaced though unchanged (message only).

### 40 Привести заголовки частей к виду 'Часть I' and 50 Привести заголовки разделов-'книг' к виду 'Книга I'

`scripts/13_subtitles/40_part-titles` (id `13/part-titles`) and
`scripts/13_subtitles/50_book-section-titles` (id `13/book-section-titles`), Tier 1. The two
originals' `HandleP` are identical but for the keyword; the engine is `roman-titles.js`
(identical copies), each `index.js` holds its original's expressions as written. Section-title
paragraphs (as in 30) reading "Часть 3", "Часть третья", "Часть 3. …" / "Часть 3: …", "Часть
третья. …" or "Третья часть" become "Часть III" / "Часть III. …" (tables a3 and a4 of
`numerals.js`). Book `parts.fb2` (books holding parts holding chapters); snapshots
`part-titles.xml`, `book-section-titles.xml`.

Expected and obtained, 40: "Часть 1"→"Часть I", "ЧАСТЬ 2"→"Часть II", "Часть третья"→"Часть III",
"Часть четвёртая."→"Часть IV", "Часть 5. Начало"→"Часть V. Начало", "Часть 6: Середина"→"Часть VI:
Середина", "Часть седьмая. Конец"→"Часть VII. Конец", "Восьмая часть"→"Часть VIII", "Часть 10
Перелом"→"Часть X Перелом", `<strong>Часть</strong> 11`→`<strong>Часть XI</strong>`, "Двадцать
первая часть"→"Часть XXI", "Часть двенадцатая"→"Часть XII"; unchanged: "Часть IX", "Часть 1001",
"Часть 007" (the table has no leading zeros), the body and notes titles, every "Книга" and
"Глава" title; count 12. 50: "Книга 1"→"Книга I", "Книга вторая"→"Книга II", "Книга 3. Путь"→
"Книга III. Путь", "Книга четвёртая: Дом"→"Книга IV: Дом", "Пятая книга"→"Книга V", "КНИГА
шестая."→"Книга VI", "Книга 8 Финал"→"Книга VIII Финал"; "Книга VII" unchanged; count 7. No
differences, fixes or open questions (40's message keeps the original's text "к виду "Часть 1"").

### 529 Удалить форматирование в заголовках и подзаголовках

`scripts/13_subtitles/529_remove-title-formatting`, id `13/remove-title-formatting`, Tier 2. A
title line or a subtitle loses bold, italics, subscript, superscript, strikethrough, code or a
named style when every letter of it (А-я, Ёё, A-Za-z, Α-ω) carries that formatting (the test
removes the formatted fragments and looks for letters in the rest of the HTML; for code and style
the text outside those elements). Titles of the notes and comments bodies: each kind that covers
all their letters goes. The book's annotation and the document's history are part of the text
(edited through `doc.setDescription`). The original's settings are kept as constants with its
values: each kind never (0), always (1, default) or "show and ask" (2: the lines one by one —
selected in the Body view, Да/Нет/Отмена to move — then the question, after preliminary
statistics); the version raise with a history line (off by default) is ported. Book
`formatting.fb2`; snapshot `remove-title-formatting.xml` (defaults). Mode 2 for the title bold and
the history entry were verified with a scratch copy (questions answered; version 1.0 → 1.1, the
lines "v.1.0 — ?" and "v.1.1 —  Скрипт: «Удаление форматирования…» 2.4 — Зорро, <date>" added).

Expected and obtained: titles — the body title, "Глава первая", the poem title and the title with a
note link lose the bold (the link stays), "Встреча" the italics, "<strong>Глава</strong> 2" the
bold (a digit is no letter), the sub, sup, strikethrough, code and style titles their formatting;
"<strong>Глава</strong>&nbsp;3" keeps the bold (the entity's letters); subtitles — the annotation's
bold, the history's italics, the bold, italic and bold-italic subtitles; the partly formatted ones
stay; notes titles "Примечания" and "1" lose the bold, "<code>2</code>" the code (the fix), the
partly bold one stays. Statistics: titles 5/1/1/1/1/1/1, subtitles bold 3, italics 4, notes
titles 3.

Fix: the code and style checks of notes titles tested a variable left over from the previous line;
they test the title itself (2.7.9 kept "<code>2</code>"). Differences: the proverb of the results
window is left out pending the requester's decision (277 sayings: the 271 of «Пословицы и
поговорки Великой Отечественной войны» plus six about Kursk and Sudzha, among them calls to kill
"fascists"); mode 2 selects instead of underlining; no Body-view check; no `fbeUserName`. Open
questions, kept: `&nbsp;` counts as letters in the HTML tests; Ukrainian і ї є ґ are no letters.

### 530 Удаление жирности и курсива в подзаголовках

`scripts/13_subtitles/530_remove-subtitle-bold-italics`, id `13/remove-subtitle-bold-italics`,
Tier 1. Every subtitle of the text (annotation and history on, as in the original; notes too)
loses all bold (`</?(STRONG)>`), then a subtitle that is exactly `<EM>text</EM>` the italics.
Book `formatting.fb2`; snapshot `remove-subtitle-bold-italics.xml`. Expected and obtained: the
annotation's, the history's, the bold, italic and bold-italic subtitles become plain, "Частично
<strong>жирный</strong>" loses its bold, "<emphasis>Курсив</emphasis> и обычный" stays, the notes
subtitle becomes plain; counts bold 4, italics 4. Fix: the heading "Статистика" also when only
italics were processed (the original tested the bold counter twice). Credits "–= Jurgen Script =–"
and "stokber Edition 2024" are kept in the message.

### 540 Удалить все пустые строки во всех body, кроме body примечаний и комментариев

`scripts/13_subtitles/540_remove-all-empty-lines`, id `13/remove-all-empty-lines`, Tier 2. Every
empty line, and every paragraph, subtitle, verse or text author of spaces and non-breaking spaces
(a picture counts as content), goes, outside the notes and comments bodies, section annotations
and tables; a title, section, poem, stanza, cite or epigraph left empty goes too (the original's
cascade); the count is in the status bar. Book `empty-lines.fb2`; snapshot
`remove-all-empty-lines.xml`. Expected and obtained: 17 removals (the body title's empty line;
seven in the first section, among them `<p> </p>`, `<p>&#160;</p>`, `<p><strong> </strong></p>`,
`<p/>`; the blank subtitle, verse and text author; the stanza, the cite and the title they empty;
the epigraph's empty line; the section holding only an empty line); kept: the picture paragraph,
the table, the annotation, the notes. Difference: two removals the schema forbids are not made and
are counted (the empty line of a section with a title only, the only verse of a titled poem);
2.7.9 made them (count 19) and wrote invalid FB2.

### 543 Удалить пустые строки в выделении

`scripts/13_subtitles/543_remove-empty-lines-in-selection`, id
`13/remove-empty-lines-in-selection`, Tier 2. From the paragraph of the selection's start to the
one of its end (the caret's paragraph without a selection), from the last one back, an empty
paragraph goes when its element has another child. Book `empty-lines.fb2`; snapshots
`remove-empty-lines-in-selection.xml` (`--select-range n9:0-n34:5`: 9 removed; the only verse of
a stanza and the cite's only line stay; the empty table cell stays — fix) and `.caret.xml`
(`--select n12:0:0`: that paragraph only). Fixes: empty table cells are not empty lines (2.7.9
removed them from the rows); a selection ending inside formatted text ends there (2.7.9 went on to
the end of the book). Differences: schema-refused removals counted; no input-field check.

### 550 Создать заголовок книги (в body) из названия (в описании документа)

`scripts/13_subtitles/550_book-title-from-description`, id `13/book-title-from-description`,
Tier 2. The authors (up to five, "и др." after them; patronymics after a Yes/No question) and the
book title of `title-info` go to the top of the main body's title, made when missing (after the
body's picture); empty lines at the start of the title go, a line already holding the authors or
the title is not added again (with a message), an empty line separates the new lines from an
existing title; two main bodies are refused. The settings are constants with the original's
values. Books `book-title.fb2`, `book-title-existing.fb2`, `book-title-two-bodies.fb2`; snapshots
`book-title-from-description.xml` (patronymics yes: "Лев Николаевич Толстой, Анна Ахматова" /
"Война & мир"), `.no-patronymic.xml` ("Лев Толстой, Анна Ахматова"), `.existing.xml` (six authors:
"Иван Первый, … Ерёма Пятый и др.", an empty line, then the old title without its leading empty
line; the book title not added twice), `.two-bodies.xml` (message, unchanged). Differences: a book
without any body is refused (2.7.9 made one); the caret goes to the start of the title.

### 560 Унификация подзаголовков-звездочек (С-К)

`scripts/13_subtitles/560_unify-asterisk-subtitles`, id `13/unify-asterisk-subtitles`, Tier 1. A
"script constructor": its list of search-and-replace operations (one, TaKir's) is kept as
`OPERATIONS` with the original's instructions translated; every paragraph of the bodies (notes
too) and of the annotation (history off, as set) is passed through it. The operation turns a
subtitle of three or more asterisks with any spaces, also in italics or bold, into "* * *". The
statistics window keeps the original's layout (columns, date line). Book `asterisks.fb2`;
snapshot `unify-asterisk-subtitles.xml`: "***", "*  *  *" in italics, "****" in bold italics,
"* * * *", "&#160;* * *&#160;" and the annotation's "***" become "* * *"; "**", "* * * Звёзды"
and the paragraph "***" stay; 13 matches, 6 lines changed, 36 lines. The history setting was
checked with a scratch copy. Difference: the optional proverb (off by default) is not included.

### 570 Поиск возможных заголовков по ключевым словам

`scripts/13_subtitles/570_find-possible-titles`, id `13/find-possible-titles`, Tier 1. TaKir's 15
expressions and 7 macros, as written, on the 2.7.9 engine of Sclex's "Поиск по набору регэкспов"
(`keyword-search.js`, derived from the converted 2.7 engine with the 2.7.9 changes: a hit right at
a collapsed caret counts, non-breaking spaces are spaces, "Пропустить" descriptions are passed
over, "Поиск завершен!" in the status bar). From the end of the selection to the end of the book,
the next paragraph outside titles and subtitles that starts like a title is selected and the kind
is shown in the status bar; the book is not changed. Book `keywords.fb2`; snapshots
`find-possible-titles.xml` (`--select n7:0:0`) and `.end.xml` (after the last hit: the message).
Successive runs were verified with a scratch wrapper: "Первая глава", "Вторая часть,", "Глава ",
"ГЛАВА ", "Двадцать первый том", "Первое действие", "Об авторе", "Список ", "Chapter ", "Эпилог",
"Об&#160;авторе", the notes' "Глава ", then nothing; titles, the subtitle and "Главная" are skipped.
Differences: a picture is one character; the annotation and history are not searched; English
status texts. Open question: equal positions — the earlier expression wins ("Список литературы"
is found as "Список ").

### 580 Удалить подзаголовки из звездочек рядом с заголовками

`scripts/13_subtitles/580_remove-asterisks-near-titles`, id `13/remove-asterisks-near-titles`,
Tier 2 (idea TaKir, implementation DeepSeek and TaKir, credits kept). A subtitle whose text is
"* * *" goes when it is the first element after the title of its container ("below") or the last
element of its container while the next container starts with a title ("above"); two messages
give the number found and the numbers removed. The annotation and history are searched too. Book
`asterisks.fb2`; snapshot `remove-asterisks-near-titles.xml`: found 6, removed 5 (above 2: the end
of chapter 1, the end of the cite before a titled poem; below 3: after chapter 1's title, after
the poem's title, in the notes); the one under "Глава 3" is not removed (the section would keep its
title only; difference); the non-breaking-space one and the one ending an untitled last section
stay. Open question: a "* * *" ending a cite or poem counts as "above" when the next container
after it starts with a title (paragraphs skipped), kept as 2.7.9.

### Not converted in this task

- 590_Расформатировать все заголовки_Комбо — runs other scripts; converted with the combos.

### Harness commands

```bash
G=scripts/13_subtitles; B=tests/scripts/fixtures/279/13; S=tests/scripts/snapshots/13
node tests/scripts/run-script.mjs $G/30_chapter-titles $B/chapters.fb2 --snapshot $S/chapter-titles.xml
node tests/scripts/run-script.mjs $G/30_chapter-titles $B/chapters-edge.fb2 --snapshot $S/chapter-titles.edge.xml
node tests/scripts/run-script.mjs $G/40_part-titles $B/parts.fb2 --snapshot $S/part-titles.xml
node tests/scripts/run-script.mjs $G/50_book-section-titles $B/parts.fb2 --snapshot $S/book-section-titles.xml
node tests/scripts/run-script.mjs $G/06_regexp-titles-extended $B/regexp-titles.fb2 --answer '{"regexp":"^[ \\xA0]*Глава[ \\xA0]+\\d+(\\..*)?[ \\xA0]*$","captureAfter":"1"}' --snapshot $S/regexp-titles-extended.titles.xml
node tests/scripts/run-script.mjs $G/06_regexp-titles-extended $B/regexp-titles.fb2 --answer '{"regexp":"^[ \\xA0]*(\\*[ \\xA0]*){3}[ \\xA0]*$","action":"subtitles"}' --snapshot $S/regexp-titles-extended.subtitles.xml
node tests/scripts/run-script.mjs $G/06_regexp-titles-extended $B/regexp-titles.fb2 --answer '{"bold":true,"inUntitledSection":true}' --snapshot $S/regexp-titles-extended.bold-untitled.xml
node tests/scripts/run-script.mjs $G/06_regexp-titles-extended $B/regexp-titles.fb2 --answer '{"inEmptyLines":true}' --snapshot $S/regexp-titles-extended.empty-lines.xml
node tests/scripts/run-script.mjs $G/06_regexp-titles-extended $B/regexp-titles.fb2 --answer '{"regexp":"^[ \\xA0]*\\d+[ \\xA0]*\\.?$","afterTitle":true,"action":"subtitles"}' --snapshot $S/regexp-titles-extended.after-title.xml
node tests/scripts/run-script.mjs $G/07_titles-from-contents $B/contents.fb2 --select-range n7:0-n13:5 --answer '{"action":"removeSymbols"}' --answer '{"action":"markup"}' --answer ok --answer '{"action":"markup","processingType":"ignoring"}' --answer ok --answer cancel --snapshot $S/titles-from-contents.xml
node tests/scripts/run-script.mjs $G/07_titles-from-contents $B/contents.fb2 --select-range n7:0-n13:5 --answer '{"action":"removeSymbols"}' --answer '{"action":"markup","adaptCase":false,"mergeAdjacent":false}' --answer ok --answer cancel --snapshot $S/titles-from-contents.plain.xml
node tests/scripts/run-script.mjs $G/07_titles-from-contents $B/contents.fb2 --select-range n6:0-n13:5 --answer '{"action":"markup"}' --answer ok --answer cancel --snapshot $S/titles-from-contents.toc-title.xml
node tests/scripts/run-script.mjs $G/540_remove-all-empty-lines $B/empty-lines.fb2 --snapshot $S/remove-all-empty-lines.xml
node tests/scripts/run-script.mjs $G/543_remove-empty-lines-in-selection $B/empty-lines.fb2 --select-range n9:0-n34:5 --snapshot $S/remove-empty-lines-in-selection.xml
node tests/scripts/run-script.mjs $G/543_remove-empty-lines-in-selection $B/empty-lines.fb2 --select n12:0:0 --snapshot $S/remove-empty-lines-in-selection.caret.xml
node tests/scripts/run-script.mjs $G/560_unify-asterisk-subtitles $B/asterisks.fb2 --snapshot $S/unify-asterisk-subtitles.xml
node tests/scripts/run-script.mjs $G/580_remove-asterisks-near-titles $B/asterisks.fb2 --snapshot $S/remove-asterisks-near-titles.xml
node tests/scripts/run-script.mjs $G/530_remove-subtitle-bold-italics $B/formatting.fb2 --snapshot $S/remove-subtitle-bold-italics.xml
node tests/scripts/run-script.mjs $G/529_remove-title-formatting $B/formatting.fb2 --snapshot $S/remove-title-formatting.xml
node tests/scripts/run-script.mjs $G/550_book-title-from-description $B/book-title.fb2 --answer yes --snapshot $S/book-title-from-description.xml
node tests/scripts/run-script.mjs $G/550_book-title-from-description $B/book-title.fb2 --answer no --snapshot $S/book-title-from-description.no-patronymic.xml
node tests/scripts/run-script.mjs $G/550_book-title-from-description $B/book-title-existing.fb2 --snapshot $S/book-title-from-description.existing.xml
node tests/scripts/run-script.mjs $G/550_book-title-from-description $B/book-title-two-bodies.fb2 --snapshot $S/book-title-from-description.two-bodies.xml
node tests/scripts/run-script.mjs $G/570_find-possible-titles $B/keywords.fb2 --select n7:0:0 --snapshot $S/find-possible-titles.xml
node tests/scripts/run-script.mjs $G/570_find-possible-titles $B/keywords.fb2 --select n27:6:6 --answer ok --snapshot $S/find-possible-titles.end.xml
```

Recheck (task T083) of the five packages converted from 2.7beta1 whose 2.7.9 successors are in
this group: 525–528 (`scripts/13_subtitles/`, conversion-notes-c.md, group 13) and *05
Разметить заголовки разделов либо подзаголовки, найденные по регэкспу...*, which 2.7.9 moved
here from 08_Структура разделов, where it was *02_Разбить документ на разделы...*
(`scripts/13_subtitles/05_split-into-sections`, conversion-notes-a.md, group 08). Outcomes: all
five **updated** to their 2.7.9 version 4.7; ids and folders unchanged, so the regexp markup
stays 02 of *Структура разделов* in the menu (recheck rule 2) while 2.7.9 lists it here as 05.
Every package gained `name.uk`, `description.uk` and the icon of its 2.7.9 original (`icon.png`;
2.7beta1 had none for them); `legacy` names the 2.7.9 original with `sourceVersion` 4.7.
Reference books: the existing `tests/scripts/fixtures/books/conv-c-13.fb2` and `conv-a-08.fb2`
of the main suite, and the new `tests/scripts/fixtures/279/13/subtitles-recheck.fb2` and
`regexp-titles-basic.fb2` (valid FB2 2.1); the new snapshots are in `tests/scripts/snapshots/13/`
and its `suite.json`. Every expected result below was written from the 2.7.9 originals before
the run; each snapshot equals it.

### 05 Разметить заголовки разделов либо подзаголовки, найденные по регэкспу...

`scripts/13_subtitles/05_split-into-sections`, id `08/split-into-sections`: **updated** (2.7beta1
v1.4 → 2.7.9 v4.7, a major change). Names as in 2.7.9: ru and undo label *Разметить заголовки
разделов либо подзаголовки, найденные по регэкспу...*, en *Mark up section titles or subtitles
found by a regular expression...*, uk *Розмітити заголовки розділів або підзаголовки, знайдені за
регулярним виразом...*. The script still only opens its modeless dialog, now *HTML/Разметить
заголовки разделов либо подзаголовки, найденные по регэкспу - задание параметров.htm*, which holds
the logic. 2.7.9 changed in it: a list of 51 ready-made patterns ("Вида «Глава 123»", "Вида
«***»", "Chapter One" ...) that fill the pattern field; a second pair of buttons that marks up
subtitles instead of titles (the matching paragraph, and up to 3 paragraphs before and after it,
become subtitles; a subtitle is passed over, any other element stops); the notes and comments
bodies are left alone; subtitles are no longer candidates for titles, and taking paragraphs
into a title stops at a subtitle; the text tested is the paragraph's HTML without its tags
(pictures go) with `&nbsp;` and the non-breaking space as U+00A0, `&lt;` `&gt;` `&amp;` decoded
and the unusual spaces U+2002–U+2006, U+2009, U+200A, U+202F as plain spaces (2.7beta1 tested
`innerText`); an empty paragraph is tested as a non-breaking space; an empty pattern is refused
for subtitles; the texts and the version. Ported on the walk of the extended version 06 (the
same dialog with more conditions): `section-split.js` and `lib/legacy-html.js` are identical
copies of 06's, `index.js` holds 05's tests as written - 06's without its bold, italic,
position, empty-lines and length conditions - and `presets.js` 05's own list, extracted
mechanically like 06's (49 of its patterns are 06's; the "Пролог..." and "Prologue..." lists
are shorter, "Любой непустой абзац" is missing; the list starts on no preset and the field
empty, as the dialog did). The form keeps the field ids `regexp`, `caseSensitive`, `before` and
`after` of the 2.7beta1 conversion and adds the choice `action` (titles, the default, or
subtitles). `index.js` carries 2.7.9's notice and, as well, the 2.7beta1 one with its forum link.

Snapshots. Re-recorded `08/split-into-sections.xml` (conv-a-08.fb2, `^глава `, 0 before, 1
after; the entry of the main suite): the subtitle "Глава вторая" is no candidate any more, so it
stays in the "ГЛАВА ПЕРВАЯ" section with "Текст второй главы." and the empty line after it
instead of opening a section; 3 titles (2.7beta1 4). Added on regexp-titles-basic.fb2:
`split-into-sections.titles.xml` (preset «Глава 123», 1 before, 1 after): the titled section
`s1` keeps its title, id and "Вступление."; "Глава 1" takes the empty line before it and
"Начало" after it into its title; the subtitle "Глава 2" stays in that section; "Глава 3"
(non-breaking space) takes nothing, a subtitle stands on either side; "Глава 4" (thin space
U+2009, a plain space for the test) takes "Текст четвёртой главы." (a cite before it stops the
capture); "Глава 5" behind an inline picture matches and, with nothing after it, gets an
`<empty-line/>`; the untitled section and the notes body ("Глава 10") stay; 4 titles.
`split-into-sections.subtitles.xml` (preset «***», subtitles, 1 before, 1 after): "* * *" with
"Перед звёздочками" and "После звёздочек", "***" (the subtitle before it is passed over, the
cite after it stops) and "*  *  *" with "Конец." become subtitles; the empty line before "*  *
*" is taken and stays an empty line; "Обычный текст." stays, and so do the notes' "* * *"; 3
subtitles. `split-into-sections.empty.xml` (empty pattern): the message, the book unchanged.

Fix: an empty pattern is refused for titles too, with the message 2.7.9 shows for subtitles
("Вы не ввели никакой регэксп. Пожалуйста, введите регэксп для поиска заголовков ..."): 2.7.9's
title buttons ran with it, and the empty expression matched every paragraph and empty line of
the text bodies, each becoming the title of a section of its own; the subtitle buttons' check
speaks of finding titles, and the 2.7beta1 conversion refused an empty pattern already.
Differences: the modeless dialog is one form (the choice "Разметить" and OK; the presets and the
validity check of the `'regexp'` field replace the dropdown and the compile-error message); a
part of a section left with its title only and a new section with nothing after its title get an
`<empty-line/>`, and the first new section keeps the section's id when nothing precedes it (2.7.9
wrote the invalid sections and lost the id when saving); an empty line chosen as a subtitle
stays an empty line (2.7.9 saved its empty subtitle as one), counted as in 2.7.9. The package
follows 2.7.9 into this group at place 05: it moved from `scripts/08_sections/02_split-into-sections`
to `scripts/13_subtitles/05_split-into-sections`, and its id `08/split-into-sections` is kept, so
hotkeys, Scripts toolbar buttons and Last script keep running it (FR-028). No open questions.

### 525 Разметка подзаголовков, чистка пустых строк

`scripts/13_subtitles/525_subtitles-empty-lines`, id `13/subtitles-empty-lines`: **updated**
(v4.2 → v4.7, a small change). The four scripts 525–528 keep one engine, `subtitles-lib.js`
(identical copies), and differ in their flags as in 2.7.9. 2.7.9 changed in it:
- the merge of a "* * *" section into the previous one is commented out, and so is that of a
  section starting with a subtitle. What stays of that pass: a section that follows a sibling
  section and whose title's first line is one to three asterisks loses its title - that line
  becomes `<subtitle>* * *</subtitle>` (keeping its attributes) and the other title lines
  paragraphs of the section, in place (`removeNode(false)`). Ported as `unwrapTitle`; where FB2
  allows no subtitle at the start of the section (an epigraph, an annotation or sub-sections
  follow the title) the section keeps its title and the message counts it ("Не превращено в
  подзаголовки заголовков «* * *»"), where 2.7.9 wrote invalid FB2;
- the empty line right after a section's picture is no longer removed as an empty line at the
  start of the section (`removeEmptiesAtBegin` returns when the line follows the picture);
- nothing inside a stanza becomes a "* * *" subtitle: a stanza's subtitle "**" keeps its text
  (verses of asterisks were left alone by the conversion already);
- texts: "v4.7", "в начале раздела" and "в конце раздела" for "... секции".
Also aligned with the original's message: the script's name in straight quotes, and minutes in
the running time beyond a minute. Gained uk *Розмітка підзаголовків, очищення порожніх рядків*;
the description says what 2.7.9 does.

Snapshots. The five snapshots of the four scripts on conv-c-13.fb2 are re-recorded, since 2.7.9
gives a different result on that book; each gains the same five lines: "Глава с картинкой" keeps
the empty line after its picture; in "Часть вторая" the "* * *" sub-section stays a section,
headed by the subtitle "* * *", and the section starting with "Подзаголовок-секция" stays a
section (2.7beta1 merged both into "Глава третья"). 525's message: next to an empty line 5, a
cite 2, a poem 2, a subtitle 5, inside poems 1, section start 1, section end 2, epigraph start 1,
cite start 1, title start 2, end 2, inside 1; 25 in all (2.7beta1 26). Added
`subtitles-empty-lines.recheck.xml` on subtitles-recheck.fb2: the empty line after the first
section's picture and the stanza's subtitle "**" stay; the second section's title "* * *" /
"**Вторая** *строка* заголовка" becomes the subtitle "* * *" and a paragraph that keeps its
formatting; the section starting with a subtitle stays; "***" in front of an epigraph and "* *"
over two sub-sections keep their titles (2 counted); of those sub-sections the first keeps its
title "*" (no section before it), the second gets the subtitle "* * *" in front of its picture,
whose empty line stays while the one after it goes; 1 empty line removed.

Fix (kept from the 2.7beta1 conversion): the line "в конце цитаты" gives the empty lines removed
at the end of cites; 2.7.9 printed the start-of-cite number twice. Differences: only paragraphs
and subtitles of asterisks become "* * *" (the original changed any line, a text author or a
poem's date too); edits the schema refuses are skipped and counted: the only verse of a stanza, a
subtitle inside an epigraph, and the asterisk title described above. Open question: 2.7.9 no
longer merges a "* * *" section into the previous one but still turns its title into a subtitle,
so such a section now starts with "* * *" (the first section of a body or part keeps its
asterisk title); kept as 2.7.9 - restore 2.7beta1's merge instead?

### 526 Разметка подзаголовков, чистка пустых строк, удаление жирности в заголовках

`scripts/13_subtitles/526_subtitles-empty-lines-unbold-titles`, id
`13/subtitles-empty-lines-unbold-titles`: **updated** as 525 (the same engine with titles losing
bold). 2.7.9 also rewrote its `destrongAndDeitalic` as a regular expression over the title's
HTML instead of a walk of its elements; on the document model both remove the marks, and the
engine now also removes them from inline pictures (2.7.9's expression removed the tags around a
picture too). Gained uk *Розмітка підзаголовків, очищення порожніх рядків, видалення жирного в
заголовках*. Snapshot `subtitles-empty-lines-unbold-titles.xml` re-recorded (the five lines of
525). Fix, differences and open question as 525.

### 527 Разметка подзаголовков, чистка пустых строк; удаление жирности в заголовках по запросу

`scripts/13_subtitles/527_subtitles-empty-lines-ask-unbold-titles`, id
`13/subtitles-empty-lines-ask-unbold-titles`: **updated** as 526; the question "Удалять ли
жирность в заголовках?" comes first. Gained uk *Розмітка підзаголовків, очищення порожніх рядків;
видалення жирного в заголовках на запит*. Snapshots `subtitles-empty-lines-ask-unbold-titles.xml`
(yes, = 526) and `.no.xml` (no, = 525) re-recorded. Fix, differences and open question as 525.

### 528 Разметка подзаголовков, чистка пустых строк, удаление жирности и курсива в заголовках

`scripts/13_subtitles/528_subtitles-empty-lines-plain-titles`, id
`13/subtitles-empty-lines-plain-titles`: **updated** as 526, titles losing italics too. 2.7.9's
italics expression has a typo, `( [>^]*)?` for `( [^>]*)?`, which would leave an `<EM>` with
attributes; 2.7.9's `fb2.xsl` writes `<em>` without any, so it removes every italics as the
conversion does. Gained uk *Розмітка підзаголовків, очищення порожніх рядків, видалення жирного та
курсиву в заголовках*. Snapshot `subtitles-empty-lines-plain-titles.xml` re-recorded (the five
lines of 525); added `subtitles-empty-lines-plain-titles.recheck.xml` on subtitles-recheck.fb2:
as 525's, with the body title "Проверка версии 4.7" and its picture plain and the second
section's former title line "Вторая строка заголовка" without bold and italics. Fix, differences
and open question as 525.

### Harness commands of the recheck

```bash
G=scripts/13_subtitles; P=scripts/13_subtitles/05_split-into-sections; B=tests/scripts/fixtures/279/13; S=tests/scripts/snapshots/13
node tests/scripts/run-script.mjs $G/525_subtitles-empty-lines $B/subtitles-recheck.fb2 --snapshot $S/subtitles-empty-lines.recheck.xml
node tests/scripts/run-script.mjs $G/528_subtitles-empty-lines-plain-titles $B/subtitles-recheck.fb2 --snapshot $S/subtitles-empty-lines-plain-titles.recheck.xml
node tests/scripts/run-script.mjs $P $B/regexp-titles-basic.fb2 --answer '{"regexp":"^[ \\xA0]*Глава[ \\xA0]+\\d+(\\..*)?[ \\xA0]*$","before":"1","after":"1"}' --snapshot $S/split-into-sections.titles.xml
node tests/scripts/run-script.mjs $P $B/regexp-titles-basic.fb2 --answer '{"regexp":"^[ \\xA0]*(\\*[ \\xA0]*){3}[ \\xA0]*$","before":"1","after":"1","action":"subtitles"}' --snapshot $S/split-into-sections.subtitles.xml
node tests/scripts/run-script.mjs $P $B/regexp-titles-basic.fb2 --answer '{"regexp":""}' --snapshot $S/split-into-sections.empty.xml
# re-recorded entries of the main suite: tests/scripts/run-all.sh --group 13 --filter subtitles-empty-lines; --group 08 --filter split-into-sections
```

## 14_Цитаты

10 scripts in 2.7.9: 10 new, 0 successors of converted packages. Not yet converted or rechecked.

## 16_Поиск форматирования

73 scripts in 2.7.9: **49 new, all converted** here (T057, T058), none left out; the 24 successors of
the packages `01_` to `24_` converted from 2.7beta1 are brought up to their 2.7.9 versions
in "The recheck of 001-024" below (T084). Packages:
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
which 2.7.9 itself cannot load (its file is `012_…`); since the recheck the package `12_next-paragraph-with-sup`
resolves by its 2.7.9 path `012_…` (and by its id), not by `12_…` - see the recheck below and the
combos of group 31.

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
- Group gate: `tests/scripts/run-all.sh --group 16` - 85 snapshots (59 new, the 24 of 01-24 and
  the recheck's two chains) pass.

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

### The recheck of 001-024

24 scripts of 2.7.9 (001-024, *Перейти на предыдущий / следующий …*) are the successors of the
24 packages `01_` to `24_` converted from 2.7beta1 (task T084, the recheck of
`scripts/16_find-formatting/`; the 2.7beta1 conversion is in conversion-notes-c.md, group 16; the
49 scripts new in 2.7.9 are above in this section). All 24 **updated**; ids and
folders unchanged. Each package keeps its own engine `format-search.js` (24 identical copies) and
now also carries `nav-lib.js`, copied unchanged from the group's 2.7.9 packages (73 identical
copies); nothing is imported across packages.

What 2.7.9 changed (Sclex's v1.2 of all 24; 2.7beta1 had v1.0):
- **Return values.** `Run()` returns `"Found"` when it moved the caret and `"NotFound"` otherwise:
  nothing found ("Ничего не найдено, поиск завершен."), or Cancel at the question. 2.7beta1's
  returned nothing. Other scripts run them in loops that go on while the callee returns "Found"
  (2.7.9's combos 31/50 and 31/51, the commented examples of the run-scripts-by-list templates).
  Ported: `run()` returns the same strings, nothing for a selected picture (the original's early
  `return;`), and works from the selection the previous script of the run left.
- **The caret of the backward scripts** (odd numbers). 2.7beta1 placed it with
  `range1.collapse(false); if (range1.parentElement!==el && range1.move("character",-1)==1)
  range1.move("character",1);` - `parentElement` without parentheses is the method itself, never
  the element, and `TextRange.move` returns the units moved, negative backwards, so the step back
  was taken and the step forward never: the caret stayed one character before the end of the
  element found. 2.7.9 adds `if (scriptDirection=="backward") range1.move("character",1);`, so
  the caret is at the end of the element. The 2.7beta1 conversion already put it at the end of the
  run, which is now also 2.7.9's place: nothing to port (chain-marks: "Начало" n7:0-6 → n7:6).
- **Scrolling of the forward scripts**: `scrollIfItNeeds()` after the selection (50 pixels down
  when the selection is less than 20 pixels above the window's bottom edge). Not reproduced:
  `selection.set` scrolls the caret into view the editor's way (a difference).
- **The version** in `versionStr` (v1.0 → v1.2, still "Переход на …"): the name of the original's
  undo unit and of its error message. These scripts never change the book, and the editor reports
  a script error itself; `undoLabel` follows the 2.7.9 name, as every package's does.
- **Names**: *Переход на …* → *Перейти на …*; the file numbers are three digits (`001_` …
  `024_`); 13's typo *предыдующий* is gone from the file name. **Icons**: 2.7.9 has an `.ico` for
  001, 002, 004, 005, 006, 008, 009, 010, 012 and 016, 2.7beta1 for 01, 02, 05 and 06 only (the
  same four files, so their `icon.png` stays); 04, 08, 09, 10, 12 and 16 gained `icon.png` (16×16,
  converted with the audit tool's `ico_to_png`, as the skeletons were).
- Layout only: 014 declares `rang1` for `range1` (the variable becomes a global, no effect).

With the return values these scripts are building blocks of loops, so the rest of the engine was
brought to the originals as well - in 2.7beta1's conversion it differed in ways that matter in a
loop:
- **The whole book.** The originals walked FictionBook Editor's `fbw_body`: the book's annotation
  and its history first, then every body. 2.7beta1's conversion walked the bodies only, since the
  script API then exposed no description; `mfbe.doc.get()` does now, and the Body view shows the
  two blocks above the first body. The engine walks the same tree as the group's 2.7.9 packages
  (`nav-lib.js`: `loadBook`, `locate`, `setCaret`, `refusePicture`), so the annotation and the
  history are searched, and first, as in FictionBook Editor.
- **After the question** the originals went on from the other end of the book up to the selection
  only - a run the walk enters before it meets the selection counts, the caret's own paragraph
  included - and said "Ничего не найдено, поиск завершен." when they got there. 2.7beta1's
  conversion took the first (last) run of the book wherever it was: from the start of the book's
  only run it came back to that run ("found" for ever in a loop), and a book without the
  formatting got "Ничего не найдено…" without the question. Both as in 2.7.9 now.
- **The question** is the original's `confirm()`: OK and Cancel with the editor's own button
  labels (2.7beta1's conversion had Yes / No). The 24 snapshots of that conversion answer it with
  `--answer yes`; the harness presses the first button for an id it does not find, which is OK -
  the same continuation as before.
- **A picture inside an element** belongs to its run (the model gives an inline picture the marks
  around it): 2.7beta1's conversion split the run there, so `<emphasis>до <image/> после</emphasis>`
  was two stops; it is one in the original. An element holding a picture only is no stop, as
  `nonEmptyTag` wanted.
- **A selected block picture** is refused with the original's message ("Ошибка.\n\nВы используете
  тип выделения,\nкоторый не поддерживатся этим скриптом – …") and `run()` returns nothing.
  2.7beta1's conversion answered a missing selection with "Поставьте курсор в текст книги." - the
  API reports no selection only without a book, and the script now returns nothing then.
- The sticky status "Найдено: курсив" / "Found: italics" that 2.7beta1's conversion added is
  dropped: 2.7.9 shows none, and in a loop it would outlive the final "NotFound".

**The engine** (`format-search.js`): the runs of the mark per paragraph (`runsOf`) - a maximal
stretch of a paragraph's content that carries the mark, a picture carrying it included, that holds
text; adjacent elements of one kind are one run, as the originals' first loop passed them together.
Forward searches start at the end of the selection and stop at its start, backward ones the other
way round. First the run at the caret is passed (one that contains the caret or starts (forward) /
ends (backward) right at it) - the paragraph variants pass the caret's whole paragraph - then the
next run up to the book's end (start) gets the caret at its start (forward) or end (backward). With
none, the question; OK goes on from the other end up to the selection, Cancel returns "NotFound"
and leaves the selection. The six marks are `emphasis`, `strong`, `sup`, `sub`, `strikethrough` and
`code` (the originals: `I`/`EM`, `B`/`STRONG`, `SUP`, `SUB`, `STRIKE`, `SPAN.code`).

**How the expected results were worked out.** Before the first run, the 2.7.9 code itself was
ported to a small program (`getNextNodeInScriptDirection`, `nonEmptyTag`, `mySearch`, the
`<B>` markers `pasteHTML` put at the selection's start and end, the caret placement) and run on the
reference books as `files/fb2.xsl` of 2.7.9 renders them (`DIV.annotation`, `DIV.history`, a
`DIV.body` per body, a `P` for every text block and empty line, `SPAN.image > IMG` for an inline
picture). Every scenario ran twice, with the markers pasted inside and outside an element that
ends or starts at the caret (IE's choice is not known), and both gave the same results. Note that
the markers are `B` elements, which 005-008 count as bold; the port does the same, without effect.
Every `P` is inflated (`FixupParagraphs`), so the first loop always ends at the next paragraph.

**Reference book** `tests/scripts/fixtures/279/16/marks.fb2` (valid FB2 2.1): an annotation with
italics and code (n28), a history with bold (n30), the body's title with a subscript (n3), the
section's title with strikethrough (n6); italics at a paragraph's start, middle and end (n7),
adjacent italic elements and italics around and after bold (n8), italics around an inline picture
and an italic holding a picture only (n9), an empty line, one paragraph with bold, code, the book's
only superscript, a subscript and strikethrough (n13), a block picture, a poem's verse with italics
(n17) and its text author with bold (n18), a table cell with code (n21), a last paragraph ending
in italics (n23), and a notes body with a subscript and strikethrough (n26).

**Tests**: two chain drivers (`tests/scripts/fixtures/279/16/chains/marks/` and `…/conv-c-16/`,
test packages, never bundled) run the packages through `mfbe.scripts.run` by their 2.7.9 paths -
as the combos do, `ctx.startedBy: 'script'` - from given selections and write one line per call to
the clipboard: `<NN> from <start> #<call>: <run() value> <anchor>-<head> "<text>"`, or `error
<code>` for a reference that does not resolve. The harness records it in `<snapshot>.outputs.json`.
- `16/chain-marks.xml` (marks.fb2, `--answer cancel --answer cancel`, every later message box OK):
  124 calls, 30 questions and 4 "Ничего не найдено…"; every line and every message box equals the
  ported 2.7.9 code's result.
- `16/chain-conv-c-16.xml` (conv-c-16.fb2): each of the 24 once from n9:5, the selection of the
  existing snapshots; 10 questions (OK). The results are those 2.7beta1's conversion recorded,
  now with "Found": previous italics n8:41, next italics n12:18, next paragraph with bold n12:11,
  previous bold / superscript / subscript / strikethrough / code after the question n36:19,
  n28:23, n26:25, n27:16, n26:14, next superscript n9:24, next paragraph with superscript n19:6,
  next subscript n11:8, next strikethrough n11:25 and next code n11:47 (the start of «кодом»; the
  old notes said n11:40).
- The 24 snapshots of 2.7beta1's conversion (`suite.json`, conv-c-16.fb2, `--select n9:5:5 --answer
  yes`) are not re-recorded: no run changes the book, so their expected result is unchanged (each
  equals `chain-conv-c-16.xml`). Both chain books come back as the editor writes them (the
  editor's own merging of `<emphasis>раз</emphasis><emphasis>два</emphasis>` and dropping of an
  empty `<emphasis/>`).
- Group gate: `tests/scripts/run-all.sh --group 16` - 85 snapshots (2 added) pass, no package
  without Ukrainian names.

**Numbering.** The 2.7.9 files carry three-digit numbers (`001_` … `024_`) where 2.7beta1's had two,
and `legacy.source` of each package is now its 2.7.9 path, which `mfbe.scripts.run` resolves
(separators, case and a leading backslash do not count), as does the id. 2.7.9's own callers still
write two digits: 31/50 and 31/51 run `16_Поиск форматирования\\12_Перейти на следующий абзац с
верхним индексом.js` - a file 2.7.9 does not have, so in 2.7.9 these two combos only show "Скрипт …
не был запущен, т.к. не удалось его успешно загрузить…" and their loop ends at once; and the
commented-out examples of 15 scripts (09/38-39, 13/590, 14/057-062, 31/32-33, 31/50-51, 37/06-07)
name `16_Поиск форматирования\\24_Перейти на следующий абзац, содержащий код.js`, which would fail
the same way when uncommented. Here both two-digit names get `scripts.notFound`, as does
2.7beta1's `12_Переход на …` (no bundled script calls these packages by it); `012_…` and the ids
resolve (chain-marks, last five lines). Recorded as open questions of 012 and 024: the conversion
of the callers (T066 and the groups' tasks) names `012_…` / `024_…` or the id - a clear fix of the
caller - unless the requester prefers the resolver to ignore a leading zero of the number (an API
change, not made here).

**Differences that remain** (each entry of `updates-279/16-recheck.json` lists those of its
script):
- *A selected inline picture* counts as a one-character text selection and the search starts from
  it (chain-marks: n9:12-13); FictionBook Editor took a clicked inline picture for a control
  selection and refused it, as it refuses a block picture here. The script API reports an inline
  picture as part of its paragraph's text.
- *Scrolling* (the forward scripts): 2.7.9's `scrollIfItNeeds` is not reproduced, see above.
- *Code* (021-024): a named style "code" (`<style name="code">`), which FictionBook Editor showed as
  `<span class="code">` like `<code>` and so found as well, is not found: the model tells a style
  from the code mark, and the scripts mean `<code>`.
- *Size*: above the API's 64 MB document snapshot the annotation and history are not read and are
  left out of the walk (`nav-lib.js`).

No fixes. The manifests' own texts were corrected on the way: 10's English undo label said
"previous", and the descriptions of the backward paragraph variants said the caret went to the
first run of the paragraph where it goes to the end of the last one.

### 001 Перейти на предыдущий курсив

`01_previous-emphasis`, `16/previous-emphasis` (2.7beta1 *01_Переход на предыдущий курсив*):
updated. en *Go to previous italics*, uk *Перейти до попереднього курсиву*. Chain marks from the
end of the book (n26:36): n23:26, n17:13, n9:19 (the run around the picture, one stop), n8:36, n8:14
(the adjacent elements, one stop), n7:31, n7:23, n7:6, n28:20 (the annotation), the question (OK),
n23:26 - all "Found"; from the selected run n7:15-23: n7:6; from the selected inline picture
n9:12-13: n8:36. Chain conv-c-16: n8:41. Differences: inline picture, size.

### 002 Перейти на следующий курсив

`02_next-emphasis`, `16/next-emphasis`: updated. en *Go to next italics*, uk *Перейти до
наступного курсиву*. Chain marks from the start (n28:0): n28:12 (the annotation), n7:0, n7:15,
n7:26, n8:8 (n8:8-14, the adjacent elements), n8:23, n9:9 (the picture-only italic n9:21 is no
stop), n17:5, n23:18, the question (OK), n28:12; from n7:15-23: n7:26; from n9:12-13: n17:5; from the
end of the last run n23:26: the question, Cancel, "NotFound", the caret stays. Chain conv-c-16:
n12:18. Differences: inline picture, scrolling, size.

### 003 Перейти на предыдущий абзац с курсивом

`03_previous-paragraph-with-emphasis`, `16/previous-paragraph-with-emphasis`: updated. en *Go to
previous paragraph with italics*, uk *Перейти до попереднього абзацу з курсивом*. Chain marks from
n26:36: n23:26, n17:13, n9:19, n8:36, n7:31 (each the end of the paragraph's last run), n28:20,
the question (OK), n23:26. Chain conv-c-16: n8:41. Differences: inline picture, size.

### 004 Перейти на следующий абзац с курсивом

`04_next-paragraph-with-emphasis`, `16/next-paragraph-with-emphasis`: updated; gained its icon. en
*Go to next paragraph with italics*, uk *Перейти до наступного абзацу з курсивом*. Chain marks from
n28:0: n7:0, n8:8, n9:9, n17:5, n23:18 (the caret's own paragraph n28 is passed), the question
(OK), n28:12. Chain conv-c-16: n12:18. Differences: inline picture, scrolling, size.

### 005 Перейти на предыдущую жирность

`05_previous-strong`, `16/previous-strong`: updated. en *Go to previous bold*, uk *Перейти до
попереднього жирного шрифту*. Chain marks from n26:36: n18:11 (the text author), n13:11, n8:29
(bold around italics), n30:16 (the history), the question (OK), n18:11. Chain conv-c-16: the
question, n36:19 (the notes). Differences: inline picture, size.

### 006 Перейти на следующую жирность

`06_next-strong`, `16/next-strong`: updated. en *Go to next bold*, uk *Перейти до наступного
жирного шрифту*. Chain marks from n28:0: n30:10, n8:16, n13:5, n18:5, the question (OK), n30:10.
Chain conv-c-16: n9:8. Differences: inline picture, scrolling, size.

### 007 Перейти на предыдущий абзац с жирностью

`07_previous-paragraph-with-strong`, `16/previous-paragraph-with-strong`: updated. en *Go to
previous paragraph with bold*, uk *Перейти до попереднього абзацу з жирним шрифтом*. Chain marks
from n26:36: n18:11, n13:11, n8:29, n30:16, the question (OK), n18:11. Chain conv-c-16: the
question, n36:19. Differences: inline picture, size.

### 008 Перейти на следующий абзац с жирностью

`08_next-paragraph-with-strong`, `16/next-paragraph-with-strong`: updated; gained its icon. en *Go
to next paragraph with bold*, uk *Перейти до наступного абзацу з жирним шрифтом*. Chain marks from
n28:0: n30:10, n8:16, n13:5, n18:5, the question (OK), n30:10. Chain conv-c-16: n12:11 (the bold of
the caret's own paragraph n9 is passed). Differences: inline picture, scrolling, size.

### 009 Перейти на предыдущий верхний индекс

`09_previous-sup`, `16/previous-sup`: updated; gained its icon. en *Go to previous superscript*, uk
*Перейти до попереднього верхнього індексу*. marks.fb2 has one superscript (n13:18-22). Chain marks
from n26:36: n13:22, then the question (OK), "Ничего не найдено, поиск завершен.", "NotFound"
with the caret left at n13:22; from inside the run (n13:20): the question (OK), n13:22 - the run
holds text after the selection, so the walk from the end finds it before it meets the selection.
Chain conv-c-16: the question, n28:23 (the subtitle). Differences: inline picture, size.

### 010 Перейти на следующий верхний индекс

`10_next-sup`, `16/next-sup`: updated; gained its icon. en *Go to next superscript*, uk *Перейти до
наступного верхнього індексу*. Chain marks from n28:0: n13:18, then the question (OK), "Ничего не
найдено…", "NotFound" (2.7beta1's conversion went back to n13:18, "found"); from n13:20: the
question (OK), n13:18. Chain conv-c-16: n9:24. Differences: inline picture, scrolling, size.

### 011 Перейти на предыдущий абзац с верхним индексом

`11_previous-paragraph-with-sup`, `16/previous-paragraph-with-sup`: updated. en *Go to previous
paragraph with superscript*, uk *Перейти до попереднього абзацу з верхнім індексом*. Chain marks
from n26:36: n13:22, then the question (OK), "Ничего не найдено…", "NotFound"; from the start of
n13 (n13:0): the question (OK), n13:22 - the caret's own paragraph counts after the question.
Chain conv-c-16: the question, n28:23. Differences: inline picture, size.

### 012 Перейти на следующий абзац с верхним индексом

`12_next-paragraph-with-sup`, `16/next-paragraph-with-sup`: updated; gained its icon. en *Go to
next paragraph with superscript*, uk *Перейти до наступного абзацу з верхнім індексом*. Chain marks
from n28:0: n13:18, then the question (OK), "Ничего не найдено…", "NotFound"; from the end of n13
(n13:49): the question (OK), n13:18; by the path `\16_Поиск форматирования\012_…` from n28:0: n13:18.
Chain conv-c-16: n19:6 (the epigraph's text author). Differences: inline picture, scrolling, size.
Open question: 2.7.9's combos 31/50-51 call it as `12_…`, see Numbering.

### 013 Перейти на предыдущий нижний индекс

`13_previous-sub`, `16/previous-sub` (2.7beta1 *13_Переход на предыдующий нижний индекс*, whose
typo the old `legacy.source` kept; the 2.7.9 file has none): updated. en *Go to previous subscript*, uk *Перейти до
попереднього нижнього індексу*. Chain marks from n26:36: n26:21 (the notes), n13:27, n3:8 (the
body's title), the question (OK), n26:21. Chain conv-c-16: the question, n26:25. Differences:
inline picture, size.

### 014 Перейти на следующий нижний индекс

`14_next-sub`, `16/next-sub`: updated. en *Go to next subscript*, uk *Перейти до наступного
нижнього індексу*. Chain marks from n28:0: n3:7, n13:24, n26:13, the question (OK), n3:7. Chain
conv-c-16: n11:8. Differences: inline picture, scrolling, size.

### 015 Перейти на предыдущий абзац с нижним индексом

`15_previous-paragraph-with-sub`, `16/previous-paragraph-with-sub`: updated. en *Go to previous
paragraph with subscript*, uk *Перейти до попереднього абзацу з нижнім індексом*. Chain marks from
n26:36: n13:27, n3:8 (the caret's own paragraph n26 is passed), the question (OK), n26:21 (the
walk from the end meets n26 before the selection in n3), n13:27. Chain conv-c-16: the question,
n26:25. Differences: inline picture, size.

### 016 Перейти на следующий абзац с нижним индексом

`16_next-paragraph-with-sub`, `16/next-paragraph-with-sub`: updated; gained its icon. en *Go to
next paragraph with subscript*, uk *Перейти до наступного абзацу з нижнім індексом*. Chain marks
from n28:0: n3:7, n13:24, n26:13, the question (OK), n3:7. Chain conv-c-16: n11:8. Differences:
inline picture, scrolling, size.

### 017 Перейти на предыдущее зачеркивание

`17_previous-strikethrough`, `16/previous-strikethrough`: updated. en *Go to previous
strikethrough*, uk *Перейти до попереднього закреслення*. Chain marks from n26:36: n26:35, n13:40,
n6:12 (the section's title), the question (OK), n26:35. Chain conv-c-16: the question, n27:16 (the
cite's text author). Differences: inline picture, size.

### 018 Перейти на следующее зачеркивание

`18_next-strikethrough`, `16/next-strikethrough`: updated. en *Go to next strikethrough*, uk
*Перейти до наступного закреслення*. Chain marks from n28:0: n6:6, n13:29, n26:24, the question
(OK), n6:6. Chain conv-c-16: n11:25. Differences: inline picture, scrolling, size.

### 019 Перейти на предыдущий абзац, содержащий зачеркивание

`19_previous-paragraph-with-strikethrough`, `16/previous-paragraph-with-strikethrough`: updated. en
*Go to previous paragraph containing strikethrough*, uk *Перейти до попереднього абзацу, що містить
закреслення*. Chain marks from n26:36: n13:40, n6:12, the question (OK), n26:35, n13:40. Chain
conv-c-16: the question, n27:16. Differences: inline picture, size.

### 020 Перейти на следующий абзац, содержащий зачеркивание

`20_next-paragraph-with-strikethrough`, `16/next-paragraph-with-strikethrough`: updated. en *Go to
next paragraph containing strikethrough*, uk *Перейти до наступного абзацу, що містить
закреслення*. Chain marks from n28:0: n6:6, n13:29, n26:24, the question (OK), n6:6. Chain
conv-c-16: n11:25. Differences: inline picture, scrolling, size.

### 021 Перейти на предыдущий код

`21_previous-code`, `16/previous-code`: updated. en *Go to previous code*, uk *Перейти до
попереднього коду*. Chain marks from n26:36: n21:6 (the table cell), n13:16, n28:28 (the
annotation), the question (OK), n21:6. Chain conv-c-16: the question, n26:14 (the cite).
Differences: inline picture, named style "code", size.

### 022 Перейти на следующий код

`22_next-code`, `16/next-code`: updated. en *Go to next code*, uk *Перейти до наступного коду*.
Chain marks from n28:0: n28:23, n13:13, n21:0, the question (OK), n28:23. Chain conv-c-16: n11:47.
Differences: inline picture, scrolling, named style "code", size.

### 023 Перейти на предыдущий абзац, содержащий код

`23_previous-paragraph-with-code`, `16/previous-paragraph-with-code`: updated. en *Go to previous
paragraph containing code*, uk *Перейти до попереднього абзацу, що містить код*. Chain marks from
n26:36: n21:6, n13:16, n28:28, the question (OK), n21:6; from the start of the book (n28:0): the
question, Cancel, "NotFound", the caret stays. Chain conv-c-16: the question, n26:14. Differences:
inline picture, named style "code", size.

### 024 Перейти на следующий абзац, содержащий код

`24_next-paragraph-with-code`, `16/next-paragraph-with-code`: updated. en *Go to next paragraph
containing code*, uk *Перейти до наступного абзацу, що містить код*. Chain marks from n28:0: n13:13,
n21:0 (the caret's own paragraph n28 is passed), the question (OK), n28:23 (now the walk from the
start meets the annotation before the selection), n13:13; by the id `16/next-paragraph-with-code`
from n28:0: n13:13. Chain conv-c-16: n11:47. Differences: inline picture, scrolling, named style
"code", size. Open question: the templates' examples name it `24_…`, see Numbering.

### Harness commands of the recheck

```bash
C=tests/scripts/fixtures/279/16/chains; S=tests/scripts/snapshots/16
node tests/scripts/run-script.mjs $C/marks tests/scripts/fixtures/279/16/marks.fb2 --answer cancel --answer cancel --snapshot $S/chain-marks.xml
node tests/scripts/run-script.mjs $C/conv-c-16 tests/scripts/fixtures/books/conv-c-16.fb2 --snapshot $S/chain-conv-c-16.xml
```

## 17_Перенос примечаний в скобки

3 scripts in 2.7.9, all successors of the 3 packages converted from 2.7beta1 (task T085, its
group 17 part: recheck of `scripts/17_notes-to-brackets/`; the 2.7beta1 conversion is in
conversion-notes-c.md, group 17). All 3 **updated**; ids and folders unchanged.

What 2.7.9 changed (Sclex's v1.2 of 01 and 02, v1.1 of 03):
- **The escaping of the note text.** The scripts rebuild the note as HTML before they insert it
  in brackets. 2.7beta1's `ampRegExp` was `/>/g` → `&gt;`, a slip, so an ampersand was never
  escaped and text such as "&lt;b&gt;", "&amp;" or "&copy;" written in a note came back decoded
  ("<b>", "&", "©"); 2.7.9 escapes "&" first, then "<" and ">", so the text stays as written.
  The conversion copies the note's inline nodes and never rebuilt HTML, so its result already
  was 2.7.9's; the new snapshots show it.
- **The version** in the final message of 01 and 02: *Перенос примечаний в скобки v1.2. Автор
  Sclex.* (it was v1.1); ported, in English *Move notes into brackets v1.2. Author: Sclex.* 03's
  version string (now v1.1) is never shown and stays in the index as the original's notice.
- **«раздел» for «секция»**, in the comments and in 03's message on nested sections in the notes
  body: *В body … есть разделы второго уровня вложения…* (the conversion's text names the body,
  `notes` or `comments`, where the original always said *примечаний*; it was kept so).
- The names (*Перенос …* → *Перенести …*) and icons: the three scripts have an `.ico` in 2.7.9,
  so the packages gained `icon.png` (16×16, converted with the audit tool's `ico_to_png`, as the
  skeletons were).

Ported as described, in each package's own copies of `notes-lib.js` (three identical copies) and
`move-all.js` (two). The indexes name the 2.7.9 originals and keep their notice, the version
line `var versionStr="… v1.2. Автор Sclex."` / `"… v1.1. Автор Sclex."` (`check-notices.py`
finds the author credit the message shows); `legacy` is 2.7.9's file with `sourceVersion` "1.2",
"1.2" and "1.1". The conversion's own texts follow 2.7.9's word too: 03's message when a note is
the only section of its body (*Раздел примечания «…» удалить не удалось — это единственный
раздел тела…*) and 03's description. The comment in `move-all.js` that said the script API could
not remove a body is corrected (`doc.removeNode` removes a notes or comments body; the fallback
stays). Every package gained `name.uk` and `description.uk`.

Reference book `tests/scripts/fixtures/279/17/escapes.fb2` (valid FB2 2.1): one paragraph with
links to two notes; note 1 holds written-out entities ("&lt;b&gt;жирный&lt;/b&gt;", "&amp;",
"&copy;", and "&quot;…&quot;" inside emphasis), note 2 a plain "&", "<" and ">". The existing
snapshots on `conv-c-17.fb2` and `conv-c-17-comments.fb2` stay: their books hold none of these
characters, and the book after a run is the same as before (only a message changed). No fixes.

### 01 Перенести примечания в скобки

`scripts/17_notes-to-brackets/01_notes-into-brackets`, id `17/notes-into-brackets` (2.7beta1
*01_Перенос примечаний в скобки*): updated. en *Move notes into brackets*, uk *Перенести примітки
в дужки*. Added `notes-into-brackets.escapes.xml`. Expected and obtained: the paragraph becomes
"Буквальные сущности[Буквально: &lt;b&gt;жирный&lt;/b&gt;, &amp; и &copy; в
<emphasis>курсиве &quot;с кавычками&quot;</emphasis>.] и амперсанд[Tom & Jerry, AT&T, a < b > c.]
в тексте примечаний." (the text as written, the emphasis kept), the notes body is removed, and
the message counts 2 (2.7beta1 would have made the first bracket "[Буквально: <b>жирный</b>, & и
© в …]"). No differences.

### 02 Перенести примечания в скобки (пробел перед открывающей скобкой)

`scripts/17_notes-to-brackets/02_notes-into-brackets-with-space`, id
`17/notes-into-brackets-with-space`: updated. en *Move notes into brackets (space before the
opening bracket)*, uk *Перенести примітки в дужки (пробіл перед відкривною дужкою)*. Added
`notes-into-brackets-with-space.escapes.xml`: as 01, with a space in front of each opening
bracket. No differences.

### 03 Перенести одно примечание в скобки

`scripts/17_notes-to-brackets/03_one-note-into-brackets`, id `17/one-note-into-brackets`
(2.7beta1 *03_Перенос одного примечания в скобки*): updated. en *Move one note into brackets*,
uk *Перенести одну примітку в дужки*. Added `one-note-into-brackets.escapes.xml` (`--select
n14:3:3`, the caret in note 1). Expected and obtained: the reference to note 1 becomes " [Буквально:
&lt;b&gt;жирный&lt;/b&gt;, &amp; и &copy; в <emphasis>курсиве &quot;с кавычками&quot;</emphasis>.]"
with the leading space, the section is removed, note 2 becomes note 1 (id `n_1`, title "1") and
its link "[1]" pointing to `#n_1`. Differences (from the 0.0.1 conversion, still true against
2.7.9): with the caret outside a note, or on a note nothing refers to, the original did nothing
at all, a status line says so here; a note that is the only section of its body is not removed
(a body keeps at least one section) and the script says so, where the original left an empty
notes body.

### Harness commands

```bash
G=scripts/17_notes-to-brackets; B=tests/scripts/fixtures/279/17/escapes.fb2; S=tests/scripts/snapshots/17
node tests/scripts/run-script.mjs $G/01_notes-into-brackets $B --snapshot $S/notes-into-brackets.escapes.xml
node tests/scripts/run-script.mjs $G/02_notes-into-brackets-with-space $B --snapshot $S/notes-into-brackets-with-space.escapes.xml
node tests/scripts/run-script.mjs $G/03_one-note-into-brackets $B --select n14:3:3 --snapshot $S/one-note-into-brackets.escapes.xml
```

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

Recheck (T086) of the two packages converted from 2.7beta1 whose 2.7.9 successors are in this
group: `01_Обзор и превращение элементов...` (`19/element-browser`, v1.8 → v4.2, a major change)
and `05_Снять форматирование блочным элементом` (`18/unwrap-poem-cite-epigraph`, v1.3 → v2.7,
moved here from `18_Мелочи редактирования/03_Снятие форматирования стихом, цитатой или
эпиграфом.js`; a major change). Both are **updated**: `legacy` names the 2.7.9 file
(`fbeVersion` "2.7.9", no `sourceVersion`: the versions are in the code only), `name.ru` and
`undoLabel.ru` are the 2.7.9 names, every name and description has its `uk`, `index.js` keeps the
2.7.9 notice (`check-notices.py --package`: OK for both). Ids and folders stay. The 25 packages
converted from 2.7.9 in this group are not touched.

**How the expected results were found.** Both originals restructure FictionBook Editor's page with
long DOM procedures (removeNode, insertAdjacentHTML, markers), too intricate to trace by hand
over many cases. A scratch emulation of the 2.7.9 page (never shipped) built the page as
`files/fb2.xsl` renders a book - containers as `DIV.<element>`, text blocks as `P` (`P.subtitle`,
`P.text-author` for authors and dates, `P.td` / `P.th`, an empty line an empty `P`), no text
between blocks - ran the originals' code unmodified on it (only JScript's `inflateBlock(x)=true`
assignment removed, the IE methods `removeNode`, `applyElement`, `innerText` and the text range
supplied) and wrote the page back as 2.7.9 saved it (`CFBEView::Normalize`, `FBDoc.cpp`
`ProcessDiv` / `ProcessP`). It reproduces the six existing `element-browser` snapshots and the
unchanged `unwrap` one exactly; every snapshot below equals its result in a canonical form (the
block tree, text runs with their marks), except where a fix or a recorded difference applies, and
for those the emulation with the fix applied as a minimal patch of the original gives the
snapshot.

### 01 Обзор и превращение элементов...

`scripts/19_formatting/element-browser`, id `19/element-browser`. **Updated.** 2.7.9 rewrote the
dialog's frame 2 (v4.2); the script file only passes two word lists more. What changed, and how
it was ported:

- **Kinds.** Only the titles of sections are listed (2.7.9 commented the titles of poems and
  stanzas out of its list); the kinds carry Russian labels (Заголовки разделов, Подзаголовки,
  Курсив, Жирность, Верхние индексы, Нижние индексы, Зачеркивание).
- **List labels.** Up to 160 characters of an element (was 50), then `<...>`.
- **Titles as subtitles framed by empty lines** - new, and the default for titles. The other
  targets: subtitles, text; for subtitles: titles, text; for runs: text or another style (all with
  2.7.9's labels). Converting title lines restructures the book as 2.7.9 does, which the earlier
  conversion had simplified (it replaced a whole title in place): a section whose whole title
  becomes subtitles or text **merges into the section before it** (the previous one of an
  ancestor when it has none, the deepest last subsection; in place when there is none at all),
  its epigraphs and annotation becoming text, its subsections moving up a level; selected lines
  at the start of a title go to the end of the section before; an unselected run between selected
  lines becomes the title of a new section in front. In the framed mode each group of subtitles
  gets an empty line before and after it, empty lines already there serve, and consecutive
  subtitles gather into one group (a subtitle merged after a section ending with a subtitle and an
  empty line joins that subtitle in front of the empty line); in the plain subtitle mode the
  empty lines after a gathered group go.
- **Subtitles as titles.** The content in front of the subtitle now goes to the end of the
  previous container of the same kind unless the container starts with a title (2.7beta1: unless
  it starts with any `DIV`, so a section starting with a cite got a new section). The warning for
  subtitles in cites has 2.7.9's longer text.
- **Case** (the context menu of titles and subtitles, only there as in the original - the earlier
  conversion offered it for every kind): ten modes, 2.7.9's texts. «Первая буква большая,
  остальные маленькие» upper-cases the first character (the second after « or "); after the first
  full stop; after every full stop; after `.`, `!`, `?`; the second "word" or the N-th (asked,
  with the original's three error messages) in capitals; all upper / all lower; the first letter
  of every word, with the dates (`1990 г.`, `XIV–XV вв.`) and hyphenated words as 2.7.9 treats
  them; and the same with the short words lower case (but at the start) and the abbreviations
  upper case. The two "every word" modes run 2.7.9's expressions verbatim on the IE notation of
  the element (`lib/legacy-html.js`, copied unchanged), the word lists as 2.7.9's `.js` wrote them
  (its Roman numerals I…MMMMM generated: the same 5000 entries in the same order).

Port: `page.js` reads a body into the shape of 2.7.9's page and runs
`reformatTitlesToSubtitlesOrText`, `moveHtmlCodeIntoTargetContainer`,
`moveBlockIntoPreviousBlock`, `moving1`, `createTargetContainer` and `reformatSubtitlesToTitles`
statement by statement on it; the changed bodies are written back with `doc.replaceNode` (nodes
that only moved keep their ids; a container the procedure empties goes, one empty in the book
already stays). Subtitles
as text and runs as another style are unchanged since 2.7beta1. `case-modes.js` holds the case
changes, the original's expression lines copied as written.

Snapshots. The six existing runs on `conv-c-19.fb2` give 2.7.9's result unchanged (checked with
the emulation) and pass as recorded. Added (`tests/scripts/snapshots/19/suite.json`, books
`tests/scripts/fixtures/279/19/element-browser.fb2` and `element-browser-case.fb2`):
- `element-browser.titles-to-framed-subtitles.xml`: the whole titles of chapters 2-5 framed - each
  merges into the chapter before; chapter 3's epigraph, author and annotation become text; the
  empty line ending chapter 3 and the one opening chapter 4 frame «Глава 4 / Название четвёртой
  главы»; chapter 5's lines gather with chapter 4's closing `* * *` and «Подзаголовок пятой главы» into
  one group, an empty line added in front of it;
- `.part.xml`: the title of a part with an epigraph and two chapters - the part merges into
  chapter 5, its chapters move up a level;
- `.lines.xml`: a middle line of chapter 7's title (a new section with «Глава 7» as its title and
  the framed subtitle) and the first line of chapter 8's (to the end of chapter 7); fix 2;
- `.leading.xml`: the first lines of chapters 4 and 5 - into the end of chapter 3 (fix 1) and in
  front of the empty line after chapter 4's `* * *`;
- `element-browser.titles-to-subtitles.merge.xml`: plain subtitles - chapter 1 in place (no section
  before it), chapters 3-5 merged, the empty line after chapter 4's gathered subtitles gone,
  chapter 10 (only a subtitle) merged into chapter 9; fix 3;
- `element-browser.titles-to-text.merge.xml`: text - chapters 1, 3 and 4, and chapter 6, the first
  subsection of a part (an untitled section in its place);
- `element-browser.case-modes.xml`: the ten modes on title lines and subtitles in one run, an
  invalid word number (`x`, message, nothing changes) and N = 3;
- `element-browser.subtitles-to-titles.containers.xml`: a subtitle right after a title (joins
  it), one in a cite (warning), one after a cite in an untitled section (the cite and its
  paragraph go to the end of the chapter before), one after an epigraph in an untitled section
  (a new section: the difference below).

Fixes (FR-023):
1. Leading title lines moved to a previous section ending with empty lines not preceded by a
   subtitle were lost and the script stopped with an error: `else if (isSubtitle(…))` repeated
   the `if` condition, so the lines, already out of the title, were inserted nowhere and
   `markerEnd` was null. They go to the end of that section (an empty line after them when
   framed) - the branch's own body.
2. Framed mode, selection going on in a later title: the last unselected lines of a title got two
   empty lines around an insertion of nothing. Nothing is inserted.
3. Merging a section of nothing but subtitles after a section ending with a subtitle and an empty
   line stopped with a script error (`tt.nextSibling` of nothing in `moving1`). It completes.
4. The N-th word number is decimal (JScript's `eval` read `010` as octal 8).

Differences: the dialog as forms (plain-text list without formatting or link tooltips, no
"selected" counter, no Ctrl+A, no jump to the element, Undo/Redo as Edit > Undo after the run,
"Выполнено." and the counts in the status bar); where FB2 allows a subtitle's preceding content
nowhere at the end of the previous container (after subsections, or starting with an epigraph or
annotation) a new container takes it, as in 2.7beta1 (2.7.9 wrote invalid FB2); a subtitle in a
section's annotation stays a subtitle; an edit the schema still refuses is reported and its body
left as it was.

Open questions (2.7.9's behaviour kept): the first character rather than the first letter is
upper-cased (`— и снова Глава` → `— и снова глава`); the abbreviation list is matched ignoring
case and upper-cased, so `КоАП`, `СНиП`, `СПбГУ` come out in capitals; an empty line goes in front
of a subtitle that becomes the first child of an empty container in every mode, the condition
`&& "subtitles with empty lines before and after"` being a string (reached only in rare
structures).

### 05 Снять форматирование блочным элементом

The package follows 2.7.9 into this group at place 05: it moved from
`scripts/18_editing/03_unwrap-poem-cite-epigraph` to `scripts/19_formatting/05_unwrap-poem-cite-epigraph`;
its id `18/unwrap-poem-cite-epigraph` is kept, so hotkeys, Scripts toolbar buttons and Last script
keep running it (FR-028), and its snapshots stay under `tests/scripts/snapshots/18/`.

`scripts/19_formatting/05_unwrap-poem-cite-epigraph`, id `18/unwrap-poem-cite-epigraph` (the id of
the 2.7beta1 script). **Updated**; `legacy.source` is now the 2.7.9 path, which the combos of
2.7.9 run (13/590, the templates 31/32 and 31/33 and others in their examples) - both spellings,
with and without the leading backslash, resolve (`.chain` snapshot). The icon is the 2.7.9 one
(`.ico` new in 2.7.9, converted with the audit tool's `ico_to_png`).

What 2.7.9 changed, all ported (`index.js`; containers through `lib/containers.js` and the book
annotation through `lib/text-blocks.js`, both copied unchanged from the group):
- **The selection.** A text selection no longer stops the script with "При запуске скрипта не
  должно быть выделения": it counts from its start (`tr.collapse(true)`); a selected picture does
  nothing. Combos select a title, poem or cite and then call this script.
- **More elements.** The innermost poem, epigraph, cite, **title, annotation or table** around
  the start; a poem's title or epigraph means the poem.
- **Flattening.** A poem: everything in it becomes paragraphs - title, epigraph and its author,
  stanza titles, verses, subtitles, author and date - with an empty line between two stanzas that
  follow each other (`<P>&nbsp;</P>`, saved as `<empty-line/>`). A cite: everything in it becomes
  paragraphs, its subtitles, poems (without stanza breaks) and tables too (2.7beta1 changed its
  authors only).
- **Epigraph:** it and the epigraphs and annotation right after it (flattened). **Title:** the
  epigraphs and annotation after it, then the title (a stanza's title becomes verses). **Table:**
  rows go, every cell a paragraph without its id, style, alignment and spans. **Annotation** of a
  section: its content in its place as it is; the book annotation stays.
- **Before subsections** (a title, epigraph or annotation of a body or a section of sections and
  the ones after it): their text opens the first subsection when it starts with text, a cite, a
  poem or a table, or else becomes a new untitled section in front of it.

Snapshots. On `conv-c-18.fb2`: `unwrap-poem-cite-epigraph.xml` **re-recorded** - 2.7.9 puts an
empty line between the poem's two stanzas; `.cite.xml` **re-recorded** - the cite's subtitle
becomes a paragraph too; `.epigraph.xml` unchanged (2.7.9 gives the same). Added
(`tests/scripts/snapshots/19/suite.json`, files in `snapshots/18/` as the id says, book
`tests/scripts/fixtures/279/19/block-elements.fb2`): `.title` (chapter 1's title with its two
epigraphs and annotation), `.epigraphs` (the second epigraph and the annotation after it),
`.title-picture` (difference), `.body-title` (the book's title and epigraph → an untitled section
before chapter 1), `.part-title` and `.part-epigraph` (into the first subsection, which starts with
text), `.part-title-new-section` (a new section: the subsection has a title), `.poem-stanzas`,
`.poem-epigraph` (the same: the poem), `.stanza-title`, `.cite-contents`, `.table` (two blank cells
→ empty lines), `.annotation` (its subtitle and poem stay), `.paragraph` (nothing), `.selection`
(a selection from the cite into the next paragraph: the cite), `.book-annotation-cite` (through
`setDescription`), `.book-annotation` (nothing), and `.chain`: the chain runner does what 2.7.9's
"while (select the next poem) { 05 }" loops do - `16/next-poem` and this script by its 2.7.9 path,
four times, then `NotFound`; the report (`.chain.outputs.json`) shows each run leaving the caret
on the first paragraph that came out, and the book equals four runs of the original in a row.

Differences: where 2.7.9's result was invalid FB2 the text goes to the first place the schema
accepts - after a section's picture and annotation that stay (`.title-picture`; 2.7.9 left the
annotation after paragraphs), into a section of its own before subsections, after a stanza's
subtitle; attributes a paragraph cannot have are dropped (a cell's spans or alignment in a cite's
table); a blank cell is an empty line, as 2.7.9 saved it; a cell's language stays; a cite, poem
or table of the book annotation or history is dissolved through `doc.setDescription`; the caret
is put at the start of the first paragraph that came out (2.7.9 left the browser's selection); a
status-bar line when the caret is in none of the elements. The package stays in
`scripts/18_editing/` (recheck rule 2), so the menu shows it in Мелочи редактирования, not in
2.7.9's Обработка форматирования.

Open question (kept as 2.7.9): a poem's title or epigraph means the poem, a stanza's title only
that title - so 13/590 «Расформатировать все заголовки_Комбо» ("select the next title", then this
script) dissolves every poem whose title it meets, and a "select the next poem" loop leaves a poem
whose first stanza has a title (`.chain`: the third poem keeps its stanza, only its title became a
verse).

### Harness commands

```bash
F=tests/scripts/fixtures/279/19; S=tests/scripts/snapshots
node tests/scripts/run-script.mjs scripts/19_formatting/element-browser $F/element-browser.fb2 \
     --answer '{"kind":"titles"}' --answer '{"items":["n24:0","n32:0"],"action":"subtitlesWithEmptyLines"}' --answer cancel \
     --snapshot $S/19/element-browser.titles-to-framed-subtitles.leading.xml
node tests/scripts/run-script.mjs scripts/19_formatting/05_unwrap-poem-cite-epigraph $F/block-elements.fb2 \
     --select-range n74:2-n85:5 --snapshot $S/18/unwrap-poem-cite-epigraph.selection.xml
node tests/scripts/run-script.mjs $F/chain-runner $F/block-elements.fb2 \
     --answer '16/next-poem | 19_Обработка форматирования\05_Снять форматирование блочным элементом.js | …' --answer ok \
     --snapshot $S/18/unwrap-poem-cite-epigraph.chain.xml
tests/scripts/run-all.sh --group 19     # 56 snapshots: the element browser's 14 among them
tests/scripts/run-all.sh --group 18     # the unwrap package's 21 among the group's
```

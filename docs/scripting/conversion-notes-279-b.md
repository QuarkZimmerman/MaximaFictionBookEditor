# FictionBook Editor 2.7.9 scripts — groups 10 to 19 (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## 10_Статистика

8 scripts in 2.7.9: **5 new, all converted** here (T053), of which the obscene words statistics
(10) was later left out by the requester's decision; the 3 successors of the
packages converted from 2.7beta1 (`01_show-links`, `02_show-all-links`, `03_document-statistics`) are
left for their recheck. Packages: `scripts/10_statistics/<NN>_<slug>/` with the 2.7.9 numbers (`07_`,
`10_`, `16_`, `17_`, `18_`), ids `10/<slug>`, `legacy.source` the 2.7.9 path, `name` and
`description` in ru, en and uk, the 2.7.9 icon and, in `index.js`, the original's leading comment
verbatim and, where the original ends with one, its change history (`check-notices.py --package`: OK
for all five). Dialog and message texts in Russian and English; the English interface also gives the
genres and the languages (17, 18) in English - the editor's own English names (`resources/genres`,
`resources/languages.json`, from FictionBook Editor's lists) and, for the codes those lists do not
name, translations of the scripts' Russian names. Four of the five are Александр Ка's; their texts
and the book's description are read from the document model (`doc.get`, `doc.binaries`) instead of
the Description view's fields, and FictionBook Editor's page (`fbw_body`: the book's annotation and
the history first, one empty paragraph each when the book has none, then every body) is rebuilt from
it where the originals walked it. Where the originals' `\s` matters it keeps JScript's meaning (the
ASCII white space; the non-breaking space is named in the expressions themselves).

**Reference books** (`tests/scripts/fixtures/279/10/`, valid FB2 2.1): `statistics.fb2` (three
genres, one of them a schema code the scripts' table does not know, three authors - one with a
nickname only -, a date, a series with a nested one, the source language German and a translator, an
annotation with a note link and an empty line, src-title-info with a genre and the same cover, a
history that does not name the version 2.3, publish-info with a series, a custom-info "illustrator";
a main body with a picture, a two-line title and an epigraph, two chapters - the first with a title,
an epigraph and an annotation and two sections, holding paragraphs for each error search, all kinds
of inline formatting with a note and a comment link and a hyperlink, a poem with title, epigraph, two
stanzas, text author and date, a cite with a text author, adjacent subtitles, an empty line, a table
with an empty cell, inline pictures of a stored and of a missing binary -, the second with an empty
line in its title; a notes body with a title and two notes; four binaries: a JPEG cover, a PNG
picture, an identical copy of it, an unused GIF), `obscene.fb2` (below), `bare.fb2` (a genre code
the table does not know, an author with a nickname only, an empty title, English, no annotation, no
history, one English paragraph).

**Tests.** `tests/scripts/snapshots/10/suite.json` (14 runs). Message boxes are not recorded by the
harness: their full texts were checked, in English and in Russian, with a scratch copy of each
package that records its messages on the clipboard (not committed). Group gate:
`tests/scripts/run-all.sh --group 10` - 17 snapshots (14 new, 3 of the 2.7beta1 packages), all pass.

### 07 Общая статистика

`07_general-statistics`, `10/general-statistics`; v1.4, Александр Ка. The fullest statistics of the
book, as the original's window gave them: lines, words and characters; for each part of the page - the
book's annotation and the history, the main bodies, the notes and comments bodies, unknown root parts
- the sections of each level with their titles, epigraphs and annotations, the poems with their
titles, epigraphs, stanzas and text authors, cites, groups of subtitles, text authors (of cites, of
epigraphs, invalid ones), tables (rows, cells), unknown parts, lines of ordinary text, empty lines (in
titles, subtitles, epigraphs, poems); the attached files (unused ones, copies - same pixel size and
byte size -, sizes in B, kB, MB); covers and block and inline pictures by format (jpg, png, other),
covers used again, repeated and empty pictures, pictures with a title; the inline formatting
(italics, bold, bold italics, superscript, subscript, strikethrough, code, styles, note and comment
links, hyperlinks); likely errors (the version missing from the history, more left or right angle or
inner quotes, straight quotes, s p a c e d words, Latin letters inside Cyrillic words, a lower-case
letter at the start of a line, large numbers without separators, a line starting with an asterisk,
text or numbers in square or curly brackets, a number glued to a word). The lines are shown page by
page with the original's page layout (`Vysota_teksta = 50`, the sections kept whole; Yes shows the
next page, at the last one Yes closes); a section without items is left out. The counts follow the
original's definitions (`HandleP` on every paragraph of the page: its innerHTML in the legacy notation
of `lib/legacy-html.js`, its innerText; the classes of the page's DIVs and P's; the history's
paragraphs count for lines, words and characters only). Then two questions: "◊ Сохранить текст общей
статистики в буфер обмена?" (Yes: `mfbe.clipboard.writeText`) and "◊ Сохранить текст общей
статистики в TXT-файл, в кодировке "UTF-16 LE"?" (Yes: the editor's Save dialog,
`mfbe.files.saveText` in `utf-16`, proposing "Общая статистика (<date> <time>).txt"). The text is all
the lines of the statistics.

Differences:
- the original saved its text only as its setting `SaveStat` said (0, the default: never; 1: the
  clipboard; 2: a TXT file, each after its question); a bundled script cannot be edited, so both
  questions are asked after the results, one after the other;
- the result message shows no proverb: left out by the requester's decision (2026-10-31);
- inline formatting is counted in the editor's terms: an element is a run of text with one mark (bold
  italics: a run that is both), so adjacent elements of one kind count once and the nesting of the
  file does not split them; a note link's formatting is taken as inside the link, which matters only
  for "[N]" and "{N}" written as note links.



Expected (derived from the code before the runs) and recorded, on `statistics.fb2` (94 lines, two
pages of 47): 49 lines, 129 words, 898 characters; annotation 1 /3/, history 1 /1/, 1 empty line;
the main body 1 /40/ - its title 1 /2/ and epigraph 1 /2/, 2 sections of level 1 (titles 2 /4/, an
epigraph, an annotation), 2 of level 2 (titles 2 /2/), a poem 1 /7/ with title, epigraph, 2 stanzas
/3/ and a group of text authors /2/ (the date counts as one, as 2.7.9 rendered it), a cite, 2 groups
of subtitles /3/, text authors in cites and epigraphs, a table 1 /2/ with 4 cells, 12 lines of
ordinary text, 3 empty lines (1 in a title); the notes body 1 /5/ - its title, 2 sections of level 1
with their titles, 2 lines of ordinary text; 4 files, 2 unused, 1 copy, 973 B in all, 243.25 B on
average, the cover 304 B, the illustration 312 B; covers (jpg) 1, covers of the original (jpg) 1,
block pictures (png) 1, inline pictures (png) 1, a cover used again, a repeated illustration, an
empty picture; italics 3, bold 2, bold italics 1, superscript 1 (the comment link's taken away),
subscript, strikethrough, code, style 1 each, note links 3, comment links 1 (hyperlinks 0 after
taking those away); the version v.2.3 missing from the history, 2 straight quotes, 1 spaced word,
1 Latin letter, 2 lower-case starts ("строчная …" and "курсив, …" - the latter was first missed by
the hand derivation and is right for 2.7.9 too), 2 large numbers, 1 asterisk line, one each of [text],
{text}, [number] (the note link's "[1]" taken away), {number}, 3 numbers glued to words. On
`bare.fb2`: 3 lines, 7 words, 44 characters, the two empty paragraphs of the missing annotation and
history counted as empty lines, the version missing, the other sections left out. Snapshots:
- `general-statistics.xml` (Yes, Yes on the pages; No, No): the book unchanged, no outputs;
- `general-statistics.save-cancelled.xml` (Yes, Yes; No; Yes, then `--save-as cancel`): the Save
  dialog offered and cancelled;
- `chain-general-statistics.xml` and `.bare.xml`: a chain driver
  (`tests/scripts/fixtures/279/10/chains/general-statistics/`, a test package) runs the script by its
  2.7.9 path, answered Yes to the clipboard and No to the file, and writes the clipboard back with the
  time and the date replaced by "<время>" / "<дата>": `chain-general-statistics*.outputs.json` holds
  the whole text, equal to the derivation above.
- The file itself, with `--save-as` (not in the suite, since it holds the time): UTF-16 LE with a BOM,
  the same 94 lines.

For the journey of T041: after the pages (Yes on each), answer Yes to the clipboard question - the
clipboard then holds the text - and Yes to the file question: the Save dialog (the stand-in) is
offered with "Общая статистика (…).txt" (English interface: "General statistics (…).txt").

### 10 Статистика нецензурных слов

**Left out by the requester's decision (2026-10-31):** the script has nothing to do with
editing the book. It had been converted (the package, its snapshots and books are removed;
the conversion is in the git history); its inventory entry has the status `dropped`.

### 16 Словарь книги - в буфер обмена

`16_book-dictionary-to-clipboard`, `10/book-dictionary-to-clipboard`; v1.1, Александр Ка. The
dictionary of the main body (the first body: no annotation, no notes): its innerText in capitals, the
words of `[A-Z0-9\-]*[А-ЯЁ][А-Я́ЁA-Z0-9\-]*` (Latin letters, digits and hyphens may be part of a word,
and stress marks), counted; above 130,000 and 200,000 words the original's warnings ask whether to go
on (`Preduprezhdenie_on_off = 1`). The window "«Словарь книги – в буфер обмена» v.1.1" gives the time,
the number of words and of unique words (with their share) and asks whether to send the list; Yes puts
on the clipboard "Число слов в тексте<Tab>Слово" and a line per unique word, the most frequent first,
words of one count alphabetically (the original's two sorts: by binary insertion, then stable by
count) - "<count><Tab><Word>", the first letter as found, the rest in lower case. Without a Russian
letter: "В разделе <body> нет слов.".

Fix: a main body with a stress mark (U+0301) but no Cyrillic letter passed the original's check for
Russian letters (its class included the stress mark), and the original then failed on the missing word
list (a script error); the conversion shows the "no words" message there.

Expected - computed independently from the book's XML (the body's text, the expression, the counts,
the order) - and recorded: `book-dictionary-to-clipboard.xml` (Yes; `statistics.fb2`): 111 words, 69
unique (62.2 %), the clipboard "9 И, 8 Текст, 4 В, 3 Главы …" equal to the computation, with
"Комментарий1" (the comment link's "1" glued to the word, as in the page's innerText) and
"Кирилlица"; `.no.xml` (No): no clipboard; `.bare.xml` (`bare.fb2`): the "no words" message.

### 17 Информацию о книге - в буфер обмена

`17_book-info-to-clipboard`, `10/book-info-to-clipboard`; v1.3, Александр Ка. Gathers the main facts
about the book into a text: the authors (at most 20 names, then "и другие"), the title with the date
written, the series (nested ones indented), the language (unless Russian), the annotation (cut after
about 1,000 characters at the end of a sentence, " <…>"; note links without letters dropped), the
genres (the original's table of 295, `genres.js`), the translation ("Перевод с <language in the
genitive>" and the translators; the original's language tables, `languages.js`), the illustrators
(custom-info "illustrator" or "mlillustrator"), additional information (the pictures, the covers and
an estimate of printed pages: 2,000 characters, 35 lines of verse or 0.3 megapixels of pictures a
page), the print edition (title — city: publisher, year; its series; the ISBN), the contents (the
titles of the bodies and sections, compact: the lines of a section title joined with "•"; poems'
titles too in a book that is mostly verse) and the number of notes and comments (sections of those
bodies). A window shows what was found ("· Авторы . . . 2", "<есть>", "<нет>" …) and asks whether to
send the text; Yes puts it on the clipboard. The settings are the original's (`Dizajn = 0`,
`MaxAuthor = 20`, `Dlina = 1000`, the order of the blocks `mW`).

No difference, fix or open question.

Expected (derived by hand from the code; the character count of the page estimate computed from the
XML) and recorded: `book-info-to-clipboard.xml` (Yes; `statistics.fb2`): the authors "Иван Петрович
Сидоров", "Анна Каренина" (the nickname-only author left out), "Статистика книги" "<1999>", the series
"Цикл  – 3" and, indented, "Подцикл  – 1", the annotation's two paragraphs with the empty line
between them and the note link's "[1]" dropped, the genres "Фэнтези · Классический детектив ·
vampire_book" (English interface: "Fantasy · Classical Detective · vampire_book"), "Перевод с
немецкого:" (English: "Translated from German:") "Пётр Переводчиков", the illustrator "Художник
Иллюстраторов" (spaces and the line break collapsed), "3 иллюстрации,  2 обложки" and "1 условная
бумажная страница", "Статистика. — Москва: Наука, 2001.", " (серия:  Библиотека  – 12)", the ISBN, the
contents - the body title's two lines, "      Глава 1     • Название главы", the two sections and
"Глава 2" -, "2 примечания"; `.bare.xml` (`bare.fb2`): "<не указан>", "<не указано>", "Английский",
"unrecognised", "1 условная бумажная страница".

### 18 Показать жанры

`18_show-genres`, `10/show-genres`; v1.0, Александр Ка. Shows the book's genres in a message: "ЖАНРЫ:",
every genre of title-info and, under a line, of src-title-info, each code decoded with the original's
table of 295 genres (`genres.js`; a code the table does not know is shown as it is),
"<основной жанр не указан>" when title-info has none.

Difference: while its message was open, the original also wrote each genre's name, in green, next to
the code in the Description view (when that view was shown) and removed it afterwards - an addition to
the editor's own page, beyond FR-024; the conversion shows the message only.

Expected and checked (the message): `statistics.fb2` " • Фэнтези", " • Классический детектив",
" • vampire_book", the line, " • Классическая проза" (English interface: Fantasy, Classical Detective,
vampire_book, Classics Prose); `bare.fb2` " • unrecognised". Snapshots `show-genres.xml` and
`.bare.xml`: the books unchanged.

### Harness commands

```bash
F=tests/scripts/fixtures/279/10; S=tests/scripts/snapshots/10; G=scripts/10_statistics
node tests/scripts/run-script.mjs $G/07_general-statistics $F/statistics.fb2 --answer yes --answer yes --answer no --answer no --snapshot $S/general-statistics.xml
node tests/scripts/run-script.mjs $G/07_general-statistics $F/statistics.fb2 --answer yes --answer yes --answer no --answer yes --save-as cancel --snapshot $S/general-statistics.save-cancelled.xml
node tests/scripts/run-script.mjs tests/scripts/fixtures/279/10/chains/general-statistics $F/statistics.fb2 --answer yes --answer yes --answer yes --answer no --snapshot $S/chain-general-statistics.xml
node tests/scripts/run-script.mjs tests/scripts/fixtures/279/10/chains/general-statistics $F/bare.fb2 --answer ok --answer yes --answer no --snapshot $S/chain-general-statistics.bare.xml
node tests/scripts/run-script.mjs $G/10_obscene-words-statistics $F/obscene.fb2 --answer ok --answer ok --answer ok --snapshot $S/obscene-words-statistics.xml
node tests/scripts/run-script.mjs $G/10_obscene-words-statistics $F/obscene.fb2 --answer ok --answer cancel --answer cancel --snapshot $S/obscene-words-statistics.no-notes.xml
node tests/scripts/run-script.mjs $G/10_obscene-words-statistics $F/bare.fb2 --answer ok --snapshot $S/obscene-words-statistics.none.xml
node tests/scripts/run-script.mjs $G/16_book-dictionary-to-clipboard $F/statistics.fb2 --answer yes --snapshot $S/book-dictionary-to-clipboard.xml
#   .no: --answer no; .bare: bare.fb2 --answer ok
node tests/scripts/run-script.mjs $G/17_book-info-to-clipboard $F/statistics.fb2 --answer yes --snapshot $S/book-info-to-clipboard.xml
#   .bare: bare.fb2 --answer yes
node tests/scripts/run-script.mjs $G/18_show-genres $F/statistics.fb2 --answer ok --snapshot $S/show-genres.xml
#   .bare: bare.fb2
```

The 3 packages converted from 2.7beta1 (task T080, recheck of `scripts/10_statistics/`; the
2.7beta1 conversion is in conversion-notes-b.md, group 10). Outcomes: **1 updated** (02), **2
unchanged** (01, 03: 2.7.9's files are byte for byte 2.7beta1's). The names are 2.7beta1's in
2.7.9 too, and so are the three icons. Every package gained `name.uk` and `description.uk`; the
ids and folders stay; 01 and 03 keep their 2.7beta1 `legacy`, code and snapshots. No 2.7.9 script
runs one of them, and none carries the list of proverbs. No fixes, no open questions.

What the three originals read: FictionBook Editor's page (`main.html` and fb2.xsl; 2.7.9 changed
fb2.xsl only to show pictures in table cells and verses as inline pictures). Its `fbw_desc` holds
the description form, whose only pictures are the two preview panels `prevImg` and `fullImg`; its
`fbw_body` holds the title-info annotation, the document-info history (an empty paragraph each when
the book has none) and every body. Every FB2 `<a>` is an `<A class="{@type}">`; every paragraph,
verse, empty line, subtitle, text author, date and table cell a `<P>`; every picture an `<IMG>`. The
originals took `document.getElementsByTagName` of the whole page. The 0.0.1 conversions listed and
counted the bodies; the updated 02 now follows the page, while 01 and 03, unchanged, keep their
conversion, with the differences recorded (as for 06/14 in conversion-notes-279-a.md).

**Reference book** (new, `tests/scripts/fixtures/279/10/links.fb2`, valid against
`FictionBook.xsd`): an annotation with a link to the first chapter and a note link, a history with
an https link; a body title with a link; note links [1], [2] and {1}; a link holding emphasis and
bold; a link holding only an inline picture; targets without "#" (another file, an ftp address, an
upper-case HTTP:// address, an empty one); http and https links and a "#http://" one; a link in a
table cell, one in a verse and one in the notes body. Also used: the existing
`tests/scripts/fixtures/books/conv-b-10.fb2` (seven links in the bodies) and
`fixtures/279/10/bare.fb2` (no links). **Snapshots:** `show-all-links.conv-b-10.xml` stays (the
unchanged book), its report is now recorded beside it in `show-all-links.conv-b-10.outputs.json`;
added in `tests/scripts/snapshots/10/` and its `suite.json`: `show-all-links.links.xml` (with its
`.outputs.json`) and `show-all-links.none.xml`. The snapshots of 01 and 03 stay; their message boxes
are not recorded by the harness.

### 01 Показать все ссылки

`scripts/10_statistics/01_show-links`, id `10/show-links`: **unchanged** (the same file). Gained uk
*Показати всі посилання*. Snapshot `show-links.conv-b-10.xml` stays.

Differences kept from 0.0.1:
- the links of the book's annotation and history are not listed (the page held them before the
  bodies; the conversion walks the bodies; 02, updated, lists them);
- only text counts as a link's content: a link holding nothing but an inline picture is not
  listed, and a picture inside a link splits it in two (the original listed every `<A>` with its
  innerText, to which a picture adds nothing);
- two links with the same target and type written right next to each other count as one: the
  editor reads them as one link (and writes them so);
- the targets are shown as written in the book, the value the script's tests are written for
  ("#" at the start, "(null)" for an empty target). FictionBook Editor's engine could give the
  original `getAttribute("href")` resolved against its page (`file:///…/main.html#id`), and the
  original then flagged every internal link with [!!!]: the editor's own code reads targets with
  `getAttribute(name, 2)`, the flag for the written value, and 2.7.9's 06/17 and 06/50 allow for
  both forms.

### 02 Показать все-все ссылки

`scripts/10_statistics/02_show-all-links`, id `10/show-all-links`: **updated** (the header gives no
version, so `legacy` has no `sourceVersion`). What 2.7.9 changed: the window's page, the same file
as 2.7beta1's `Scripts/links.htm` (by Jurgen), moved to `HTML/Показать все-все ссылки.html`, and
the window's feature `resizable=yes` is spelt right (2.7beta1 wrote `resizeble`), so the window can
be resized. Ported: the list opens in the editor's report window, `mfbe.ui.report({ title, text })`
(the mapping of `window.open("HTML/…")` with the body's innerText), titled with the page's
" :: Links :: " in both languages, where 0.0.1 had a modal form with a text field (script API
version 1 had no report window); like 2.7.9's window it is modeless and stays open after the run,
with Copy and Save as... besides. Also brought to 2.7.9's result, where the 0.0.1 conversion fell
short: the list holds the links of the annotation and the history first, as the page did; a link
holding an inline picture is one link, the picture adding no text; the text is the original's
message character for character (each line ends with " \n", the last one too), and the line
«Всего ссылок: N» of 0.0.1's form, which the original never showed, is gone. Texts: Russian as in
the original, English as in 0.0.1 (*INTERNAL LINKS:*, *EXTERNAL LINKS:*, *The document contains no
links.*). uk *Показати всі-всі посилання*; the descriptions name the report window and the parts
listed; the English undo label follows the name. The index keeps the notices of the script (mkb)
and of its page (Jurgen); `check-notices.py` finds no notice pattern in either, so FR-029 is kept
by hand.

Expected (2.7.9's `Run()` worked through by hand, and by a scratch oracle that reads the book's XML,
takes the `<a>` elements of the annotation, the history and the bodies in order with their text and
writes `msg` as the original does) and recorded, in the English interface:
- `show-all-links.links.xml` (`links.fb2`): the book unchanged; the report " :: Links :: ":

  ```text
  INTERNAL LINKS:

   01. первую главу → #ch1
   02. [1] → #n1
   03. со ссылками → #ch2
   04. [1] → #n1
   05. [2] → #n2
   06. {1} → #n3
   07. курсивом и жирным → #ch2
   08.  → #ch2
   [!!!]  09. другой файл → chapter2.fb2
   [!!!]  10. ftp → ftp://example.org/file.txt
   [!!!]  11. заглавными → HTTP://EXAMPLE.COM/
   [!!!]  12. пусто → (null)
   13. ссылкой → #ch1
   14. [2] → #n2
   15. главу → #ch1

  --------------------------------------------

  EXTERNAL LINKS:

   01. сайта → https://example.org/source
   02. http → http://example.com/
   03. https → https://example.org/
   04. решётка с адресом → #http://example.net/
  ```

  (every line ends with a space; 01, 02 and the external 01 come from the annotation and the
  history, 08 is the link holding only a picture, 11 is internal because the test for "http://" is
  case-sensitive, the "#http://" link is external because the test looks anywhere in the target);
- `show-all-links.conv-b-10.xml` (`conv-b-10.fb2`, the existing run): the internal links 01 [1] →
  #n_1, 02 [2] → #n_2, 03 вторую главу → #s2, [!!!] 04 без решётки → broken-link, [!!!] 05 пусто →
  (null), the external 01 сайт → https://example.org/page, 02 http → http://example.com/;
- `show-all-links.none.xml` (`bare.fb2`): no links: the message *The document contains no links.*
  (*Документ не содержит ссылок.*), no report window, the book unchanged.

Each recorded report equals the expectation. The Russian texts (*ВНУТРЕННИЕ ССЫЛКИ:*, *ВНЕШНИЕ
ССЫЛКИ:*, the message) were checked with a scratch copy of the package forced to the Russian branch
(not committed): the report on `links.fb2` equals the oracle's Russian one.

Differences:
- the editor's report window (the text as written, in the window's type) instead of an IE window
  of 300 × 710 pixels in the page's small grey centred type; it has the size of the editor's report
  windows and scrolls, and cannot be resized, where 2.7.9's window can;
- two links with the same target and type written right next to each other count as one (as
  for 01);
- the targets are shown as written in the book (as for 01).

### 03 Статистика документа

`scripts/10_statistics/03_document-statistics`, id `10/document-statistics`: **unchanged** (the
same file). Gained uk *Статистика документа*. Snapshot `document-statistics.conv-b-10.xml` stays.

Differences kept from 0.0.1:
- paragraphs are the text blocks and empty lines of the bodies; the original counted every `<P>`
  of the page, the paragraphs of the annotation and the history included (one empty paragraph each
  when the book has none);
- the text size is the editor's count of the bodies' characters (`doc.stats`); the original took
  the length of the page's text, the innerText of the Body view: the annotation, the history and
  the bodies, with the line breaks between paragraphs;
- illustrations are the block and inline pictures of the bodies (`doc.stats`); the original
  counted every `<IMG>` of the page: those of the annotation too, and the description page's two
  preview pictures, so it gave two more than the book has;
- footnotes are the note links of the bodies; the original counted every `<A class=note>` of the
  page, those of the annotation and the history included.

### Harness commands

```bash
export MFBE_CORE_BIN=... MFBE_UI_DIST=...
tests/scripts/run-all.sh --group 10
G=scripts/10_statistics/02_show-all-links; F=tests/scripts/fixtures/279/10; S=tests/scripts/snapshots/10
node tests/scripts/run-script.mjs $G tests/scripts/fixtures/books/conv-b-10.fb2 --snapshot $S/show-all-links.conv-b-10.xml
node tests/scripts/run-script.mjs $G $F/links.fb2 --snapshot $S/show-all-links.links.xml
node tests/scripts/run-script.mjs $G $F/bare.fb2 --snapshot $S/show-all-links.none.xml
```

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

15 scripts in 2.7.9: **2 new, both converted** here (T054), none left out; the 13 successors of the
packages converted from 2.7beta1 are left for their recheck (2 more packages, `002_` and `003_`, have
no 2.7.9 counterpart). Packages: `scripts/12_quotes/020_unpaired-brackets-quotes-traditional/` and
`025_unpaired-brackets-quotes-alternative/` (the 2.7.9 numbers as written), ids
`12/unpaired-brackets-quotes-traditional` and `12/unpaired-brackets-quotes-alternative`,
`legacy.source` the 2.7.9 paths, `name` and `description` in ru, en and uk, the 2.7.9 icons and, in
`index.js`, the originals' leading comments verbatim (`check-notices.py --package`: OK for both).

### The common ground

Both scripts are stokber's additions (v1.1 of the pair) to Sclex's "Поиск (без замены) ошибок текста
(версия с исключениями)" 4.8 - the search by a set of regular expressions with "Пропустить"
exceptions - and differ only in the pairs of inner quotes. The engine is `unpaired.js` (a copy in
each package), built on `nav-lib.js` of the converted group 16 (copied unchanged: the book as
FictionBook Editor's page, the book's annotation and the history first, then every body, the caret's
place in it, the select helpers).

The search goes paragraph by paragraph from the end of the selection to the end of the book (no
wrap-around), every text block counted, an empty line as an empty paragraph; in the caret's
paragraph it starts at the caret (a match right at it counts) and the paragraph is passed over when
the caret is at its end, as in the original. Its one expression,
`["„“”{}[\]()«»<>].*["„“”{}[\]()«»<>]|["„“”{}[\]()«»<>]`, finds the text from the first bracket or
quote at or after the caret to the last one of the paragraph. For such a paragraph the original took
the paragraph's whole text, removed a list marker at its start (`^[1-9а-е][)]`, "1)" … "а)") and
everything but the brackets and quotes, then took away adjacent pairs again and again - `""`, `«»`,
`{}`, `[]`, `()`, `<>` and `„“` (020, "традиционные" лапки) or `“”` (025, "альтернативные") - until none
was left (`unpairedOf`). When nothing remains the description was "Пропустить: " and the search goes on
after the match (in effect with the next paragraph); otherwise the match is selected
(`selection.set`) and the status bar says "Найдено: Следующие символы непарные: <the rest>.
Вы выбрали проверку документа с „традиционными“ лапками (н99…в66)." (025: "… с “альтернативными
лапками” (в66…в99)."). At the end "Поиск завершен!" in the status bar and "От позиции курсора до
конца документа ничего не найдено." in a message, the selection unchanged. `Run()` returned nothing:
`run()` returns nothing (`null` in a calling script). The expressions are compiled without the u flag,
as JScript had none (the pairs `\{}` and `\[]` need that).

Differences (both scripts):
- a picture is one character of the paragraph's text, as the editor counts offsets; 2.7.9 replaced a
  picture by "~~~", so its selection of a match after a picture was two characters further on per
  picture (as in group 16's regexp searches);
- the original's machinery for user expressions (`addRegExp`, `tagRegExp`, macros, emulated
  look-behinds and their compile-error message), unused by its one fixed expression, is not carried
  over;
- the editor scrolls the selection into view (the original: to the middle of the window).

Fix (both): a selected picture is refused with "Не обрабатываемый тип выделения: выделена картинка.";
the original's message printed the words "sel.type" instead of the kind of selection - the same fix
as in group 16's regexp searches.

**Reference book** `tests/scripts/fixtures/279/12/unpaired.fb2` (valid FB2 2.1): an annotation with an
unpaired "(", a history with «…», a body title "Заголовок [1]", and paragraphs n5-n14: no brackets;
every kind paired; "1) …" (the marker's bracket alone); "а) … (лишняя …" (the marker and an unpaired
bracket); «… „…“ …» (paired for 020, not for 025); «… “…” …» (paired for 025, not for 020); three
straight quotes; ")…(" in the wrong order; "<…> … >"; a paragraph with an inline picture before
"(…) … (" and formatting; an empty line; a verse, a cite, a table cell, two notes ("(…)" paired,
"„…" unpaired). Node ids: `run-script.mjs --list-nodes`.

**Tests.** `tests/scripts/snapshots/12/suite.json`: `unpaired-brackets-quotes-traditional.xml`
(`--select n30:0:0`) and `unpaired-brackets-quotes-alternative.xml` (`--select n9:0:0`) - the book
unchanged; `chain-unpaired.xml`: a chain driver (`tests/scripts/fixtures/279/12/chains/unpaired/`,
a test package, never bundled) runs both scripts through `mfbe.scripts.run` by their 2.7.9 paths,
again and again from the selection the previous call left, and writes one line per call to the
clipboard (`<NN> from <start> #<call>: <run() value> <anchor>-<head> "<text>"`, recorded in
`chain-unpaired.outputs.json`; 26 calls). Group gate: `tests/scripts/run-all.sh --group 12` - 18
snapshots (3 new, 15 of the 2.7beta1 packages), all pass.

### 020 Поиск абзацев с непарными скобками и кавычками („традиционные“ лапки)

`020_unpaired-brackets-quotes-traditional`, `12/unpaired-brackets-quotes-traditional`; v4.8 of the
engine, v1.1 of the script. Expected (derived from the code before the runs) and recorded, from the
annotation's start (n30:0), 11 calls: n30:10-11 "(" (rest "("), n8:1-25 ") Буквенный перечень и ("
(rest "("), n10:15-41 the «… “…” …» paragraph (rest "«“”»"), n11:7-29 (rest `"`), n12:21-29 ")скобок("
(rest ")("), n13:8-32 (rest ">"), n14:17-39 "(скобкой и курсив) с (" (rest "("; 2.7.9 would have
selected 19-41), n19:5-6 (the verse), n24:7-8 (the table cell), n28:11-12 "„" (the note), then the
message, the selection unchanged; the history, the title, n6, n7 and n9 are passed over. From n8:5
(after the list marker's bracket): n8:24-25. From n30:20 (the end of the annotation's paragraph):
n8:1-25. Every call returns `null`. The status texts (the rests above) were checked on the
paragraphs with `unpairedOf` directly (a script cannot read the status bar).

### 025 Поиск абзацев с непарными скобками и кавычками (“альтернативные” лапки)

`025_unpaired-brackets-quotes-alternative`, `12/unpaired-brackets-quotes-alternative`; v4.8 / v1.1 (the
header's first line reads «Скрипт «Поиск … v.1.1», kept as written). As 020 with `“”` as the inner
pair: from n30:0 the same calls, except that n9 («… „…“ …», rest "«„“»"; n9:10-36) is found and n10 is
passed over; "„" never pairs. From the selection n6:0-n6:20 (the search starts at its end): n8:1-25.
From n28:21 (the end of the book): the message, the caret stays. Every call returns `null`.

### Harness commands

```bash
B=tests/scripts/fixtures/279/12/unpaired.fb2; S=tests/scripts/snapshots/12
node tests/scripts/run-script.mjs scripts/12_quotes/020_unpaired-brackets-quotes-traditional $B --select n30:0:0 --snapshot $S/unpaired-brackets-quotes-traditional.xml
node tests/scripts/run-script.mjs scripts/12_quotes/025_unpaired-brackets-quotes-alternative $B --select n9:0:0 --snapshot $S/unpaired-brackets-quotes-alternative.xml
node tests/scripts/run-script.mjs tests/scripts/fixtures/279/12/chains/unpaired $B --snapshot $S/chain-unpaired.xml
```

Recheck (task T082) of the 15 packages converted from 2.7beta1 (`scripts/12_quotes/001_` to
`015_`; the 2.7beta1 conversion is in conversion-notes-b.md, group 12). 2.7.9 has successors for 13
of them, all **updated**: the quote-placing scripts 001 and 004-007 (Sclex, version 3.9, 007 3.7; a
moderate change) and the "Перейти на ..." scripts 008-015 (Sclex, version 2.9; texts only). 002 and
003 (*Расстановка елочек и лапок (начиная с 1-го / со 2-го уровня)*) have **no 2.7.9 counterpart**
and stay (FR-027). The ids and folders are unchanged.

**Names and icons.** `name.ru` and `undoLabel.ru` are the 2.7.9 file names: *Расстановка ...* became
*Проставить ...* with the range in brackets (*(от начала документа)*, *(от позиции курсора)*, *(от
позиции курсора; как будто перед курсором 1 незакрытая кавычка)*, *... 2 незакрытые кавычки)*, *только
елочки (во всем документе)*), *Переход на пред. / след. ...* became *Перейти на предыдущие /
следующие ...*; the English names follow them. Every package gained `name.uk` and `description.uk`
(«ялинки» for guillemets, «лапки» for quotes, «прямі лапки» for straight ones); 002 and 003 keep their
other texts. The icons of 001 and 008-011 are the same files in both versions; 2.7.9 gives 004 and
007 an icon (2.7beta1 had none), converted with the audit tool's `ico_to_png` as the skeletons were;
005, 006 and 012-015 have none in either version.

**Origin.** The updated packages name their 2.7.9 original in `legacy` with its version (001, 004-006
3.9; 007 3.7; 008-015 2.9) and keep its notice in `index.js` (`check-notices.py --package`: OK for
all 15). 002 and 003 keep their 2.7beta1 `legacy` (`fbeVersion` "2.7"). No original of the group
carries the list of wartime proverbs.

**The page.** The originals worked on the book as FictionBook Editor showed it: the book's annotation
and its history first, then every body (`fbw_body`). The 0.0.1 conversions read and changed the bodies
only, as the script interface then allowed; the rechecked packages walk the same page as the group's
2.7.9 packages 020 and 025 (`lib/nav-lib.js`, copied unchanged), and the quote-placing ones write the
annotation's and the history's paragraphs with one `doc.setDescription` (`lib/page-paragraphs.js`,
copied unchanged from the packages of group 32), the bodies' with `doc.replaceNode`.

### The placing scripts: what 2.7.9 changed and how it was ported

001 and 004-007 share one engine again, `quotes.js` (five identical copies; 002 and 003 keep their
0.0.1 copy). 2.7.9 changed:

- **The decision.** An ellipsis right after the quote ("..." or "…") makes an ambiguous quote an
  opening one, and an ellipsis right before it a closing one, now only when there is none on the
  other side: a quote between two ellipses (`ждал…"…и`) is undecidable, where 2.7beta1 took it for an
  opening quote. Ported; the decision function was compared with the 2.7.9 original's own
  `decideIsItLeftOrRightQuotes` (run from its source) on 200,000 random neighbourhoods: no difference.
- **The checks at a block's end.** The nesting level must now be 0 at the end of the book's annotation
  and of its history too, not only of a section; the message names the block: «В конце аннотации
  документа / истории документа / раздела получился ненулевой уровень вложенности кавычек. То есть не
  все открытые в аннотации документа / истории документа / разделе кавычки были в ней / ней / нем
  закрыты. Выделение установлено в конец этой аннотации документа / этой истории документа / этого
  раздела.» (2.7beta1: «В конце секции ...»). 2.7beta1 carried an open quote out of the annotation into
  the history and the bodies.
- **The error place.** An undecidable quote, or one that would go deeper than level 2 or below 0, is
  now selected (2.7beta1: the caret before it); at the end of a block or of the range the last two
  characters are selected (2.7beta1: the caret at the end). Then 2.7.9 scrolls the selection to the
  middle of the window; the editor scrolls it into view.
- **005 and 006: a start rule.** With the caret at the end of a paragraph that stands directly in the
  book's annotation or history (an empty block's own paragraph included), the placing pass starts with
  the block that follows (open question, below).
- **Texts.** The version line («Скрипт «Проставить елочки и лапки (от начала документа)» (версия 3.9)»,
  «... (от позиции курсора)» ..., «Скрипт «Проставить только елочки» (версия 3.7)»), «Проставлено
  кавычек:» / «Проставлено елочек:», «Ура! Проставить кавычки удалось без ошибок.» / «Ура! Проставить
  елочки удалось без ошибок.», «Не удалось определить, является кавычка открывающей или же
  закрывающей.» (2.7beta1: «Невозможно определить, какой нужен тип кавычки: кавычка получается и левой
  и правой.» or «... ни левой ни правой.»), «В конце блочного элемента получился не тот же уровень
  вложенности кавычек, что в начале. Выделение установлено в конец этого элемента.» (001; 004-006 say
  «элемента»), «... Выделение установлено в конец этой области.», 007's «Елочки проставлены, но... в
  некоторых случаях было непонятно, открывающие или закрывающие елочки нужно проставить, ...» (its
  lines indented with non-breaking spaces, as in the original), and the undo units' names. All ported
  (Russian as written, English translated).
- Layout only: debugging alerts behind `debug=false`, commented code.

With the page, the rest of the engine was brought to the originals as well; the 0.0.1 conversion
differed from them here:

- the annotation and the history are processed (above), first, as in FictionBook Editor;
- the first pass turns every typographic quote of the whole range into a straight one before the
  second pass decides any, so after an error the rest of the range has straight quotes, as in
  FictionBook Editor (one Undo reverts the run); the 0.0.1 conversion worked block by block and left
  the rest as it was;
- `\s` in the original's expressions has JScript's meaning, `[\t\n\v\f\r ]`: a thin space next to a
  quote decides nothing (`"Тонкий пробел{U+2009}" перед кавычкой.` gives a closing quote; with
  ECMAScript's `\s` it was undecidable);
- 004-006 with a text selection process the selection only, as their originals do (the 0.0.1
  conversion went from the selection's start to the end of the book);
- the text of a note link is left alone in both passes (the 0.0.1 conversion turned its typographic
  quotes straight in the first pass and never placed them again);
- after a run without an error the selection is put back as it was.

**Expected results.** The originals themselves were run, before the packages: a scratch oracle builds
FictionBook Editor's page from a reference book as `files/fb2.xsl` of 2.7.9 renders it (`DIV.annotation`,
`DIV.history`, a `DIV.body` per body, a `P` per text block and empty line, inline elements, `SPAN.image`
for an inline picture) in a small DOM with the TextRange calls the scripts make (`pasteHTML` of the
markers, `moveToElementText`, `setEndPoint`, `moveStart`/`moveEnd` by characters, `select`), and runs
each 2.7.9 file's `Run()` unchanged (with JScript's `\s`), answering its questions. On conv-b-12.fb2 it
reproduces the four existing snapshots of 001 and 004-006 exactly, 2.7.9 giving the same text there as
2.7beta1. Every snapshot and every line of the chain drivers below equals the oracle's result
(paragraph texts, the selection the run leaves, the messages; the Russian messages were captured from
the packages in the Russian interface and are identical to the original's strings).

**Reference books** (new, `tests/scripts/fixtures/279/12/`, valid FB2 2.1):
- `quotes-recheck.fb2`: the annotation «Аннотация про "кавычки" и «ёлочки».» (n31), a history of two
  paragraphs, «Правка "первая".» (n33) and «Правка «вторая».» (n34); the body title «Проверка
  "кавычек"» (n3); a first section with «Он сказал: "Привет" и ушёл.» (n7), the one-sided ellipses
  `"Начало"…потом…"конец"` (n8), a thin space before a closing quote (n9), the ellipses on both sides
  `ждал…"…и дождался.` (n10) and typographic quotes (n11); a second section whose quote stays open to
  its end (n15, n16); a third whose quote opened before a cite closes inside it (n20, n22, n23); a fourth
  with a balanced paragraph (n27) and a quote opened in n28 and closed in n29.
- `quotes-annotation.fb2`: an annotation with an unclosed quote (n5), a history with «ёлочки» (n7) and
  a body paragraph with „лапки“ and straight quotes (n3).
- `quotes-levels.fb2` (for 002): a quote opened in n3 whose cite (n5) holds a pair of its own, closed in
  n6.

**Tests** (`tests/scripts/snapshots/12/suite.json`): 7 snapshots of single runs and 2 chain drivers
(test packages, never bundled, `tests/scripts/fixtures/279/12/chains/`): `place-quotes` runs the placing
scripts through `mfbe.scripts.run` by their 2.7.9 paths from 13 carets and selections, each on the
unchanged book, writing per run the selection it left and every paragraph it changed, and puts the
book back after each run (`chain-place-quotes.outputs.json`; the snapshot is the book as it began);
`goto-quotes` runs the "Перейти" scripts from 13 starting points, again and again from the selection
each call left (`chain-goto-quotes.outputs.json`, 43 calls; the first question answered Cancel, every
later one OK). The 15 snapshots of the 0.0.1 conversion on conv-b-12.fb2 pass unchanged: 2.7.9 gives
the same result there (worked out again with the oracle). Group gate: `tests/scripts/run-all.sh
--group 12` - 27 snapshots (9 added), all pass; no package of the group without Ukrainian names.

### 001 Проставить елочки и лапки (от начала документа)

`scripts/12_quotes/001_place-quotes`, id `12/place-quotes` (2.7beta1 *001_Расстановка елочек и
лапок*): **updated** from 2.9 to 3.9. en *Place guillemets and low quotes (from the start of the
document)*, uk *Проставити ялинки й лапки (від початку документа)*. The selection, or the whole page
without one. Snapshot `place-quotes.conv-b-12.xml` stays. Added `place-quotes.recheck.xml`
(quotes-recheck.fb2, caret n7:0, the whole book): the annotation becomes «Аннотация про «кавычки» и
«ёлочки».», the history's first paragraph «Правка «первая».», the title «Проверка «кавычек»», n7
«Он сказал: «Привет» и ушёл.», n8 «Многоточие с одной стороны: «Начало„…потом…“конец».» (the one-sided
ellipses: after the quote an opening one, before it a closing one), n9 «Тонкий пробел » перед
кавычкой.»; at n10's quote between two ellipses the run stops with «Не удалось определить, является
кавычка открывающей или же закрывающей.» (the quote n10:21-22 selected; 18 quotes counted), and n11,
past it, keeps the straight quotes of the first pass, «Уже "типографские" и "лапки".». 2.7beta1 took
n10's quote for an opening one and stopped at the end of the section instead, its n11 «Уже
„типографские“ и „лапки“.». Added `place-quotes.annotation.xml` (quotes-annotation.fb2, the whole
book): the annotation's quote is placed («Аннотация с «незакрытой кавычкой.») and the run stops at the
annotation's end («В конце аннотации документа ...», its last two characters n5:31-33 selected); the
history's and the body's quotes are straight from the first pass. 2.7beta1 carried the open quote on
and stopped at the end of the range, with the history's and the body's quotes nested („...“).
Chain place-quotes: from n7:0 as above; the selection n28 (a quote left open): «В конце области
документа ...», n28:28-30 selected; the selection n20:0-n23:13 (the cite): «В конце блочного элемента
...», the cite's last two characters n22:21-23 selected. Differences: note links; scrolling; an empty
line at a block's end; the undo step's name.

### 002 Расстановка елочек и лапок (начиная с 1-го уровня)

`scripts/12_quotes/002_place-quotes-level1`, id `12/place-quotes-level1`: **no 2.7.9 counterpart**
(2.7.9's 005 and 006 start from the caret), kept as converted (FR-027; inventory entry `fbeVersion`
"2.7"), with its 0.0.1 engine and differences (conversion-notes-b.md). Gained uk *Розставлення ялинок і
лапок (починаючи з 1-го рівня)*. **Fix:** the level at the end of each block entered inside the range
is compared with the level the block started with, as in the original, whose
`blockInitQuotesLevel[currentBlockIndex]=0;` the next line overwrites with `=currentQuotesLevel;`; the
0.0.1 conversion compared it with 0 ("002 keeps its blockInitQuotesLevel = 0 quirk") and stopped with an
error where the original goes on. Snapshot `place-quotes-level1.conv-b-12.xml` stays (no block in its
range); added `place-quotes-level1.block-level.xml` (quotes-levels.fb2, n3:11-n6:19): the cite's own pair
becomes „внутри“ and the closing quote of n6 », as the 2.7beta1 original gives (the oracle); the 0.0.1
version stopped at the cite's end.

### 003 Расстановка елочек и лапок (начиная со 2-го уровня)

`scripts/12_quotes/003_place-quotes-level2`, id `12/place-quotes-level2`: **no 2.7.9 counterpart**,
kept as converted (FR-027; `fbeVersion` "2.7"). Gained uk *Розставлення ялинок і лапок (починаючи з
2-го рівня)*; code unchanged. Snapshot `place-quotes-level2.conv-b-12.xml` stays.

### 004 Проставить елочки и лапки (от позиции курсора)

`scripts/12_quotes/004_place-quotes-from-caret`, id `12/place-quotes-from-caret` (2.7beta1
*004_Расстановка елочек и лапок (с позиции курсора)*): **updated** from 2.9 to 3.9, as 001, from the
caret to the end of the page or over the selection; gained its icon. en *Place guillemets and low
quotes (from the caret)*, uk *Проставити ялинки й лапки (від позиції курсора)*. Snapshot
`place-quotes-from-caret.conv-b-12.xml` stays. Added `place-quotes-from-caret.selection.xml` (the
selection n27): only n27 changes, «Первая реплика» и «вторая».; the 0.0.1 conversion also placed the
quotes of n28 and n29, past the selection. Chain place-quotes: from n15:0 the section ends with the
quote open: «В конце раздела получился ненулевой уровень вложенности кавычек. ...», n16:22-24 selected;
from n20:0 the cite: «В конце элемента ...», n22:21-23; the selection n10: the quote n10:21-22
undecidable, nothing changed; from the end of the annotation (n31:35; 004 has no start rule): the
history is processed and the run stops at n10. **Fix:** a selected picture is refused with the group's
2.7.9 message («Ошибка. Вы используете тип выделения, который не поддерживатся этим скриптом –
выделение картинок, а не текста. ...»); 2.7.9 stopped with a script error (a control range has no
`pasteHTML`). Differences: as 001.

### 005 Проставить елочки и лапки (от позиции курсора; как будто перед курсором 1 незакрытая кавычка)

`scripts/12_quotes/005_place-quotes-from-caret-level1`, id `12/place-quotes-from-caret-level1`
(2.7beta1 *005_Расстановка елочек и лапок (с позиции курсора, начиная с 1-го уровня)*): **updated**
from 2.9 to 3.9, as 004 starting at level 1, with 2.7.9's start rule. en *Place guillemets and low
quotes (from the caret; as if 1 quote before the caret were still open)*, uk *Проставити ялинки й
лапки (від позиції курсора; ніби перед курсором 1 незакрита лапка)*. Snapshot
`place-quotes-from-caret-level1.conv-b-12.xml` stays. Added
`place-quotes-from-caret-level1.history-end.xml` (caret at the end of the history's first paragraph,
n33:16): the start rule skips the history's second paragraph, which keeps the straight quotes of the
first pass («Правка "вторая".»), and the bodies are placed one level deeper («Проверка „кавычек“», «Он
сказал: „Привет“ и ушёл.», «„Начало„…потом…“конец“», «„Тонкий пробел “ ...») up to n10's undecidable
quote. Chain place-quotes: from n31:0 the annotation ends with a quote open («В конце аннотации
документа ...», n31:33-35 selected; the annotation «Аннотация про „кавычки“ и „ёлочки“.»); from n28:1
(inside an open quote) the closing quote of n29 becomes », no error, the caret stays. Fix: the selected
picture, as 004. **Open question:** the start rule (below). Differences: as 001.

### 006 Проставить елочки и лапки (от позиции курсора; как будто перед курсором 2 незакрытые кавычки)

`scripts/12_quotes/006_place-quotes-from-caret-level2`, id `12/place-quotes-from-caret-level2`:
**updated** from 2.9 to 3.9, as 005 starting at level 2. en *Place guillemets and low quotes (from the
caret; as if 2 quotes before the caret were still open)*, uk *Проставити ялинки й лапки (від позиції
курсора; ніби перед курсором 2 незакриті лапки)*. Snapshot `place-quotes-from-caret-level2.conv-b-12.xml`
stays. Added `place-quotes-from-caret-level2.annotation-end.xml` (caret at the end of the annotation,
n31:35): the start rule enters the history at level 2, its quotes become „первая“ and „вторая“, and
the run stops at the history's end («В конце истории документа получился ненулевой уровень вложенности
кавычек. ...», n34:14-16 selected); n11 keeps the straight quotes of the first pass. 2.7beta1 went on
through the history into the bodies and stopped at n8 («кавычка получается больше чем второго уровня
вложения»). **Fixes:** the messages name the script «... как будто перед курсором 2 незакрытые
кавычки)» (версия 3.9); 2.7.9's `versionStr` is 005's («... 1 незакрытая кавычка»); the selected
picture, as 004. **Open question:** the start rule (below). Differences: as 001.

### 007 Проставить только елочки (во всем документе)

`scripts/12_quotes/007_place-guillemets-only`, id `12/place-guillemets-only` (2.7beta1 *015_Расстановка
только елочек*): **updated** from 2.9 to 3.7; gained its icon. en *Place guillemets only (in the whole
document)*, uk *Проставити лише ялинки (в усьому документі)*. The selection or the whole page; no
levels: an opening quote becomes «, a closing one », an undecidable one stays straight and is counted.
2.7.9 changed the decision (the ellipses) and the texts. Snapshot `place-guillemets-only.conv-b-12.xml`
stays. Added `place-guillemets-only.recheck.xml` (quotes-recheck.fb2, the whole book): the annotation,
the history and the bodies get « and » (n8 «Начало«…потом…»конец», n9 «Тонкий пробел »), n10's quote stays
straight, and the message says «Елочки проставлены, но... Осталось прямых кавычек – " – 1» (16 left, 15
right); 2.7beta1 made n10's quote « and reported success. Differences: note links; the undo step's
name.

### 008 Перейти на предыдущие елочки

`scripts/12_quotes/008_previous-guillemets`, id `12/previous-guillemets` (2.7beta1 *008_Переход на
пред. елочки*): **updated** from 2.8 to 2.9.

The eight scripts 008-015 share `goto-quotes.js` (eight identical copies). 2.7.9 changed their texts
only: the version line of every message, «Скрипт «Перейти на кавычки v2.9».» in 008-013 and «Скрипт
«Переход на кавычки v2.9».» in 014 and 015 (2.7beta1 «Переход на кавычки v2.8» in all), and the version
in the undo unit's name; the names (*Переход на пред. / след.* → *Перейти на предыдущие / следующие*)
and the numbers (2.7beta1 had 007 next and 008 previous guillemets, 2.7.9 008 previous and 009 next;
the packages keep their folders). Ported, and the search brought to the originals: the book's
annotation and history are searched, first, as in FictionBook Editor (the 0.0.1 conversion searched the
bodies only and did nothing with the caret in the annotation or history); the question at the book's
end is the original's `confirm()`, OK and Cancel (the 0.0.1 conversion asked Yes / No); a selected
picture gets the original's message («Выделена картинка, а чтобы сработал скрипт, надо, чтобы курсор
был в тексте. Так что перейти на кавычку не выйдет.»; the 0.0.1 conversion did nothing). `run()` returns
nothing, as `Run()` did. The 0.0.1 snapshots on conv-b-12.fb2 (the book unchanged) stay; the selections
are in `chain-goto-quotes.outputs.json`. Difference (all eight): the editor scrolls the found quote
into view (2.7.9: 60 pixels below the window's top).

en *Go to previous guillemets*, uk *Перейти до попередніх ялинок*. Chain goto-quotes from the end of the
book (n29:29): n11:17, n11:4, n34:14, n34:7 (the history), n31:33, n31:26 (the annotation), the question
(OK), n11:17, n11:4; with everything selected (n31:0-n29:29): the question, then «Ничего не найдено,
поиск завершен.», the selection unchanged.

### 009 Перейти на следующие елочки

`scripts/12_quotes/009_next-guillemets`, id `12/next-guillemets` (2.7beta1 *007_Переход на след.
елочки*): **updated**, as 008. en *Go to next guillemets*, uk *Перейти до наступних ялинок*. Chain
goto-quotes from n31:0: n31:26, n31:33 (the annotation), n34:7, n34:14, n11:4, n11:17, the question (OK),
n31:26, n31:33; from n29:29: the question, Cancel, the caret stays; everything selected: the question,
«Ничего не найдено ...».

### 010 Перейти на предыдущие лапки

`scripts/12_quotes/010_previous-low-quotes`, id `12/previous-low-quotes` (2.7beta1 *009_Переход на пред.
лапки*): **updated**, as 008 („, “ and ”). en *Go to previous low quotes*, uk *Перейти до попередніх
лапок*. Chain goto-quotes from n29:29: n11:27, n11:21, the question (OK), n11:27.

### 011 Перейти на следующие лапки

`scripts/12_quotes/011_next-low-quotes`, id `12/next-low-quotes` (2.7beta1 *010_Переход на след.
лапки*): **updated**, as 008. en *Go to next low quotes*, uk *Перейти до наступних лапок*. Chain
goto-quotes from n31:0: n11:21, n11:27, the question (OK), n11:21.

### 012 Перейти на предыдущие прямые кавычки

`scripts/12_quotes/012_previous-straight-quotes`, id `12/previous-straight-quotes` (2.7beta1
*011_Переход на пред. прямые кавычки*): **updated**, as 008. en *Go to previous straight quotes*, uk
*Перейти до попередніх прямих лапок*. Chain goto-quotes from n15:0: n10:21, n9:15, n9:0, n8:49.

### 013 Перейти на следующие прямые кавычки

`scripts/12_quotes/013_next-straight-quotes`, id `12/next-straight-quotes` (2.7beta1 *012_Переход на
след. прямые кавычки*): **updated**, as 008. en *Go to next straight quotes*, uk *Перейти до наступних
прямих лапок*. Chain goto-quotes from n9:0: n9:0 (a quote right at the caret counts), n9:15, n10:21,
n15:6.

### 014 Перейти на предыдущие прямые кавычки, елочки или лапки

`scripts/12_quotes/014_previous-any-quotes`, id `12/previous-any-quotes` (2.7beta1 *013_Переход на
пред. прямые кавычки, елочки или лапки*): **updated**, as 008 (its messages keep 2.7.9's «Переход на
кавычки v2.9»). en *Go to previous straight quotes, guillemets or low quotes*, uk *Перейти до
попередніх прямих лапок, ялинок або лапок*. Chain goto-quotes from n7:0: n3:17, n3:9 (the body's
title), n34:14, n34:7; from the selection n8:30-45: n8:28, before its start.

### 015 Перейти на следующие прямые кавычки, елочки или лапки

`scripts/12_quotes/015_next-any-quotes`, id `12/next-any-quotes` (2.7beta1 *014_Переход на след.
прямые кавычки, елочки или лапки*): **updated**, as 014. en *Go to next straight quotes, guillemets or
low quotes*, uk *Перейти до наступних прямих лапок, ялинок або лапок*. Chain goto-quotes from n33:0:
n33:7, n33:14, n34:7, n34:14; from the selection n8:30-45: n8:49, after its end.

### Differences, fixes and open questions of the placing scripts

**Differences** (each entry of `updates-279/12-recheck.json` lists those of its script): the text of a
note link is left alone (FictionBook Editor turned its quotes straight and decided them with the text
around the link; since 0.0.1, now in both passes); the editor scrolls the selected error place into
view (2.7.9: to the middle of the window, a quote to 60 pixels below the top); where a block ends with
an empty line the two characters selected at an error are the end of its last paragraph with text (how
FictionBook Editor's `moveStart` counted an empty line is not known); the undo step is named after the
script, not after the original's undo unit («проставление елочек и лапок (от начала документа)» ...).
**Fixes:** 006's name in its messages; the picture refused by 004-006; 002's block level.

**Open question (005, 006).** 2.7.9's new start rule: with the caret at the end of a paragraph that
stands directly in the book's annotation or history (an empty annotation's or history's own paragraph
included), the placing pass starts with the block that follows. The first pass, from the caret, has already turned the typographic quotes of the rest of
that annotation or history into straight ones, which then stay straight; and every block after it is
entered with the starting level, so its end check fails whether the quote closes in it or not: a run
started there always ends in an error (on quotes-recheck.fb2 from the end of the history's first
paragraph and from the end of the annotation, above). Kept as 2.7.9; was the rule meant to skip the rest
of the annotation or history, or only its end check?

### Harness commands of the recheck

```bash
G=scripts/12_quotes; B=tests/scripts/fixtures/279/12; S=tests/scripts/snapshots/12
node tests/scripts/run-script.mjs $G/001_place-quotes $B/quotes-recheck.fb2 --select n7:0:0 --snapshot $S/place-quotes.recheck.xml
node tests/scripts/run-script.mjs $G/001_place-quotes $B/quotes-annotation.fb2 --select n3:0:0 --snapshot $S/place-quotes.annotation.xml
node tests/scripts/run-script.mjs $G/002_place-quotes-level1 $B/quotes-levels.fb2 --select-range n3:11-n6:19 --snapshot $S/place-quotes-level1.block-level.xml
node tests/scripts/run-script.mjs $G/004_place-quotes-from-caret $B/quotes-recheck.fb2 --select n27:0:28 --snapshot $S/place-quotes-from-caret.selection.xml
node tests/scripts/run-script.mjs $G/005_place-quotes-from-caret-level1 $B/quotes-recheck.fb2 --select n33:16:16 --snapshot $S/place-quotes-from-caret-level1.history-end.xml
node tests/scripts/run-script.mjs $G/006_place-quotes-from-caret-level2 $B/quotes-recheck.fb2 --select n31:35:35 --snapshot $S/place-quotes-from-caret-level2.annotation-end.xml
node tests/scripts/run-script.mjs $G/007_place-guillemets-only $B/quotes-recheck.fb2 --select n7:0:0 --snapshot $S/place-guillemets-only.recheck.xml
node tests/scripts/run-script.mjs $B/chains/place-quotes $B/quotes-recheck.fb2 --snapshot $S/chain-place-quotes.xml
node tests/scripts/run-script.mjs $B/chains/goto-quotes $B/quotes-recheck.fb2 --answer cancel --snapshot $S/chain-goto-quotes.xml
```

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
**The user name.** By the requester's decision (2026-10-31) the history line has no user name:
`youName` is `''` (2.7.9's default was «Зорро», the placeholder for the user's own name), the
original's own way to a line without one ("Или можно оставить кавычки пустыми (""), тогда строка в
истории будет без имени"), so the entry above now reads "v.1.1 —  Скрипт: «Удаление
форматирования…» 2.4 — <date>", and a recent line is extended only when it ends "— <date>". The
entry is off as shipped (`Version_on_off = 0`), so no snapshot shows it and none changed.

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
window is left out by the requester's decision (2026-10-31) (277 sayings: the 271 of «Пословицы и
поговорки Великой Отечественной войны» plus six about Kursk and Sudzha, among them calls to kill
"fascists"); mode 2 selects instead of underlining; no Body-view check; no `fbeUserName`; the
history entry has no user name (the requester's decision of 2026-10-31). Open questions, kept:
`&nbsp;` counts as letters in the HTML tests; Ukrainian і ї є ґ are no letters.

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

### 590 Расформатировать все заголовки_Комбо

Package `scripts/13_subtitles/590_unformat-all-titles`, id `13/unformat-all-titles`, v1.5 (Sclex,
compiled by TaKir), 2.7.9 icon. The whole-document form of the list (see 31_Автоматизация):
`34/caret-to-document-start`, then while `16/next-title` (148, *Выделить следующий заголовок*) returns
"Found", `18/unwrap-poem-cite-epigraph` (19_Обработка форматирования/05, *Снять форматирование
блочным элементом*). That script dissolves the title the selection starts in together with the
epigraphs and the annotation after it - the title of a body or of a section of sections goes to the
start of its first subsection when that one starts with text, else into a new untitled section before
it -, turns a stanza's title into verses and takes a poem's title for the poem; then the caret is at
the start of the first paragraph that came out, from which 148 goes on.

**Reference book** `tests/scripts/fixtures/279/chains/titles.fb2`: a formatted body title with a body
epigraph, a section of sections, a two-line chapter title with an epigraph and an annotation, a titled
poem of two stanzas, a stanza title, a subtitle, an untitled section, a second chapter, a notes body
with its title and a note's title. **Expected** (from 19/05's rules, per title in document order) **and
recorded** in `chains/13-unformat-all-titles.xml`: the body title and epigraph form a new untitled
section before `part1`; "Часть первая" a new section before chapter one; chapter one's title, epigraph
and annotation become its first four paragraphs; the titled poem becomes paragraphs with an empty line
between its stanzas; the stanza title a verse; "Глава вторая" a paragraph; the notes title a new section
before the note; the note's "1" a paragraph; the subtitle stays; "No title was found…".

**Differences:** one undo step and one Cancel; the run reports the titles done as progress. **Open
question:** as in 2.7.9, every poem with a title is dissolved, each title takes the epigraphs and
annotation after it along, and the notes lose their titles (the numbers of the notes become
paragraphs) - leave poem titles, epigraphs and annotations, and the notes, alone?

## 14_Цитаты

10 scripts in 2.7.9, all new: the four that run no other script are converted here (part of T056)
into the new group `scripts/14_citations/` (*Цитаты*): 052, 053, 054 and 056. The six combos 057-062
("(По очереди) расформатировать все цитаты от жирности и курсива", "(По очереди) сформатировать
целиком жирные (курсивные) абзацы цитатой"), which run scripts of groups 16, 19, 34 and this one, are
converted separately. Packages: `scripts/14_citations/<NN>_<slug>/` with the 2.7.9 number as written
(`052_` ... `056_`), ids `14/<slug>`, `legacy.source` the 2.7.9 path (the one `mfbe.scripts.run`
resolves), `sourceVersion` from the header; `name` and `description` in ru, en and uk, `needsSelection:
false`, the 2.7.9 icon (all four have one), `undoLabel` the name and, in `index.js`, the skeleton's
notice lines verbatim (`check-notices.py --package`: OK for all four). None needs a power beyond
FR-024: the scripts read and edit the book, select, and show messages and the status bar.

**The page.** The originals worked on FictionBook Editor's `fbw_body`: the book's annotation and its
history first (DIVs of class `annotation` and `history`, an empty paragraph each when the book has
none), then the bodies; a text block was a `P` (an empty line an empty `P`). The packages rebuild it
with group 16's `nav-lib.js` (copied unchanged, md5 `e8c399f2…`): `loadBook()` gives the tree and its
paragraphs in document order, the description blocks included, `locate()` the selection in it. So a
search that starts in the book's annotation searches the annotation and the history before the
bodies, as the originals did.

**The engine of the searches** (053, 054, 056; `lib/regexp-search.js`, byte-identical in the three,
md5 `ed6892e4…`). Sclex's "Поиск по набору регэкспов" in the two generations these scripts carry:
- the list - `addMacros`, `addRegExp`, `tagRegExp` - compiled as the originals did: leading
  look-behinds cut off and checked by hand against the text before the match, the rest without the u
  flag, `\s` and `\S` with JScript's meaning (no U+00A0), a `]` right after `[` a member of the class;
  this part follows the port in group 21's `regexp-set.js`, whose search walks the bodies only and has
  no hook for 054's exceptions, hence an engine of this group's own;
- a paragraph's text as the original saw it - tags removed, entities decoded, an inline picture as
  three placeholder characters (`~~~` in 053, `ǾǾǾ` in 054/056), a soft hyphen as U+00AD (053) or as
  `&shy;` (054/056 do not decode it) - and its HTML in IE's notation for `tagRegExp`; a hit is mapped
  back to the document exactly;
- engine `'old'` (053): a collapsed caret skips a hit right at it (`ignoreNullPosition`), no
  exceptions, nothing found: the message only;
- engine `'5'` (054, 056, the `searchNext` generation): a paragraph is searched when the search does
  not start at its end, the earliest hit wins (equal places: the entry listed first), a hit whose
  description starts with "Пропустить" is an exception and the search goes on right after it; nothing
  found: "Поиск завершен!" in the status bar and the message.

The lists stay in `index.js` as the originals wrote them, with their instructions and comments, so
that a copy of the package in one's own scripts folder (with an id of its own) can be edited as the
originals were. Their descriptions are Russian; the status bar shows them in English in the English
interface (a table in `index.js`).

**Reference books** (`tests/scripts/fixtures/279/14/`, valid against `FictionBook.xsd`): `cites.fb2`
(052: plain paragraphs with an id, a style, formatting and a note link, an empty line, a block picture
between paragraphs, a subtitle, a citation, the book's annotation, a notes body), `quotes.fb2` (053,
054, 056: one paragraph per expression and per exception, a stop-word line followed by a paragraph,
by a citation and by a line of dialogue, an inline picture and a soft hyphen, quoted paragraphs in a
title, a subtitle, a stanza and an epigraph, a quoted book annotation), `stop-word-end.fb2` (054: a
stop word on the book's last line). **Snapshots:** `tests/scripts/snapshots/14/`, 20, listed in
`tests/scripts/snapshots/14/suite.json`. The searches change nothing - each of their snapshots equals
the book as the editor writes it - so they are tested through group 19's chain runner
(`tests/scripts/fixtures/279/19/chain-runner`, used as it is): it runs a script by its 2.7.9 path
several times in one run and its report, recorded in `<snapshot>.outputs.json`, gives the selection
after each call. Every expected result below was worked out from the original's code before the
first run. The harness answers every message box with OK; it can select no block picture, so the
picture paths are not tested.

### 052 Сформатировать абзац(ы) цитатой

Package `scripts/14_citations/052_paragraphs-to-cite`, id `14/paragraphs-to-cite`, v1.3 (Sclex).

**What it does.** The original pasted a marker at each end of the selection and took every `P` from
the one holding the start marker to the one holding the end marker (`getNextP`: text blocks and empty
lines at any depth; a marker at offset 0 of a paragraph is in it). `processPs()` made a citation only
when the first `P` stood in a `DIV.section` and every `P` had that section for its parent and no class
(or `normal`): plain paragraphs and empty lines of one section - not title lines, subtitles, verses,
text authors, cells, nor the paragraphs of a citation, an epigraph, an annotation or the description
blocks. It inserted a `DIV.cite` of copies of the `P`s (`cloneNode(true)`: ids, styles and formatting
kept) before the first one and removed the originals; "ОК" in the status bar in any case.

**Conversion.** `locate()` gives the paragraphs from the selection's start to its end in the page's
order; the same test on their parents and kinds; the section's content is written once with
`doc.replaceNode`: the citation of the paragraphs as they are (node ids kept) in the place of the
first, and whatever stood between them that is not a `P` - a block picture - after it, in its order,
as the original's insert-then-remove left it. The caret goes to the end of the citation's last
paragraph. Status texts as the original.

**For the combos (057-062):** acts on the paragraphs of the selection; afterwards a caret at the end of
the new citation's last paragraph (nothing selected changes when nothing is made); `run()` returns
nothing (`null` in the caller); started by a script it works on the selection that script left. A
"next entirely bold/italic paragraph" search from there starts after the citation, as it did from the
place 2.7.9's selection was left.

**Expected (cites.fb2) and recorded.**
- `paragraphs-to-cite.xml` (`--select-range n8:3-n10:5`): n8 (id `q1`, style `center`), the empty line
  n9 and n10 (with a note link) become one citation between n7 and n11;
- `.caret.xml` (`--select n15:5:5`): n15 alone in a citation;
- `.picture.xml` (`n16:0-n18:4`): n16 and n18 in a citation, the picture n17 after it;
- `.end-at-start.xml` (`n7:0-n8:0`): the end at the start of n8 takes n8 - n7 and n8;
- `.notes.xml` (`--select n31:0:0`): the note's paragraph in a citation after the note's title;
- unchanged: `.subtitle.xml` (`n18:0-n20:3`, the subtitle n19 between), `.title.xml` (a title line),
  `.two-sections.xml` (`n11:3-n15:3`, the title of chapter 2 between), `.in-cite.xml` (a paragraph of a
  citation), `.annotation.xml` (the book's annotation);
- `.chain.xml`: the chain runner runs 052 by its 2.7.9 path on the range of the first run: the same
  book, and the report shows `null` and a caret at n10:41, the end of the citation.

**Differences.** The caret at the end of the citation (2.7.9 had replaced the paragraphs the selection
was in and had commented out the code that would have selected them again, so the selection lay where
Internet Explorer put it); a selected picture changes nothing (the original stopped with a script
error: its range of a picture has no `parentElement`); the message for a selection in an input field
is gone.

### 053 Поиск предположительных цитат (по встроенным регэкспам)

Package `scripts/14_citations/053_find-possible-citations`, id `14/find-possible-citations`, v5.0
(Sclex; list TaKir 18.10.2022, reworked by stokber 30.12.2022).

**What it does.** Engine `'old'`; stokber's list, all with `-cite -title -subtitle -stanza -poem
-epigraph`: a paragraph entirely in quotation marks («...», "...", „...", “...”), with punctuation
`[.!?…]+`, a footnote marker (`*`, digits, `[...]`, `{n}`) or both in either order after the closing
mark; `^«[^»]+$` (the start of a citation of several paragraphs, or an unpaired «); `^[^«]+»$` and
`^[^«]+»(punctuation|marker)*$` (its end). TaKir's earlier block is commented out in the original and
stays so. The first hit from the end of the selection is selected, its description shown in the
status bar; nothing found: "От позиции курсора до конца документа ничего не найдено.".

**Expected (quotes.fb2) and recorded.** `find-possible-citations.chain.xml` (13 calls from the caret a
freshly opened book has, at the start of the book's annotation): the annotation's quoted paragraph is
passed (a collapsed caret at its start, and every expression is anchored at `^`), then n8, n9, n10,
n11, n12 (the five forms of a quoted paragraph), n13 (start of a citation of several paragraphs), n15
(its end, «...»."), n16 (inner guillemets: this list has no exception for them), n18 («— ...»), n30,
n31 (with a soft hyphen and a picture: the whole paragraph), n42 - each selected whole; the titles,
the subtitle, the verse, the epigraph and the citation's paragraph are passed; the 13th call finds
nothing (the message), the selection stays on n42. `.caret.xml` (`--select n8:0:0`): n8 is passed, n9
is found; `.range-end.xml` (`n7:0-n8:0`, not collapsed): n8 is found. `find-possible-citations.xml`:
a run from the fresh caret, the book unchanged.

**Differences.** The hit is selected exactly and the search starts exactly at the selection's end (the
original moved IE's selection by its own character count, which was off after inline pictures); the
editor scrolls the hit into view. **Fix:** the picture message printed "sel.type"; it reads "Не
обрабатываемый тип выделения: выделена картинка." (as in group 16).

### 054 Расширенный поиск предположительных цитат

Package `scripts/14_citations/054_find-possible-citations-extended`, id
`14/find-possible-citations-extended`, v1.42 (Sclex; ideas TaKir; expressions and "костыли и протезы"
stokber).

**What it does.** Two searches with engine `'5'`. Run1, stokber's list (`-cite -title -subtitle -stanza
-poem -epigraph`): exceptions "Пропустить" for a paragraph in « » with guillemets inside and for an
italic or bold line holding punctuation followed by a dash (`tagRegExp` with the macro
`<откр-закр-em-str>`); found: a line wholly in italics or bold (`tagRegExp`), a paragraph in « »
throughout with punctuation and a footnote marker `[n]`/`{n}` in the five forms, a stop word with a
colon at the end of a line (two lists - "табличка", "надпись", "гласила", "текст", "письмо"...;
"голос", "слово", "объявление", "газета"... - with a hand-checked look-behind `(?<![а-яё])`), a
paragraph in CAPITAL letters, a letter's closing ("С уважением...", "Искренне ваш..."), and the start
and end of a citation over several paragraphs. Besides, every hit in a paragraph whose text starts with
a dash (after a «: `^«?[-—–]`) or holds punctuation followed by a dash is an exception (a line of
dialogue). A stop word's hit is not shown: the caret goes to its end and Run2 searches on with its
own list - any paragraph in a citation, a stanza, a poem, a title or an epigraph ("DIVs"), else the
next one of two characters or more; a "DIVs" one or one that looks like dialogue sends the caret to
its end and Run1 on. Run1 and Run2 call each other until one finds something or reaches the end; Run1
collapses its selection where its last search started before its "nothing found" message, Run2 does
not. The alternation is `lib/extended-search.js` (byte-identical in 054 and 056), a loop.

**Expected (quotes.fb2) and recorded.** `.chain.xml`, 16 calls from the fresh caret: n44 (the quoted
book annotation: this engine counts a hit at the caret), n8, n9, n10, n11, n12, n13, n15; then n16 is
an exception (inner guillemets), n17 holds no hit, n18 is a line of dialogue, n19 a stop word ("...
гласила:") - Run2 selects n20 whole; n21 (CAPITALS), n22 (letter), n23 (italic line); then n24 is an
exception (bold, ", —"), n25 a stop word, Run2 meets n27 in a citation ("DIVs"), Run1 the stop word n28,
Run2 the dialogue line n29, Run1 n30 - all in the 13th call; n31; the 15th call finds only the
dialogue line n42 (an exception) and nothing else: the caret collapses at n42:21, the end of that
exception, and the message; the 16th the same. `.stop-word-end.xml` (`stop-word-end.fb2`): the stop
word on the last line, Run2 finds nothing - the message, the caret at the stop word's end (n8:26).
`find-possible-citations-extended.xml`: a run from the fresh caret, the book unchanged.

**Differences.** Exact selection and start (inline pictures, and soft hyphens, which this script left
as "&shy;" in its text); scrolling; the loop of Run1 and Run2. **Fix:** the picture message (as 053).

### 056 Поиск предположительных цитат (без жирностей и курсивов)

Package `scripts/14_citations/056_find-possible-citations-no-bold-italics`, id
`14/find-possible-citations-no-bold-italics`, v1.42 - the same file as 054 with the expression "Найдено:
курсивная или жирная строка" commented out ("Тут отключаем поиск болдов и курсивов!!"); the bold line
with ", —" is still an exception.

**Expected and recorded.** `.chain.xml`, 15 calls: as 054 without the italic line n23 (n22 is followed
by n30), then the two "nothing found" calls with the caret at n42:21. `.xml`: the book unchanged.
Differences and fix as 054.

### Harness commands

```bash
B=tests/scripts/fixtures/279/14; G=scripts/14_citations; S=tests/scripts/snapshots/14; CR=tests/scripts/fixtures/279/19/chain-runner
node tests/scripts/run-script.mjs $G/052_paragraphs-to-cite $B/cites.fb2 --select-range n8:3-n10:5 --snapshot $S/paragraphs-to-cite.xml
node tests/scripts/run-script.mjs $CR $B/cites.fb2 --select-range n8:3-n10:5 --answer '14_Цитаты\052_Сформатировать абзац(ы) цитатой.js' --snapshot $S/paragraphs-to-cite.chain.xml
node tests/scripts/run-script.mjs $CR $B/quotes.fb2 --answer '14_Цитаты\053_Поиск предположительных цитат (по встроенным регэкспам).js|...' --snapshot $S/find-possible-citations.chain.xml
tests/scripts/run-all.sh --group 14        # 20 snapshots
```

The six combos 057-062 (Sclex, v1.5): packages `scripts/14_citations/<NN>_<slug>/`, ids `14/<slug>`,
the 2.7.9 icon for 059-062 (057 and 058 have none). Their lists (see 31_Автоматизация, "The runner of
the lists") run `16/next-cite` (152), `16/next-all-bold-paragraph` (138) or
`16/next-all-italic-paragraph` (136), then `19/paragraphs-remove-bold` and
`19/paragraphs-remove-italics` (55, 56) or `14/paragraphs-to-cite` (052), which makes a citation only
of plain paragraphs standing directly in one section and leaves the caret at the end of the citation;
the whole-document forms start with `34/caret-to-document-start`. Reference books
`tests/scripts/fixtures/279/chains/cites.fb2` (bold and italics in a cite inside the body epigraph,
cites with a subtitle, a text author, a poem with a date, a table, a nested cite in a poem's epigraph,
a cite in a note; formatted text outside them) and `whole-paragraphs.fb2` (an entirely bold book
annotation, title and epigraph, entirely bold paragraphs - with an id, with a trailing plain space,
bold italics -, an entirely italic one, a bold paragraph in a cite, a bold verse, a bold subtitle,
mixed and partly bold paragraphs, an italic note). Every expected book was written from the
originals' logic before the first run, every snapshot equals it.

### 057 По очереди расформатировать все цитаты от жирности и курсива

`057_next-cite-remove-bold-italics`, `14/next-cite-remove-bold-italics`. Step form: 152, 55, 56.
**Expected and recorded:** `chains/14-next-cite-remove-bold-italics.xml` (`--select n11:0:0`): the cite
n12 (paragraphs, subtitle, text author) loses bold and italics, its superscript stays; `.none.xml`
(`--select n42:0:0`): "No cite was found…" and the caret's paragraph n42 loses its italics.
**Differences:** one undo step and one Cancel. **Open question:** stop after "NotFound"?

### 058 Расформатировать все цитаты от жирности и курсива

`058_cites-remove-bold-italics`, `14/cites-remove-bold-italics`. Whole-document form: 001, then 152 →
55, 56. **Expected and recorded** (`chains/14-cites-remove-bold-italics.xml`): every text block of the
five cites - the epigraph's, n12, n18 with its verse and cell (the date untouched), n28 with the nested
cite and the verse of its poem, the note's - loses bold and italics; the body epigraph's text author,
outside a cite, stays bold. **Differences:** one undo step and one Cancel; progress.

### 059 По очереди сформатировать целиком жирные абзацы цитатой

`059_next-bold-paragraph-to-cite`, `14/next-bold-paragraph-to-cite`. Step form: 138, 052. **Expected
and recorded:** `chains/14-next-bold-paragraph-to-cite.xml` (`--select n9:0:0`): n10 (with its id
`b1`) becomes a citation; `.none.xml` (`--select n28:0:0`): "No entirely bold paragraph was found…",
and 052 still puts the caret's paragraph - the italic note n28, not bold - into a citation, as 2.7.9
does. **Differences:** one undo step and one Cancel. **Open question:** stop after "NotFound"?

### 060 Сформатировать все целиком жирные абзацы цитатой

`060_bold-paragraphs-to-cites`, `14/bold-paragraphs-to-cites`. Whole-document form: 001, then 138 →
052. **Expected and recorded** (`chains/14-bold-paragraphs-to-cites.xml`): n10, n11 (a trailing plain
space counts), n14 (bold italics) and n23 each become a citation of their own; 138 also finds the body
title n3, the epigraph's n8, the cite's n17, the verse n20 and the subtitle n21, which 052 leaves as
they are, and passes the book annotation's n30, the paragraph the caret starts in. **Differences:** one
undo step and one Cancel; progress.

### 061 По очереди сформатировать целиком курсивные абзацы цитатой

`061_next-italic-paragraph-to-cite`, `14/next-italic-paragraph-to-cite`. Step form: 136, 052.
**Expected and recorded:** `chains/14-next-italic-paragraph-to-cite.xml` (`--select n9:0:0`): n13
becomes a citation. **Differences:** one undo step and one Cancel. **Open question:** as 059 (the same
mechanism, shown by 059's `.none` snapshot).

### 062 Сформатировать все целиком курсивные абзацы цитатой

`062_italic-paragraphs-to-cites`, `14/italic-paragraphs-to-cites`. Whole-document form: 001, then 136 →
052. **Expected and recorded** (`chains/14-italic-paragraphs-to-cites.xml`): n13, n14 and the note's
n28 (after the note's title) become citations; the italic chapter title n6 is found and left.
**Differences:** one undo step and one Cancel; progress.

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
which 2.7.9 itself cannot load (its file is `012_…`); since the recheck the package `012_next-paragraph-with-sup`
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

`001_previous-emphasis`, `16/previous-emphasis` (2.7beta1 *01_Переход на предыдущий курсив*):
updated. en *Go to previous italics*, uk *Перейти до попереднього курсиву*. Chain marks from the
end of the book (n26:36): n23:26, n17:13, n9:19 (the run around the picture, one stop), n8:36, n8:14
(the adjacent elements, one stop), n7:31, n7:23, n7:6, n28:20 (the annotation), the question (OK),
n23:26 - all "Found"; from the selected run n7:15-23: n7:6; from the selected inline picture
n9:12-13: n8:36. Chain conv-c-16: n8:41. Differences: inline picture, size.

### 002 Перейти на следующий курсив

`002_next-emphasis`, `16/next-emphasis`: updated. en *Go to next italics*, uk *Перейти до
наступного курсиву*. Chain marks from the start (n28:0): n28:12 (the annotation), n7:0, n7:15,
n7:26, n8:8 (n8:8-14, the adjacent elements), n8:23, n9:9 (the picture-only italic n9:21 is no
stop), n17:5, n23:18, the question (OK), n28:12; from n7:15-23: n7:26; from n9:12-13: n17:5; from the
end of the last run n23:26: the question, Cancel, "NotFound", the caret stays. Chain conv-c-16:
n12:18. Differences: inline picture, scrolling, size.

### 003 Перейти на предыдущий абзац с курсивом

`003_previous-paragraph-with-emphasis`, `16/previous-paragraph-with-emphasis`: updated. en *Go to
previous paragraph with italics*, uk *Перейти до попереднього абзацу з курсивом*. Chain marks from
n26:36: n23:26, n17:13, n9:19, n8:36, n7:31 (each the end of the paragraph's last run), n28:20,
the question (OK), n23:26. Chain conv-c-16: n8:41. Differences: inline picture, size.

### 004 Перейти на следующий абзац с курсивом

`004_next-paragraph-with-emphasis`, `16/next-paragraph-with-emphasis`: updated; gained its icon. en
*Go to next paragraph with italics*, uk *Перейти до наступного абзацу з курсивом*. Chain marks from
n28:0: n7:0, n8:8, n9:9, n17:5, n23:18 (the caret's own paragraph n28 is passed), the question
(OK), n28:12. Chain conv-c-16: n12:18. Differences: inline picture, scrolling, size.

### 005 Перейти на предыдущую жирность

`005_previous-strong`, `16/previous-strong`: updated. en *Go to previous bold*, uk *Перейти до
попереднього жирного шрифту*. Chain marks from n26:36: n18:11 (the text author), n13:11, n8:29
(bold around italics), n30:16 (the history), the question (OK), n18:11. Chain conv-c-16: the
question, n36:19 (the notes). Differences: inline picture, size.

### 006 Перейти на следующую жирность

`006_next-strong`, `16/next-strong`: updated. en *Go to next bold*, uk *Перейти до наступного
жирного шрифту*. Chain marks from n28:0: n30:10, n8:16, n13:5, n18:5, the question (OK), n30:10.
Chain conv-c-16: n9:8. Differences: inline picture, scrolling, size.

### 007 Перейти на предыдущий абзац с жирностью

`007_previous-paragraph-with-strong`, `16/previous-paragraph-with-strong`: updated. en *Go to
previous paragraph with bold*, uk *Перейти до попереднього абзацу з жирним шрифтом*. Chain marks
from n26:36: n18:11, n13:11, n8:29, n30:16, the question (OK), n18:11. Chain conv-c-16: the
question, n36:19. Differences: inline picture, size.

### 008 Перейти на следующий абзац с жирностью

`008_next-paragraph-with-strong`, `16/next-paragraph-with-strong`: updated; gained its icon. en *Go
to next paragraph with bold*, uk *Перейти до наступного абзацу з жирним шрифтом*. Chain marks from
n28:0: n30:10, n8:16, n13:5, n18:5, the question (OK), n30:10. Chain conv-c-16: n12:11 (the bold of
the caret's own paragraph n9 is passed). Differences: inline picture, scrolling, size.

### 009 Перейти на предыдущий верхний индекс

`009_previous-sup`, `16/previous-sup`: updated; gained its icon. en *Go to previous superscript*, uk
*Перейти до попереднього верхнього індексу*. marks.fb2 has one superscript (n13:18-22). Chain marks
from n26:36: n13:22, then the question (OK), "Ничего не найдено, поиск завершен.", "NotFound"
with the caret left at n13:22; from inside the run (n13:20): the question (OK), n13:22 - the run
holds text after the selection, so the walk from the end finds it before it meets the selection.
Chain conv-c-16: the question, n28:23 (the subtitle). Differences: inline picture, size.

### 010 Перейти на следующий верхний индекс

`010_next-sup`, `16/next-sup`: updated; gained its icon. en *Go to next superscript*, uk *Перейти до
наступного верхнього індексу*. Chain marks from n28:0: n13:18, then the question (OK), "Ничего не
найдено…", "NotFound" (2.7beta1's conversion went back to n13:18, "found"); from n13:20: the
question (OK), n13:18. Chain conv-c-16: n9:24. Differences: inline picture, scrolling, size.

### 011 Перейти на предыдущий абзац с верхним индексом

`011_previous-paragraph-with-sup`, `16/previous-paragraph-with-sup`: updated. en *Go to previous
paragraph with superscript*, uk *Перейти до попереднього абзацу з верхнім індексом*. Chain marks
from n26:36: n13:22, then the question (OK), "Ничего не найдено…", "NotFound"; from the start of
n13 (n13:0): the question (OK), n13:22 - the caret's own paragraph counts after the question.
Chain conv-c-16: the question, n28:23. Differences: inline picture, size.

### 012 Перейти на следующий абзац с верхним индексом

`012_next-paragraph-with-sup`, `16/next-paragraph-with-sup`: updated; gained its icon. en *Go to
next paragraph with superscript*, uk *Перейти до наступного абзацу з верхнім індексом*. Chain marks
from n28:0: n13:18, then the question (OK), "Ничего не найдено…", "NotFound"; from the end of n13
(n13:49): the question (OK), n13:18; by the path `\16_Поиск форматирования\012_…` from n28:0: n13:18.
Chain conv-c-16: n19:6 (the epigraph's text author). Differences: inline picture, scrolling, size.
Open question: 2.7.9's combos 31/50-51 call it as `12_…`, see Numbering.

### 013 Перейти на предыдущий нижний индекс

`013_previous-sub`, `16/previous-sub` (2.7beta1 *13_Переход на предыдующий нижний индекс*, whose
typo the old `legacy.source` kept; the 2.7.9 file has none): updated. en *Go to previous subscript*, uk *Перейти до
попереднього нижнього індексу*. Chain marks from n26:36: n26:21 (the notes), n13:27, n3:8 (the
body's title), the question (OK), n26:21. Chain conv-c-16: the question, n26:25. Differences:
inline picture, size.

### 014 Перейти на следующий нижний индекс

`014_next-sub`, `16/next-sub`: updated. en *Go to next subscript*, uk *Перейти до наступного
нижнього індексу*. Chain marks from n28:0: n3:7, n13:24, n26:13, the question (OK), n3:7. Chain
conv-c-16: n11:8. Differences: inline picture, scrolling, size.

### 015 Перейти на предыдущий абзац с нижним индексом

`015_previous-paragraph-with-sub`, `16/previous-paragraph-with-sub`: updated. en *Go to previous
paragraph with subscript*, uk *Перейти до попереднього абзацу з нижнім індексом*. Chain marks from
n26:36: n13:27, n3:8 (the caret's own paragraph n26 is passed), the question (OK), n26:21 (the
walk from the end meets n26 before the selection in n3), n13:27. Chain conv-c-16: the question,
n26:25. Differences: inline picture, size.

### 016 Перейти на следующий абзац с нижним индексом

`016_next-paragraph-with-sub`, `16/next-paragraph-with-sub`: updated; gained its icon. en *Go to
next paragraph with subscript*, uk *Перейти до наступного абзацу з нижнім індексом*. Chain marks
from n28:0: n3:7, n13:24, n26:13, the question (OK), n3:7. Chain conv-c-16: n11:8. Differences:
inline picture, scrolling, size.

### 017 Перейти на предыдущее зачеркивание

`017_previous-strikethrough`, `16/previous-strikethrough`: updated. en *Go to previous
strikethrough*, uk *Перейти до попереднього закреслення*. Chain marks from n26:36: n26:35, n13:40,
n6:12 (the section's title), the question (OK), n26:35. Chain conv-c-16: the question, n27:16 (the
cite's text author). Differences: inline picture, size.

### 018 Перейти на следующее зачеркивание

`018_next-strikethrough`, `16/next-strikethrough`: updated. en *Go to next strikethrough*, uk
*Перейти до наступного закреслення*. Chain marks from n28:0: n6:6, n13:29, n26:24, the question
(OK), n6:6. Chain conv-c-16: n11:25. Differences: inline picture, scrolling, size.

### 019 Перейти на предыдущий абзац, содержащий зачеркивание

`019_previous-paragraph-with-strikethrough`, `16/previous-paragraph-with-strikethrough`: updated. en
*Go to previous paragraph containing strikethrough*, uk *Перейти до попереднього абзацу, що містить
закреслення*. Chain marks from n26:36: n13:40, n6:12, the question (OK), n26:35, n13:40. Chain
conv-c-16: the question, n27:16. Differences: inline picture, size.

### 020 Перейти на следующий абзац, содержащий зачеркивание

`020_next-paragraph-with-strikethrough`, `16/next-paragraph-with-strikethrough`: updated. en *Go to
next paragraph containing strikethrough*, uk *Перейти до наступного абзацу, що містить
закреслення*. Chain marks from n28:0: n6:6, n13:29, n26:24, the question (OK), n6:6. Chain
conv-c-16: n11:25. Differences: inline picture, scrolling, size.

### 021 Перейти на предыдущий код

`021_previous-code`, `16/previous-code`: updated. en *Go to previous code*, uk *Перейти до
попереднього коду*. Chain marks from n26:36: n21:6 (the table cell), n13:16, n28:28 (the
annotation), the question (OK), n21:6. Chain conv-c-16: the question, n26:14 (the cite).
Differences: inline picture, named style "code", size.

### 022 Перейти на следующий код

`022_next-code`, `16/next-code`: updated. en *Go to next code*, uk *Перейти до наступного коду*.
Chain marks from n28:0: n28:23, n13:13, n21:0, the question (OK), n28:23. Chain conv-c-16: n11:47.
Differences: inline picture, scrolling, named style "code", size.

### 023 Перейти на предыдущий абзац, содержащий код

`023_previous-paragraph-with-code`, `16/previous-paragraph-with-code`: updated. en *Go to previous
paragraph containing code*, uk *Перейти до попереднього абзацу, що містить код*. Chain marks from
n26:36: n21:6, n13:16, n28:28, the question (OK), n21:6; from the start of the book (n28:0): the
question, Cancel, "NotFound", the caret stays. Chain conv-c-16: the question, n26:14. Differences:
inline picture, named style "code", size.

### 024 Перейти на следующий абзац, содержащий код

`024_next-paragraph-with-code`, `16/next-paragraph-with-code`: updated. en *Go to next paragraph
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

13 scripts in 2.7.9: **6 new, all converted** here (T059), none left out; the 7 successors of the
packages converted from 2.7beta1 (`04_…`, `05_…`, `17_remove-spaces`,
`18_remove-spaces-and-hyphens`, `25_…`, `26_…`, `40_insert-midi-link`; at their 2.7.9 places since
the places were renumbered, ids unchanged) are left for their recheck. Packages:
`scripts/18_editing/<NN>_<slug>/` with the 2.7.9 number as written (`01_`, `02_`, `20_`, `22_`,
`35_`, `39_`; the menu orders them among the 2.7beta1 packages by that number), ids `18/<slug>`,
`legacy.source` the 2.7.9 path, `name` and `description` in ru, en and uk, the 2.7.9 icon and, in
`index.js`, the original's leading comment verbatim (`check-notices.py --package`: OK for all six;
01 and 02 have no leading comment). Dialog and message texts in Russian and English.

**Reference books** (`tests/scripts/fixtures/279/18/`, valid FB2 2.1): `editing.fb2` (a book
annotation holding a poem without a title, a history; a main body that starts with a picture and an
epigraph and has no title; paragraphs with underscores in plain and formatted text; a poem without a
title that starts with an epigraph, one with a title, one with a stanza and a text author; two
paragraphs of mojibake, `×` and `ß` among it; a notes body without a title), `editing-titled.fb2`
(a body with a picture and then a title that starts with an empty line, a poem with a title, a
notes body with a title), `yofier.fb2` and `yo-e.fb2` (below). Node ids: `run-script.mjs
--list-nodes`.

**Tests.** One snapshot per package and case (`tests/scripts/snapshots/18/suite.json`, 15 runs);
where the effect is where the caret or the selection ends up, a **chain driver** (test package,
never bundled; `tests/scripts/fixtures/279/18/chains/`) runs the scripts through `mfbe.scripts.run`
by their 2.7.9 paths from given selections and writes one line per call to the clipboard
(`<NN> from <start>: <run() value> <anchor>-<head> "<text>"`), recorded in
`<snapshot>.outputs.json`; the snapshot shows the book after all the calls. New nodes get the ids
the editor gives nodes a script creates (`sc_N`); a paragraph the description just got has a UI id
only (`ui_block`). Group gate: `tests/scripts/run-all.sh --group 18` - 27 snapshots (15 new, 12 of
the 2.7beta1 packages), all pass.

### 01 Вставить заголовок стиха

`01_insert-poem-title`, `18/insert-poem-title`; no version in the header (the code says 1.0). With
the caret in a poem, inserts an empty title (a title holding one empty paragraph) as the poem's
first child and puts the caret into it; when the poem's first child is a title already, the caret
goes to the start of that title's first paragraph (FictionBook Editor's `GoTo`); outside a poem
nothing happens; a selection instead of a caret gives "При запуске скрипта не должно быть выделения.
Должен быть просто курсор." and nothing else. The original climbed from a marker pasted at the
caret to the nearest `DIV.poem`; the conversion finds the caret's text block in the document model -
in a body or, as FictionBook Editor showed them above the bodies, in the book's annotation or the
history - and its nearest poem (`title-lib.js`, shared with 02). In a body the title is inserted
with `doc.insertNode` and the caret set with `selection.set` into the new paragraph; in a poem of
the annotation or the history (node operations cover the bodies only) the description is changed
with `doc.setDescription`, and since the new paragraph has no id of the document model, only a UI
id, the poem is selected once (`selection.selectNode`, which starts at its first paragraph, the new
title's) and the caret set there - group 16's technique for the description blocks. Returns nothing.

Expected (derived from the code before the runs) and recorded on `editing.fb2`:
`insert-poem-title.xml` (`--select n14:5:5`, a verse of the poem that starts with an epigraph): a
`<title><p></p></title>` before its epigraph; `.titled.xml` (`n20:3:3`, the poem with a title): the
book unchanged; `.selection.xml` (`n14:0:5`): the message, the book unchanged; `.annotation.xml`
(`n34:2:2`, the annotation's poem): its title inserted. Chain `chain-editing.xml`: from n20:3 the
caret to n18:0 (the existing title); from n14:5 and n23:2 a new title each with the caret at its
start (sc_2:0, sc_4:0); from n24:4 (the text author of the poem just given a title) to that title
(sc_4:0); from n8:3 (no poem) nothing, the caret stays; from the selection n14:0-n14:5 the message,
the selection stays ("Перва"); from n34:2 a title in the annotation's poem, the caret in it
(ui_block:0). `chain-titled.xml` (`editing-titled.fb2`): from n12:2 to n10:0. Every call returns
`null`.

Difference: the editor scrolls the title into view (the original scrolled it to the middle of the
window). No fix, no open question.

### 02 Вставить заголовок body

`02_insert-body-title`, `18/insert-body-title`; no version in the header (1.0 in the code). As 01
for the body the caret is in (the main body, the notes body): an empty title, or the caret to the
body's title. In the annotation or the history - no body - nothing happens.

**Fix:** the original looked at the body's first child only. A body that starts with a picture (FB2:
`image?, title?, epigraph*, section+`) got its new title before the picture - an invalid book - and
a body with a picture and a title got a second title. The conversion inserts the title after the
picture and finds a title that follows it (then only the caret moves).

Expected and recorded: `insert-body-title.xml` (`editing.fb2`, `--select n8:2:2`): the title after
the body's picture, before its epigraph (2.7.9: before the picture); `.notes.xml` (`n29:2:2`): a
title at the start of the notes body; `.titled.xml` (`editing-titled.fb2`, `n7:3:3`): unchanged
(2.7.9: a second title before the picture). Chain `chain-editing.xml`: from n8:2 a title after the
picture, the caret in it (sc_6:0); from n4:1 (the body's epigraph) the caret to that title; from
n29:2 the notes body's new title (sc_8:0); from n31:2 (the annotation) nothing. `chain-titled.xml`:
from n7:3 the caret to n5:0 - the title's first paragraph after its empty line; from n17:2 to the
notes body's title n15:0. Every call returns `null`.

Difference: scrolling, as 01. No open question.

### 20 Удалить все символы подчеркивания в выделении

`20_remove-underscores`, `18/remove-underscores`; v1.3, Sclex. Removes every underscore (`[_]+`) from
the selected text, keeping its formatting, and leaves the processed text selected; without a
selection "Ничего не выделено!" (`needsSelection: true`). The original is the sibling of
"Удалить все пробелы в выделении" (17) and "… и дефисы" (18) with another expression, so the
conversion is theirs: `strip-lib.js` of the package `17_remove-spaces`, copied unchanged. The
recheck of 17 and 18 gave them a new `strip-lib.js` (with `lib/nav-lib.js` and
`lib/page-paragraphs.js`) that also processes the annotation and the history, as 2.7.9's
`isInsideP` does; this package takes the same copy, since with the old one a selection reaching
into those blocks stopped the run with "node: unknown nodeId" (a fix). Recorded:
`remove-underscores.description.xml` on `underscores-description.fb2` (`--select-range
n6:3-n3:10`): the annotation from its fourth character "Ан_нотация с подчёркиваниями.", the
whole history "История - с <emphasis>жирным</emphasis> текстом.", the first paragraph up to
offset 10 "Первый аб_зац те_кста.".

Expected and recorded: `remove-underscores.xml` (`--select-range n8:4-n9:30`): n8 from its fifth
character "Текстсподчеркиваниями и <emphasis>курсивсподчеркиванием</emphasis> конец." (the
underscores before offset 4 would stay; there are none), n9 up to offset 30 "Второйабзацвыделения,
<strong>жирный_текст</strong>_остаток." - the underscores after the selection stay. Chain: the
selection afterwards n8:4-n9:28 (two characters fewer in n9). No difference, fix or open question.

### 22 Ёфикатор

`22_yofier`, `18/yofier`; no version in the header (`VersionNumber = "0.1"`); "Engine by ©Sclex",
"Jurgen Script «Генеральная уборка» Golma Edition". Puts the letter Ё back into some 70 groups of
common words written with Е (ёлка, ёж, её, моё, придётся, ребёнок, причём, приём, о нём, о чём,
во всём, вперёд, всё-таки, ещё, шёл, ушёл, зелёный, чёрный, тётя …) in every paragraph of the book:
the bodies and, as its settings `ObrabotkaHistory` and `ObrabotkaAnnotation` say, the book's
annotation and the history. Then a message: " «Маленький Ёфикатор» v.0.1", the time, and under
"Статистика" "• Ё:" the number of times an expression changed a paragraph (one per expression and
paragraph). The original's expression block - from "Регулярные выражения" to "Конец шаблонов", its
comments, word lists and warnings included - is copied as written into `rules.js` (73 definitions;
the ones the author disabled stay commented out); the expressions run in the order of the original's
`HandleP` on the legacy inline-HTML notation of `lib/legacy-html.js` (copied unchanged from
`06_cleanup/02_general-cleanup`), as the original ran them on the paragraph's HTML, so the
formatting stays and their quirks with it: a word directly after a changed word (one space between)
is not changed in the same pass ("ещё еще", "её Ее"), since that space was taken by the first match;
a word glued to a hyphen or a Latin letter is left ("еще-то", "xеще"). Bodies are rewritten with
`doc.replaceNode`, the annotation and the history with `doc.setDescription`. The three expressions
with "\s" (о нём, о чём, во всём) keep JScript's meaning of it - a tab, a line break or a plain
space -, so a thin space does not count, as in 2.7.9.

**Fix:** `re19a`, the expression for "нашёл", "нашёлся", was defined but missing from `HandleP` -
unlike the expressions the author disabled, it was not commented out - so these words never got
their Ё; it runs after `re19` ("ушёл", "уйдёт" …), where it is defined.

Reference book `yofier.fb2` (annotation, history, a body title, 9 section paragraphs with the cases
above, formatting, a non-breaking and a thin space, a verse, a cite, a notes body). Expected, computed
before the run from the original's own expression block (evaluated as written, applied in its order
to each paragraph's HTML as 2.7.9 rendered it, with the fix) and recorded in `yofier.xml`: "Ещё в
аннотации: её слова.", "Причём в истории …", "… всё-таки ещё есть её", "Ещё один день: её дом, моё
окно, у неё.", "Ещё еще — …", "Ребёнок пришёл, причём шёл быстро; приём окончен.", "О нём и о нём
(non-breaking space), но о нем (thin space) …", "<emphasis>Ещё</emphasis> … <strong>чёрный</strong>
… иссиня-чёрных …", "Ушёл и нашёл: найденный клад.", "Пчёл много, пчелы летят; далеко и
неподалёку.", "Своё слово, лёд и ледяной ветер, ёлка и ежик.", "еще-то и xеще остаются." unchanged,
"Вперёд, зелёный лес!", "Тётя Мотя и молодёжь.", "Ещё примечание."; the message "• Ё: 29" (28
without the fix).

Open question: the expressions run on the paragraph's HTML, as in 2.7.9, so they also reach the
addresses of links and pictures and the names of styles (a picture with the id "лед" would get the
reference "#лёд"); keep, or let them change the text only?

### 35 Разночтения Ё-Е

`35_yo-e-variants`, `18/yo-e-variants`; v2.2, Александр Ка. Words that read differently with Е and
with Ё: the original's list of 179 pairs with hints (`words.js`, copied as written, the author's
doubtful pairs commented out as there; every pair passes the original's two checks, whose questions
are kept). In the whole text - the book's annotation and the history first, as FictionBook Editor
showed them - the words of the list are found in lower case, with a capital or in capitals; a page
of statistics (found words and groups, the share with Ё, the words with Е, a dotted line, the words
with Ё); the help window ("• УПРАВЛЕНИЕ"); then, group by group in the list's sorted order (the Е
and Ё readings of a pair next to each other), each word is selected in the text and offered for the
other reading - "◊ Найден текст: … (hint) / ◊ Заменить на: … (hint)", the caption
"• все ››› всё — 1 / 2". Then the words written with Ё that are not in the list (one letter and the
list's Ё readings left out) are counted in groups and shown, and the script offers to write them with
Е - all at once, or group by group. Finally, with the original's settings (`Version_on_off = 1`), a
run that changed a word raises the file's version and writes a line into the history
("v.1.1 —  Скрипт: «Разночтения Ё/Е» 2.2 — 31.10.2026"; first a line "v.<old> — ?" when the history
does not name the old version; a line of the last ten days of the same name and date form gets the
script added instead: "Скрипты: «…»; «Разночтения Ё/Е» 2.2 — <today>"), and the results are shown
page by page (`Vysota_teksta = 50` lines a page; the original's page loop). **The user name.**
2.7.9's `youName` was «Зорро», the placeholder for the user's own name (main.js's `fbeUserName`,
which 2.7.9 does not define); by the requester's decision (2026-10-31) it is `''`, the original's
own way to a line without one ("** Или можно оставить эти кавычки пустыми (""), тогда строка в
истории будет без имени"): the name and the ", " after it go, the rest of the line is the
original's, and a recent line is extended only when it ends "— <date>" (`reHist01`-`reHist04`). The
original's sorting, searches and undo stack are ported line by line; the words are found on the
paragraph's HTML (`lib/legacy-html.js`) and changed in place with their formatting (the readings have
equal lengths), the bodies with `doc.replaceNode`, the annotation and the history with
`doc.setDescription`; the history change is `history.js`, the original's `HistoryChange` on the
description.

Differences:
- the question for each word was an input box: an empty field and Yes, No, Cancel; a minus typed
  before Yes undid the last answer, several minuses several answers, any other text stopped the work.
  The script API's input box resolves `''` both for No and for Yes with an empty field, so it cannot
  carry the original's Yes; the question is a message with the buttons Yes, No, Cancel (the rest of
  the group), Step back (one answer per press, as one minus) and Stop (then the original's question
  "◊ Прервать обработку слов с разночтением?"); in the de-yo-fication by groups Yes, No, Cancel (then
  "◊ Прервать выполнение скрипта?") and Step back. The help windows describe these buttons. The undo
  stack is the original's, its quirk included (after Stop - No the word is asked again and a Step back
  then only repeats it);
- the word is selected in the Body view; the original framed and coloured it and its letter and
  scrolled it to a set height of the window (`Raspolozhenie`, not carried over);
- the result message shows no proverb: left out by the requester's decision (2026-10-31);
- the original's check that the Body view ("B" mode) is shown has no counterpart;
- the history line carries no user name, by the requester's decision (2026-10-31; 2.7.9's default
  was the placeholder «Зорро»).



Reference book `yo-e.fb2`: "Все" in the annotation, a history line naming v.1.0, "Небо … мел",
"Всё … все", "НЕБО и Небо", "Ёлка, ещё одна ёлка и Ёжик.", "<emphasis>мел</emphasis> … нёбо", a
verse "Шлем …", a note "Слезы и слёзы.". Expected (derived from the code): 12 words in 8 groups, 25 %
with Ё; the questions in the order все (annotation, p2), всё, мел ×2, небо ×3, нёбо, слезы, слёзы,
шлем; then "Ещё" 1, "Ёжик" 1, "Ёлка" 2 (4 words in 3 groups, 12.9 %); 43 words. Recorded:
- `yo-e-variants.xml`: every question answered No, no de-yo-fication - the book unchanged, no
  history line (the results "Исправлений нет", 16.2 % with Ё);
- `chain-yo-e.xml` (a chain driver that runs the script by its 2.7.9 path and then writes
  "<сегодня>" for today's date in the history, so the snapshot does not depend on the day): Yes, No,
  Yes, Yes, Step back, No, Yes, Cancel, Stop - No, Yes, Yes, No, No, then de-yo-fication by groups
  Yes, Step back, No, Yes, Cancel - No, Yes. The book: "Всё слова в аннотации.", "Все уже сказано, и
  все ушли.", "Елка, ещё одна елка и Ежик.", "<emphasis>мёл</emphasis> в курсиве и небо.", "Слёзы и
  слёзы."; version 1.1 and the line "v.1.1 —  Скрипт: «Разночтения Ё/Е» 2.2 — <сегодня>".
  The results (checked with a copy that records the messages): 5 variant readings changed, 3 words
  written with Е, 11.6 % with Ё, "• Добавлена новая строка в историю";
- `chain-yo-e-recent.xml`: the driver first adds the line "v.1.1 — Скрипт: «Генеральная уборка» —
  <two days ago>" (the same user's line, without a name as the script writes its own) and sets
  version 1.1; one Yes, then Stop - Yes, no de-yo-fication: reHist04 finds "» — <two days ago>",
  "Скрипт:" becomes "Скрипты:", reHist01 adds the semicolon after "»", reHist04 the script's name,
  and the date becomes today's: "v.1.1 — Скрипты: «Генеральная уборка»; «Разночтения Ё/Е» 2.2 —
  <сегодня>"; the version stays.

Both chain snapshots were re-recorded for the requester's decision (2026-10-31): their history line
lost "Зорро, " (the driver of `chain-yo-e-recent.xml` added its line with the name before), nothing
else changed (the outputs, "run() returned null", are the same); `yo-e-variants.xml` stays.

### 39 Исправление крякозябров (кривые кодировки)

`39_fix-mojibake`, `18/fix-mojibake`; v1.11, Sclex, completed by stokber, "создан на базе скрипта
замены регистра за авторством Sclex-а". Repairs Russian text read in the wrong encoding - letters of
Windows-1251 shown as their Windows-1252 namesakes ("Ïðèâåò" for "Привет") - in the selected text,
keeping the formatting; without a selection "Выделите текст!\nСкрипт производит замену символов
только в выделенном тексте!" (`needsSelection: true`). Like its original it is built on the case
scripts: `case-lib.js` of the converted `01_case` packages, copied unchanged; the processed text is
selected again, as there.

**Fix:** "Ч" and "Я" were never restored. The original's table had the key "÷" twice (for "Ч" and
for "ч"; in an object literal the second wins) and "Ÿ" for "Я"; "×" and "ß" - how Windows-1252 shows
these two letters of Windows-1251 - now become "Ч" and "Я", and "Ÿ" is left alone.

Expected and recorded: `fix-mojibake.xml` (`--select-range n25:0-n26:13`): "Привет, мир! Что-то
Яблоко, Ёжик и ёлка. Ÿ остаётся." and "<strong>Жирный</strong> текст и ×àé ñ
<emphasis>ßÃÎÄÀÌÈ</emphasis>." (the part after offset 13 is outside the selection). In 2.7.9 "Что-то"
and "Яблоко" would have stayed "×òî-òî" and "ßáëîêî", and "Ÿ" would have become "Я". Chain: the
selection afterwards n25:0-n26:13.

Difference: scripts see the Body view's selection only; the original also worked on a selection in a
text field of the description. Open question: after the run the processed text is selected again,
as in the conversions of the case scripts it was built on; the original's last call
(`setEndPoint("StartToStart", …)`) probably left a caret at its end instead.

### Harness commands

The runs of `tests/scripts/snapshots/18/suite.json` (book `editing.fb2` unless named):

```bash
node tests/scripts/run-script.mjs scripts/18_editing/01_insert-poem-title tests/scripts/fixtures/279/18/editing.fb2 --select n14:5:5 --snapshot tests/scripts/snapshots/18/insert-poem-title.xml
#   .titled --select n20:3:3; .selection --select n14:0:5 --answer ok; .annotation --select n34:2:2
node tests/scripts/run-script.mjs scripts/18_editing/02_insert-body-title tests/scripts/fixtures/279/18/editing.fb2 --select n8:2:2 --snapshot tests/scripts/snapshots/18/insert-body-title.xml
#   .notes --select n29:2:2; .titled on editing-titled.fb2 --select n7:3:3
node tests/scripts/run-script.mjs scripts/18_editing/20_remove-underscores tests/scripts/fixtures/279/18/editing.fb2 --select-range n8:4-n9:30 --snapshot tests/scripts/snapshots/18/remove-underscores.xml
node tests/scripts/run-script.mjs scripts/18_editing/39_fix-mojibake tests/scripts/fixtures/279/18/editing.fb2 --select-range n25:0-n26:13 --snapshot tests/scripts/snapshots/18/fix-mojibake.xml
node tests/scripts/run-script.mjs tests/scripts/fixtures/279/18/chains/editing tests/scripts/fixtures/279/18/editing.fb2 --answer ok --snapshot tests/scripts/snapshots/18/chain-editing.xml
node tests/scripts/run-script.mjs tests/scripts/fixtures/279/18/chains/titled tests/scripts/fixtures/279/18/editing-titled.fb2 --snapshot tests/scripts/snapshots/18/chain-titled.xml
node tests/scripts/run-script.mjs scripts/18_editing/22_yofier tests/scripts/fixtures/279/18/yofier.fb2 --answer ok --snapshot tests/scripts/snapshots/18/yofier.xml
# 35: --answer ok ok, 12 x no, ok, no, ok (yo-e-variants.xml); the chains with the answers listed above
```

Recheck (task T085, part) of the 7 packages converted from 2.7beta1 that have their 2.7.9 successor
in this group (`scripts/18_editing/`; the 2.7beta1 conversion is in conversion-notes-c.md, group 18).
Outcomes: 3 **updated** (17, 18, 40), 4 **unchanged** (04, 05, 25, 26: the same files). 2.7beta1's
*03_Снятие форматирования стихом, цитатой или эпиграфом* moved to group 19 (rechecked there) and
*09_Нумерацию в началах строк - надстрочным текстом* to group 30 (its package's recheck is in group
30's notes). The ids and folders are unchanged.

**Names and icons.** `name.ru` and `undoLabel.ru` of the updated packages are the 2.7.9 file names:
*Удаление пробелов* → *Удалить все пробелы в выделении*, *Удаление пробелов и дефисов* → *Удалить все
пробелы и дефисы в выделении*, *Вставить ссылку на midi...* → *Сделать выделенный текст ссылкой на
MIDI-файл (для AlReader'а)*; the English names follow them, as the group's new *Remove all underscores in
the selection* (20). The unchanged packages keep their names, which 2.7.9 kept, and their undo labels.
Every package gained `name.uk` and `description.uk`. The icons of 17 and 40 are the same files in both
versions; 2.7.9 gives 04, 05, 18, 25 and 26 an icon (2.7beta1 had none), converted with the audit
tool's `ico_to_png` as the skeletons were.

**Origin.** 17 and 18 name their 2.7.9 original in `legacy` with its version 1.3 and keep its notice in
`index.js`; 40's original has neither a version nor a leading comment. The unchanged packages keep
their 2.7beta1 `legacy` (`fbeVersion` "2.7"). `check-notices.py --package`: OK for all seven. No
original of these carries the list of wartime proverbs.

**Reference book** (new, `tests/scripts/fixtures/279/18/spaces-description.fb2`, valid FB2 2.1): spaces,
hyphens and a non-breaking space in the book's annotation («Ан но та ция с про-бе-ла ми.», a
non-breaking space before «ми», n6), in its
history («Ис то рия - с *жир ным* тек-стом.», n8) and in two body paragraphs (n3, n4). **Snapshots:** 4
added in `tests/scripts/snapshots/18/` and its `suite.json`, none re-recorded: the 7 snapshots of the
seven packages on `tests/scripts/fixtures/books/conv-c-18.fb2` pass unchanged, their results being
2.7.9's. Each expected result was worked out from the 2.7.9 original before the run; the selection a
run leaves was checked with a scratch package that runs the script through `mfbe.scripts.run` and
records it, the messages in the harness log. Group gate: `tests/scripts/run-all.sh --group 18` - 49
snapshots, all pass; no package of the group without Ukrainian names.

### 04 Вставить пустую строку перед стихом или цитатой

`scripts/18_editing/04_empty-line-before-poem-or-cite`, id `18/empty-line-before-poem-or-cite`:
**unchanged** (the same file, version 1.0). Gained uk *Вставити порожній рядок перед віршем або
цитатою* and 2.7.9's icon. Snapshot `empty-line-before-poem-or-cite.xml` stays. Difference kept from
0.0.1: with the caret in the book's annotation or history the script stops with a script error (its
node operations reach the bodies only); FictionBook Editor inserted the empty line before a poem or cite
of the annotation, or did nothing. **Open question:** bring the script to the annotation and history
(written with `doc.setDescription`), as FictionBook Editor did?

### 05 Вставить пустую строку за стихом, эпиграфом или цитатой

`scripts/18_editing/05_empty-line-after-poem-epigraph-or-cite`, id
`18/empty-line-after-poem-epigraph-or-cite`: **unchanged** (version 1.0). Gained uk *Вставити порожній
рядок після вірша, епіграфа або цитати* and 2.7.9's icon. Snapshot
`empty-line-after-poem-epigraph-or-cite.xml` stays. Difference and open question as 04.

### 17 Удалить все пробелы в выделении

`scripts/18_editing/17_remove-spaces`, id `18/remove-spaces` (2.7beta1 *01_Удаление пробелов*):
**updated** from 1.1 to 1.3 (a major change by line count, 33 lines). en *Remove all spaces in the
selection*, uk *Видалити всі пробіли у виділенні*. What 2.7.9 changed:

- **Which text is processed.** 2.7beta1 walked the page from the selection with a flag `InsideP`, set
  when it met a `P` and cleared when its look-ahead climbed out of one - before the text node was
  processed; so the last text node of every paragraph the walk left before reaching the selection's end
  was skipped: in a selection over several paragraphs, all but the last kept the last piece of their
  text (a paragraph of one text node all of it). 2.7.9 asks for each text node whether a `P` of the page
  holds it (`isInsideP`). The 0.0.1 conversion already processed the selected text of every text block,
  which is now 2.7.9's behaviour: nothing to port in the removal itself.
- The expression takes runs of spaces (`[ nbsp]+`; the same result), the undo unit's name
  («удаление всех пробелов в выделении»), the header.

Brought to the original as well: `isInsideP` takes any `P` of `fbw_body`, the book's annotation and
history included; the 0.0.1 conversion stopped with a script error when the selection reached into
them (its node operations reach the bodies only). The engine `strip-lib.js` (identical copies in 17 and
18) now works on the page of `lib/nav-lib.js` and writes the annotation's and the history's paragraphs
with one `doc.setDescription` (`lib/page-paragraphs.js`, both copied unchanged from other packages).
Without a text selection (a caret or a picture): «Ничего не выделено!», as before. Afterwards the
processed text is selected, as in the original.

Snapshot `remove-spaces.xml` stays. Added `remove-spaces.description.xml` (the selection n6:3-n3:10,
from the annotation over the history into the body): «Ан нотацияспро-бе-лами.» (the space before the
selection's start stays; the non-breaking space goes), «История-с*жирным*тек-стом.», «Первыйаб-зац те
кста.»; the selection afterwards n6:3-n3:8. The 0.0.1 version stopped there with «Script error: node:
unknown nodeId "n6"». Difference: the undo step is named after the script.

### 18 Удалить все пробелы и дефисы в выделении

`scripts/18_editing/18_remove-spaces-and-hyphens`, id `18/remove-spaces-and-hyphens` (2.7beta1
*06_Удаление пробелов и дефисов*): **updated** as 17, with the expression `[- nbsp]+`; gained its icon.
en *Remove all spaces and hyphens in the selection*, uk *Видалити всі пробіли й дефіси у виділенні*.
Snapshot `remove-spaces-and-hyphens.xml` stays. Added `remove-spaces-and-hyphens.description.xml` (the
history's paragraph n8 selected): «Историяс*жирным*текстом.», the selection afterwards n8:0-22.
Difference: the undo step is named after the script («удаление всех пробелов и дефисов в выделении»).

### 25 Обрамить верхние индексы скобками []

`scripts/18_editing/25_bracket-superscripts-square`, id `18/bracket-superscripts-square`:
**unchanged** (version 1.0). Gained uk *Обрамити верхні індекси дужками []* and 2.7.9's icon. Snapshot
`bracket-superscripts-square.xml` stays. Difference kept from 0.0.1: the superscripts of the book's
annotation and history are left without brackets (the conversion reads the bodies only); FictionBook
Editor bracketed them too. **Open question:** as 04.

### 26 Обрамить верхние индексы скобками {}

`scripts/18_editing/26_bracket-superscripts-curly`, id `18/bracket-superscripts-curly`: **unchanged**
(version 1.0). Gained uk *Обрамити верхні індекси дужками {}* and 2.7.9's icon. Snapshot
`bracket-superscripts-curly.xml` stays. Difference and open question as 25.

### 40 Сделать выделенный текст ссылкой на MIDI-файл (для AlReader'а)

`scripts/18_editing/40_insert-midi-link`, id `18/insert-midi-link` (2.7beta1 *02_Вставить ссылку на
midi...*): **updated**. en *Make the selected text a link to a MIDI file (for AlReader)*, uk *Зробити
виділений текст посиланням на MIDI-файл (для AlReader)*. What 2.7.9 changed: before its dialog it now
says «Вы ничего не выделили. Перед запуском скрипта нужно выделить текст, который требуется превратить
в ссылку.» when nothing is selected; the dialog is *HTML/Сделать выделенный текст ссылкой на MIDI-файл
(для AlReader'а).html*, the old one under a new name, with the title and the button «Сделать выделенный
текст ссылкой» to match; the undo unit's name («создание ссылки на MIDI-файл (для AlReader'а)»). Ported:
the message (in place of the 0.0.1 conversion's own), the form's title and OK label; and, as in the
dialog, the name box now starts with "file:". The button still turns the selection into a superscript
link `<a l:href="file:NAME"><sup>…</sup></a>` (superscripts inside it merge into it). `needsSelection`
stays: the original refuses to work without a selection; the message shows when the script runs without
one anyway (from the harness, for example).

Snapshot `insert-midi-link.xml` stays (the harness types "song.mid" over the box's "file:"). Added
`insert-midi-link.no-selection.xml` (a caret: the message, the book unchanged) and
`insert-midi-link.file-prefix.xml` (the name typed as "file:song.mid": the link `file:song.mid`, where
2.7.9 wrote `file:file:song.mid`). **Fix** (kept from 0.0.1, whose box started empty): a name typed
after the box's "file:", or with that prefix, gives `file:NAME`, and a name left empty changes nothing;
the original wrote `file:file:NAME` and `file:file:`. Differences: no file picker in the script sandbox,
so the name is typed and the Browse button is gone (since 0.0.1); the undo step is named after the
script.

### Harness commands of the recheck

```bash
G=scripts/18_editing; B=tests/scripts/fixtures/279/18/spaces-description.fb2; S=tests/scripts/snapshots/18
node tests/scripts/run-script.mjs $G/17_remove-spaces $B --select-range n6:3-n3:10 --snapshot $S/remove-spaces.description.xml
node tests/scripts/run-script.mjs $G/18_remove-spaces-and-hyphens $B --select n8:0:31 --snapshot $S/remove-spaces-and-hyphens.description.xml
node tests/scripts/run-script.mjs $G/40_insert-midi-link $B --select n3:0:0 --snapshot $S/insert-midi-link.no-selection.xml
node tests/scripts/run-script.mjs $G/40_insert-midi-link $B --select n3:0:3 --answer '{"file":"file:song.mid"}' --snapshot $S/insert-midi-link.file-prefix.xml
```

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

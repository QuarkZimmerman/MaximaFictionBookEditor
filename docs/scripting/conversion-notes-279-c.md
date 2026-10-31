# FictionBook Editor 2.7.9 scripts — groups 21 to 99, the root script and TreeCmd (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## (top level)

1 script in 2.7.9: 0 new, 0 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 21_Поиск и замена

Tasks T062 (05 to 25) and T063 (28 to 80): the 23 scripts new since 2.7beta1 are converted; none
is left unconverted. The two packages converted earlier from 2.7beta1 (`04_text-error-search`,
`10_regexp-set-search-template`) are brought up to 2.7.9 in their recheck below (T087). Packages:
`scripts/21_search-replace/<NN>_<slug>/`, ids `21/<slug>`, `legacy.fbeVersion` "2.7.9" with the
version the original's header states. Reference books: `tests/scripts/fixtures/279/21/*.fb2` (all
valid per `resources/schema/FictionBook.xsd`). Snapshots: `tests/scripts/snapshots/21/`, 55 runs
in `tests/scripts/snapshots/21/suite.json`; `tests/scripts/run-all.sh --group 21` passes (57 of 57 at the conversion; 62 with the recheck's five
with the two older packages).

A search changes nothing, so its snapshot is the unchanged book (each was compared with its book).
What a search selects was checked run by run with a private copy of the harness that runs the
script repeatedly in one editor session and prints, after each run, the selection, the text it
covers and the status bar; the walks below are those printouts, which were written down from the
originals' code before the runs and agree with them. The scripts that change the book (14, 64,
65, 70) have snapshots of their results, 65's clipboard output is in
`replace-words-from-clipboard.outputs.json`.

Texts: the dialogs and messages are in Russian and English (the Russian ones as the originals have
them); the expressions' descriptions shown in the status bar stay in Russian, as the expressions
are about Russian text (as in the 2.7beta1 conversion of 04).

### The engine of the searches by a set of regexps (`regexp-set.js`)

Sixteen of the scripts (05, 06, 07, 08, 18, 19, 22, 23, 25, 28, 29, 30, 32, 62, 71, 80) are a list of
expressions on Sclex's "Поиск по набору регэкспов" in its 2.7.9 versions (5.1 to 5.3, with
stokber's exceptions), its backward variant (23, 30) and the older 5.4 kept by 32; 75 uses it with
the clipboard text as its only expression. `regexp-set.js` is a port of that engine, identical in
all 17 packages (19 since the recheck of 04 and 10); each package keeps its original's list in `init()` as written (macros, entries,
comments and the original's instructions), only `addMacros`, `addRegExp` and `tagRegExp` are
handed in. The 2.7beta1 engine of 04/10 (`regexp-search.js`, version 2.9) was not reused: 5.x
searches differently (see below) and has the exceptions.

What the engine reproduces:

- **The list.** `addRegExp(re, keys, description, tag condition, look-behind limit)` searches the
  paragraph's text, `tagRegExp(...)` its HTML; `addMacros("<name>", "re")` defines a sub-pattern
  for both the list's tag expressions and the later macros, besides the predefined `<emphasis>`,
  `</emphasis>` ... `<любые-теги>`. Leading look-behinds are cut off and checked by hand against
  the text before the hit, as the original did (including the optional length limit and JScript's
  `lastIndex` moving one character on after an empty match, without which the check of
  `(?<=^|...)` would loop); the rest is a JavaScript RegExp without the `u` flag. An entry that does
  not compile or whose tag condition is malformed goes into the original's error message
  ("Ошибки при компиляции регэкспов...", the entries in the original's format) and nothing is
  searched.
- **JScript's expressions.** Every pattern is compiled as JScript read it: `\s` / `\S` are
  `[ \f\n\r\t\v]` / its complement (JavaScript's `\s` also takes U+00A0 and the other Unicode
  spaces), and a `]` right after `[` or `[^` is a member of the class, as in Perl (JavaScript reads
  `[]` as an empty class). Only flags g, i, m are accepted. A literal U+00A0 and `\xA0` in a
  pattern stand for the editor's U+00A0 (the original replaced them by the configured display
  character, which is U+00A0 by default).
- **The paragraphs as the original saw them.** Every text block of the bodies in document order,
  and every empty line, which FictionBook Editor showed as an empty paragraph. The plain text is
  the original's: an inline picture is three placeholder characters (`~~~`, or `ǾǾǾ` in 19, 22,
  23, 25, 28, 29, 30), a soft hyphen U+00AD - or the five characters `&shy;` in 23, 71 and 80, which
  did not decode it. The HTML is IE's innerHTML of FictionBook Editor's rendering: upper-case tags
  (`<EM>`, `<STRONG>`, `<STRIKE>`, `<SUB>`, `<SUP>`, `<SPAN class=code>`, `<SPAN class=NAME>`,
  `<A class=note href="#n1">`), the marks nested as the book nests them (the editor's model keeps
  the order), an inline picture as `<SPAN class=image contentEditable=false href="#id"><IMG
  src="fbw-internal:#id"></SPAN>`, the entities `&amp;` `&lt;` `&gt;` `&nbsp;` `&shy;`. The plain
  position of a tag hit is computed from the HTML before it with the original's own replacements.
  Tag conditions (`-title -subtitle -stanza -poem -epigraph`...) test the paragraph's containers
  (section, body, epigraph, cite, poem, stanza, title) and its own class (subtitle; text-author,
  which FictionBook Editor also gave a date); 28 and 32 also know annotation (only 32's conditions
  may use it).
- **The search (5.x).** From the end of the selection to the end of the book; the paragraph of the
  caret is searched only when the caret is not at its end (or it is empty). In the first
  paragraph with hits the earliest hit of all entries wins, equal positions going to the earlier
  entry. A tag hit that ends inside a tag, or fails its look-behinds, is tried again one character
  further (the original's retry; the "ends inside a tag" test always ran, as `rslt_replaced[0]`
  was undefined in the IE7 document mode of the editor's page). A hit whose description starts
  with "Пропустить" is an exception: the search goes on right after it (06, 25, 30, 71, 80; 25
  treats every hit in a table cell so). The hit is selected and its description put in the status
  bar; nothing found: "Поиск завершен!" in the status bar and "От позиции курсора до конца
  документа ничего не найдено." (backward: "...до начала документа..."). A collapsed caret does not
  skip a hit at it (5.x commented that out), so a hit that matches an empty string stays where it
  is; no bundled list has such an entry, apart from 32's.
- **The backward variant (23, 30)** searches from the start of the selection to the start of the
  book on the reversed text and HTML of each paragraph, its expressions written backwards
  (`cba` finds "abc"); the "inside a tag" test is mirrored. The predefined and TaKir macros are
  copied unreversed, as in the original (they cannot match reversed tags).
- **The 5.4 engine of 32** skips a hit right at a collapsed caret (so repeated runs walk on) and
  resumes after a failing match or the tag a match ended in; it has no exceptions and sets no
  "Поиск завершен!".
- **Return value.** 71, 75 and 80 return "Found" or "NotFound" to a script that runs them, as their
  originals did; the others return nothing, as theirs.

Differences of the engine (recorded per package): the hit is selected exactly where it matched and
the search starts exactly at the end of the selection (the original moved IE's selection by its
own character count, off after pictures and soft hyphens); the view scrolls the hit into sight
instead of the original's scrolling step; an inline picture selected as text is searched past like
text (the original refused a picture clicked into a "Control" selection with "Не обрабатываемый
тип выделения: sel.type" - the variable's name, kept as written - but selected a hit on a picture
as text, and the editor cannot tell the two apart; a selected block picture is still refused).
The book's annotation and the document's history, which the original's body view showed above the
first body, are edited in the Description view and cannot be selected: a forward search never
reached them anyway (the caret is in a body), the backward ones stop at the first body. An empty
line cannot hold the caret: a hit on one selects from the end of the text block before it to the
start of the one after it (only 32 can hit one). Guards against two defects of 5.x are in every
copy and recorded as fixes in the template 30, the list meant for editing: an entry without a
description stopped the search with an error when hit, an exception matching an empty string hung
it.

Checked over the 1,000-odd entries of the lists (extracted by running the originals' `init()`):
no entry has a look-behind after its start (none would have failed in JScript), none fails to
compile in JavaScript, `\s` occurs only in `([\s]нибудь)` (05, 06, 28), a class starting with `]`
only in `^[]».,:;!?-]` (05, 06, 19, 29 - see the open question), no string literal holds `\v`
(JScript read it as "v"), length limits stand only on one-character look-behinds (07) or on an
entry without one (08), and no entry matches an empty string except 32's `(^$)`. A walk through
5,000 clean paragraphs takes under a second with 05's list.

### 05 Поиск (без замены) ошибок текста (TaKir-Sclex)

`05_text-errors-takir-sclex`, id `21/text-errors-takir-sclex`, version 5.1. Searches for typical
errors of Russian text with TaKir and Sclex's list (360 entries, 7 macros): misprinted words, mixed
alphabets, letters among digits, punctuation slips, dashes, lines without a full stop, formatting
inside words, strange characters. Engine options: forward, `~~~`, `&shy;` decoded.
Book `text-errors.fb2`; snapshots `text-errors-takir-sclex.xml` (`--select n5:0:0`) and
`.not-found.xml` (`--select n26:0:0 --answer ok`).
Walk from the start of n5, as derived: `&` of `&amp;` (мусор после скана, a tag entry), `☺`
(Странные нетекстовые символы), ` '` (мусор после скана - the space-and-apostrophe entry, earlier
than the apostrophe-and-letter one), `*` (звездочки), `3-4`, ` -` (неправильные дефисы-тире), `»`
at a line start (знаки препинания в начале строки), `о—`, `л..` (двоеточие вместо многоточия),
`сЛ`, `лa` (Latin a: смесь кириллицы и латиницы), ` З ` (буква З вместо цифры 3), `слова` with
`лов` in italics (курсивность части слова - entry 111, which precedes 112 at the same position),
`пего`, `и` at the end of an unpunctuated line (концы строк без точек), the dash ending a verse
(подозрительные концы строк в стихах), then "nothing found". Not reported, as in the original: the
unpunctuated subtitle and the `* * *` subtitle (tag conditions), the paragraph ending with an
inline picture (the line-end expressions cannot skip the picture's SPAN with attributes).
Open question: the entry `^[\]».,:;!\?-]` loses its backslash in the string literal and reaches
the RegExp as `^[]».,:;!?-]`; it is compiled as JScript read it (`]` a member of the class). Had
2.7.9 read it as an empty class, it never fired there and such lines got the later "знаки
препинания в начале абзаца" (same selection).

### 06 Поиск (без замены) ошибок текста (версия с исключениями) (TaKir-Sclex-stokber)

`06_text-errors-with-exceptions`, id `21/text-errors-with-exceptions`, version 5.2. The list of 05
(four tag entries commented out) with stokber's exceptions in front: URLs, e-mail addresses,
ISBNs, references ("см.:", "т. 1."), cities of publication, abbreviations, "что" after
prepositions, "fb2", hybrid names, English ordinals.
Book `text-errors-exceptions.fb2`; snapshots `text-errors-with-exceptions.xml` (`--select
n5:0:0`) and `.not-found.xml` (`--select n11:8:8 --answer ok`). Walk from n5: the URL, the e-mail
address, `fb2` and ", так что" are exceptions and passed over, ` -` after a URL in the same
paragraph (the search goes on right after the exception), `сЛ`, then "nothing found". On the same
book 05 stops at `/`, `/`, `le.c`, `/`, `h?x` inside the first URL alone, then at `@` - the false
alarms the exceptions are for. Open question: as 05.

### 07 Поиск (без замены) по набору регэкспов_Slovo

`07_regexp-set-slovo`, id `21/regexp-set-slovo`, version 5.1. Misprinted short words and letter
pairs (122 tag entries, 5 plain ones), mostly on the HTML, so that a word split by formatting is two
words. Book `slovo.fb2`; snapshots `regexp-set-slovo.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n15:0:0 --answer ok`). Walk from n5: `пего`, `пего` in italics, then in `пе<EM>го</EM>`
the HTML holds two words - `пе`, then `го`; `иа`; `чтб` (the three-consonant entry, first in the
list, wins over the word entry); `фуппа` (the word entry precedes `(фупп)` at the same place);
`фупп`; `т а ` (-а- after a word without a comma); `пего` inside a note link; `яии` of
"земляиика" (`яиц` is excluded by the entry's class); "nothing found".

### 08 Поиск (без замены) по набору регэкспов_Znak

`08_regexp-set-znak`, id `21/regexp-set-znak`, version 5.1. JonVic's list of 47 entries: line ends,
scan garbage, hyphens and dashes, alphabets, case, "З" for 3, punctuation spacing, formatting inside
words. Book `znak.fb2`; snapshots `regexp-set-znak.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n27:0:0 --answer ok`). Walk from n5: `е` (line end), `~`, the inline picture (its
placeholder `~~~` matches the garbage class), ` -`, `3-4`, `лa`, `сЛ`, `е—`, ` З `, `а,б`, `л — П`,
`о-научно-п` (a word with two hyphens, a tag entry), `»—`, `и..`, `сло` (italics inside a word),
"nothing found"; the subtitles (`-subtitle`) and the lower-case verse (`-stanza -poem`) are not
reported. Open question: pictures are reported as "мусор после скана" (and, ending a paragraph, as
a line without a full stop), as in 2.7.9 - should they be passed over? While converting this one,
the hit on the picture showed that the next run must not refuse a picture selected as text (see
the engine's differences).

### 14 Скрипт-конструктор

`14_script-builder`, id `21/script-builder`, version 1.4, by Александр Ка. A template for
search-and-replace operations on the paragraphs' HTML: each operation counts the matches of an
expression and may replace them, optionally only in some kinds of paragraphs; afterwards the
statistics window (in pages, Yes/No between them). The settings (name, version, history and
annotation on, window height, demonstration mode on), the example operations and the original's
instructions are kept as written in `index.js`; the operations run on the paragraph's HTML in the
original's notation (`lib/legacy-html.js`, copied unchanged) and a paragraph whose HTML changed is
parsed back, so formatting the operations leave alone is kept. Paragraph order and flags as in the
original: the book's annotation, the document's history (from the description, written back with
`doc.setDescription`), then the bodies; `title`, `history`, `stanza`, `poem`, `epigraph`,
`annotation`, `cite`, `table` from the containers up to the nearest section, `subtitle`,
`text_author` (also a date) from the paragraph, `text` for a paragraph directly in a section; an
empty line is an empty paragraph. In the operations `new RegExp` is a JScript-compatible wrapper
(`\s`, leading `]`), `nbspEntity` is "&nbsp;" (FictionBook Editor's default setting).
Book `script-builder.fb2`; snapshot `script-builder.xml`. Expected and found: the subtitle count 1,
"Неразмеченных глав" 1 (`Глава 2.`), "Букв R" 4 (subtitle, two in the verse, the note; the `r` of
`href` inside a tag is not counted), "Ряд пробелов" 2 and "?! + точки/запятая" 2; 11 lines checked,
2 corrected: `Абзац с двумя рядами пробелов?!.` and `...ссылка<a ...>1</a>!?.`; the verse keeps its
double space (`! stanza`). Difference: the HTML is the editor's rendering in the original's
notation - a link's address as the book has it (`#n1`), not resolved against the page, an inline
picture as `<IMG href=… alt=…>` - which an operation matching such details may see otherwise (the
examples do not).

### 15 Скрипт-конструктор (поиск)

`15_search-script-builder`, id `21/search-script-builder`, version 1.2, by Александр Ка. The search
template: operations count matches in the paragraphs' text without tags (innerText: a picture gives
nothing), the result is the original's statistics window in up to three columns. As shipped it has
no operations. Same paragraph order, flags, JScript `RegExp` and `nbspEntity` as 14; helper
`search-builder.js` (identical in 15 and 16). Book `script-builder.fb2`; snapshot
`search-script-builder.xml`; the window shows 11 lines (annotation, history and 9 body paragraphs,
the empty line counted), the counting section dropped as the original drops it when empty.
Difference: the window shows no proverb - the original added a random saying from a list of
wartime proverbs; it is left out pending the requester's decision and the list is not copied
(`Poslovitsa_on_off` is kept with a note, without effect). Open question: restore the proverb of
the result message?

### 16 Скрипт-конструктор (поиск) - пример

`16_search-script-builder-example`, id `21/search-script-builder-example`, version 1.2. The example
of 15: counts Russian letters, each Russian letter, Latin letters, each Latin letter, spaces
(ordinary, "non-breaking", other), over the annotation and the bodies (history off in its
settings). Snapshot `search-script-builder-example.xml` on `script-builder.fb2`; the window shows 10
lines and only the non-zero counts (demonstration mode off): Russian letters 159, А 22, Б 3, В 11,
Г 6, Д 3, Е 10, Ё 2, З 4, И 9, К 8, Л 7, М 5, Н 10, О 11, П 5, Р 11, С 8, Т 7, У 3, Х 1, Ц 2, Ч 2,
Ы 4, Я 5, Latin letters 7, R 4, X 1, Y 1, Z 1, spaces 27, ordinary spaces 27 - every figure equal to
an independent count over the same texts. Difference and open question as 15 (proverb). Open
question: "Неразрывный пробел" (and the `&nbsp;` alternative of "Пробелы") look for the text
"&nbsp;", which the text never holds with the default setting, so they count none, as in 2.7.9 -
count U+00A0 instead?

### 18 Поиск странных символов (TaKir-Sclex)

`18_strange-characters`, id `21/strange-characters`, version 5.3. Five entries: letters with a
combining stress mark, characters outside the allowed ranges (Cyrillic, ASCII, Latin-1, Latin
Extended A/B, Greek, mathematical operators, number forms and „“–…—­№✓♦•-), a stress typed as "2"
or an apostrophe. Book `strange-characters.fb2`; snapshots `strange-characters.xml` (`--select
n5:0:0`) and `.not-found.xml` (`--select n17:0:0 --answer ok`). Walk from n5: `☺`, `е́`, `о2л`,
`о'`, `”` (U+201D is outside the ranges, unlike “), `€` (the picture's `~~~` is ASCII and allowed),
`★` in a text-author, "nothing found"; the non-breaking space and the soft hyphen are allowed.

### 19 Поиск разрывов абзацев (РУС)

`19_paragraph-breaks-russian`, id `21/paragraph-breaks-russian`, version 1.4. Ten entries for
paragraphs broken by a scan: line ends without punctuation (tag entries, outside titles,
subtitles, poems, epigraphs), dashes ending verses, a lower-case letter after a full stop (not after
abbreviations), lines starting with punctuation, a lower-case letter or a digit, a dash glued to a
word. Engine: `ǾǾǾ`. Book `paragraph-breaks.fb2`; snapshots `paragraph-breaks-russian.xml`
(`--select n5:0:0`) and `.not-found.xml` (`--select n23:0:0 --answer ok`). Walk from n5: `и`, `п`,
`”` (English closing quote is no Russian line end), `. н`, `—`, the verse's `—`, `,` at a line start
(знаки препинания в начале строки), `… и`, `3г`, `о—`, `е` before `</EM>` ending a line, "nothing
found"; "т. д. и" is not reported (abbreviation), nor the lines ending with a note link or a picture
(the line-end expressions cannot skip `</A>` or the picture's SPAN), nor the subtitle. Open
question: as 05.

### 22 Поиск (без замены) мусорных символов

`22_garbage-characters`, id `21/garbage-characters`, version 1.5. Two entries: stressed letters and
any character outside Russian and Latin letters, digits, spaces and the usual punctuation (`Ǿ`,
the picture placeholder, allowed). Book `garbage-characters.fb2`; snapshots
`garbage-characters.xml` (`--select n5:0:0`) and `.not-found.xml` (`--select n21:15:15 --answer
ok`). Walk from n5: `#`, `е́` (the stressed-letter entry, starting before the combining mark the
garbage class would take), `@` (the picture is passed over), the soft hyphen, `"`, `"`, `'`, `~` in a
verse, `%` in the notes body, "nothing found".

### 23 Обратный поиск (без замены) мусорных символов

`23_garbage-characters-backward`, id `21/garbage-characters-backward`, version 1.5. The garbage class
of 22, searched backwards; this version did not decode `&shy;`. Same book; snapshots
`garbage-characters-backward.xml` (`--select n21:15:15`) and `.not-found.xml` (`--select n5:0:0
--answer ok`). Walk from the end of the note: `%`, `~`, `'`, `"`, `"`, the soft hyphen (found as the
`&` of `&shy;`, the soft hyphen itself selected), `@`, the combining stress mark alone (no
stressed-letter entry here), `#`, "nothing found ... до начала документа". Difference besides the
engine's: the search stops at the first body (annotation and history not searched).

### 25 Поиск (без замены) неразмеченных дат

`25_unmarked-dates`, id `21/unmarked-dates`, version 1.01, by stokber. Three entries for short
lines holding a year (1700-2029, not followed by a digit, "год...", "-й"...), a year with "г." or a
day and a month, outside text authors (and dates), titles and subtitles; a hit in a table cell (and
in the history) is turned into an exception. Engine: `ǾǾǾ`, cells skipped. Book
`unmarked-dates.fb2`; snapshots `unmarked-dates.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n10:7:7 --answer ok`). Walk from n5: `1941`, `Москва, 1999`, `Санкт-Петербург, 2005 г.`,
`12 апреля`, `1–3 мая`, "nothing found"; not reported: the long paragraph ("1941 года"), the title,
the text-author, the subtitle, `Год 1812-й`, `© 2001`, the poem's date, and the table cell `1999`,
which matches and is passed over (without the cell rule it is the next hit).

### 28 Поиск пропавших дефисов

`28_missing-hyphens`, id `21/missing-hyphens`, version 1.4. 70 entries: "-либо", "-нибудь",
"кое-", "-нито", "-то", compass directions and words written without their hyphen. Engine: `ǾǾǾ`.
Book `missing-hyphens.fb2`; snapshots `missing-hyphens.xml` (`--select n5:0:0`) and
`.not-found.xml` (`--select n15:0:0 --answer ok`). Walk from n5: `олибо`, ` нибудь`, ` коекуда`,
`всетаки`, `попрежнему`, `Северозапад`, `юговост`, `шли то `, `Шурымуры`, `хухрымухры`, `нито ` (the
one after "Инкогнито" is excluded by `(?<!ме|инког)`), "nothing found". The paragraph
"Что<U+00A0>нибудь" is passed over: `([\s]нибудь)` with JScript's `\s` does not take the
non-breaking space (JavaScript's own `\s` would).

### 29 Поиск разрывов абзацев (АНГЛ)

`29_paragraph-breaks-english`, id `21/paragraph-breaks-english`, version 1.4. 19's list with `”`
among the line ends that are not broken. Snapshots `paragraph-breaks-english.xml` (`--select
n8:0:0`) and `.not-found.xml` (`--select n23:0:0 --answer ok`) on `paragraph-breaks.fb2`. Walk from
n5: as 19 without the `”` hit. Open question: as 05.

### 30 Обратный поиск по набору регэкспов (версия с исключениями) (заготовка)

`30_regexp-set-backward-template`, id `21/regexp-set-backward-template`, version 1.5. The template of
the backward search: the shipped list is the original's example, `>PUS/<\d+>PUS<` (a number in
superscript) and `cba` (finds "abc"), with TaKir's macros. Book `backward-template.fb2`; snapshots
`regexp-set-backward-template.xml` (`--select n8:16:16`) and `.not-found.xml` (`--select n5:0:0
--answer ok`). Walk from the end of n8: `ABC` (`cba` is case-insensitive), `10` (superscript), `abc`,
"nothing found ... до начала документа". Differences as 23. Fixes: an entry without a description
stopped the original with an error when hit (it read the description to test for "Пропустить") -
now an ordinary hit; an exception matching an empty string made the original search the same place
forever - the search now moves one character on. Neither occurs with the shipped list.

### 32 Перейти на следующую пустую строку

`32_next-empty-line`, id `21/next-empty-line`, version 5.4 ("СТАРАЯ, используется для корректной
работы с пустыми строками"), by Sclex with TaKir's ideas. Two entries: `(^$)` (an empty line) and
`(^[\x20\xA0]+$)` (a line of spaces); the 5.4 engine, conditions knowing annotation. Book
`empty-lines.fb2`; snapshots `next-empty-line.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n20:0:0 --answer ok`). Walk from n5: the empty line n6 (selected from the end of n5 to the
start of n7), the spaces of n8, the empty lines n10 and n11 in one step (end of n9 to start of n12),
the empty paragraph n13 (caret), the non-breaking spaces of n14, the empty line ending the first
section (end of n15 to the start of the next section's title), "nothing found". Differences: an
empty line cannot hold the caret, so a hit on one is shown as that selection and consecutive empty
lines are passed in one step (the original stopped at each); the original's cursorShift crutch for
IE's caret at DIV boundaries is dropped; the engine's.

### 62 Поиск (без замены) последовательностей 'буква пробел буква пробел...'

`62_spaced-letters`, id `21/spaced-letters`, version 5.1. One entry: three or more single letters
separated by spaces or non-breaking spaces. Book `spaced-letters.fb2`; snapshots
`spaced-letters.xml` (`--select n5:0:0`) and `.not-found.xml` (`--select n11:0:0 --answer ok`). Walk
from n5: `р а з р я д к а`, `н е р а з р ы в н ы е` (non-breaking spaces), `в б г`, `р а з` (across the
end of italics), `s p a c e d`, "nothing found"; two single letters in a row ("а в нём") are not.

### 64 Замена символов по списку из буфера обмена

`64_replace-characters-from-clipboard`, id `21/replace-characters-from-clipboard`, version 1.0, by
Sclex and stokber. Needs a selection (the original refused without one: "Выделите текст!..." with
its help). Reads the list from the clipboard (`mfbe.clipboard.readText`), removes spaces and empty
lines, refuses a line of one or three or more characters, then replaces each pair's character in
the selected text of every paragraph the selection touches, the pairs one after another in the
list's order; runs keep their marks (one character becomes one), the caret ends at the end of the
former selection. It works only in a run the user starts: in a run the AI assistant starts, reading
the clipboard is refused and the script says so and stops. Book `replace-characters.fb2`;
snapshots `replace-characters-from-clipboard.xml` (`--select-range n5:6-n6:13`, list
"аА⏎ оО ⏎⏎.!⏎бВ" with CR LF), `.too-long.xml` ("аАБ" - the two-characters message),
`.empty.xml` (empty clipboard) and `.blank.xml` (spaces and a line break only - "Буфер обмена
пуст..." as the original's `str == false`). Expected and found: `Альфа и ОмегА — АВв!` (the text
before offset 6 untouched), `Курсив <emphasis>АВв</emphasis> и <strong>жирный</strong> текст.` (the
text after offset 13 untouched), the third paragraph unchanged. Differences: the list is read
directly instead of being turned into JavaScript and run with `eval` - same order, a repeated
character changing its replacement but not its place, and the pair of two straight quotes, which
the original could not turn into code, applied; line breaks of any platform; the clipboard refusal.

### 65 Замена слов по списку из буфера обмена

`65_replace-words-from-clipboard`, id `21/replace-words-from-clipboard`, version 1.2, by stokber.
Reads "word replacement" lines from the clipboard, checks them (letters only, two words a line),
shows the list and asks to go on, then replaces every whole, case-sensitive occurrence that lies in
one piece of text between tags, in the bodies and - as the original's settings have it - the book's
annotation and the document's history; a word continuing across formatting is marked and left
alone. It counts the occurrences in the text before and after (the original's innerText), reports
the words replaced and, when some are left, offers to put on the clipboard a regular expression
finding them (`mfbe.clipboard.writeText`). The HTML work uses the original's expressions on the
notation of `lib/legacy-html.js`. Clipboard reading: as 64. Book `replace-words.fb2`; snapshots
`replace-words-from-clipboard.xml` (list of three pairs, OK, OK; outputs.json holds the clipboard
`(?<![a-zA-Zа-яёА-ЯЁ])(Машипка|ашипка)(?![a-zA-Zа-яёА-ЯЁ])`), `.all-replaced.xml` (one pair, 2
replaced, no offer), `.cancel.xml` (Cancel at the list - unchanged), `.no-regexp.xml` (Cancel at the
offer - same book as the first, no clipboard), `.not-a-letter.xml`, `.three-words.xml`,
`.one-word.xml` (the three list errors - unchanged). Expected and found: annotation `Аннотация:
молоко и ошибка.`, history `История: опечатка.`, `Здесь ошибка и опечатка.`, `Курсив
<emphasis>ошибка</emphasis> целиком.`; left alone `аши<emphasis>пка</emphasis>`,
`при<emphasis>ашипка</emphasis>` and `Машипка` (an upper-case letter counts as a non-letter for the
count but as a letter for the replacement); "Заменено слов: 6 / Не исправлено слов: 2".
Differences: the list read directly (no `eval`), a tab-separated line passed over instead of
stopping with an error; line breaks of any platform; the clipboard refusal.

### 70 Проставить ударения над буквами, выделенными жирностью, курсивом либо регистром

`70_stress-marks-from-formatting`, id `21/stress-marks-from-formatting`, version 1.1, by stokber on
jurgennt's "Генеральная уборка" engine by Sclex. Asks for the mode: OK - a single vowel in italics or
bold inside a word becomes the stressed vowel without the formatting (a vowel formatted by itself
between words is protected by the original's `<b>` markers); Cancel then OK - an upper-case vowel
after a lower-case letter, or after one capital at a word's start, becomes the stressed lower-case
vowel; Cancel twice - "Вы ничего не выбрали!". Bodies, annotation and history; the original's
expressions on the `lib/legacy-html.js` notation, `\s` as JScript's; the count of stressed letters
before and after, the original's time string. Book `stress-marks.fb2`; snapshots
`stress-marks-from-formatting.xml` (OK), `.upper-case.xml` (Cancel, OK), `.nothing.xml` (Cancel,
Cancel - unchanged). Expected and found, mode 1: `папа́`, `о́чень` (bold italics), `моло́ко`,
annotation `приме́р`, history `ве́рсия`, the stand-alone bold `и` kept, "Заменено букв: 5"; mode 2:
`моло́ко` only ("молОко"), "Заменено букв: 1". No differences.

### 71 Поиск паразитной разрядки текста

`71_stray-letter-spacing`, id `21/stray-letter-spacing`, version 5.1, by Sclex and stokber, TaKir's
list. Five entries: a letter that cannot be a word by itself between spaces, at a line start, or
between a space or a dash and punctuation; returns "Found"/"NotFound"; `&shy;` not decoded. Book
`stray-spacing.fb2`; snapshots `stray-letter-spacing.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n11:0:0 --answer ok`). Walk from n5: ` р `, ` з `, ` д ` (consecutive letters share their
spaces, so every other one is found), `д ` at a line start, ` д.`, `«т `, `— н `, "nothing found"
(`run()` returned "Found" seven times, then "NotFound"). Open question: the alternatives `( |□|▫|◦| )`
hold two ordinary spaces (□ ▫ ◦ were FictionBook Editor's non-breaking-space display characters), so
a letter between non-breaking spaces is not found, as in 2.7.9 with the default setting.

### 75 Поиск текста из буфера обмена

`75_find-clipboard-text`, id `21/find-clipboard-text`, version 1.3, stokber's code on Sclex's engine.
Reads one line from the clipboard ("Буфер обмена пуст..." without text, "Вы скопировали больше
одной строки..." for several lines), escapes its special characters, drops its leading and trailing
spaces and turns every run of spaces into `[\x20\xA0]+` (JScript's `\s`: a non-breaking space in the
clipboard text stays itself), then searches for it case-sensitively from the end of the selection;
nothing found: "От позиции курсора до конца документа строки: '...' не найдено. Перейти в начало
документа?" - OK puts the caret at the start of the first body. Returns "Found"/"NotFound". Works only
in a run the user starts (as 64). Book `clipboard-search.fb2`; snapshots `find-clipboard-text.xml`
("искомый текст"), `.nbsp.xml` ("искомый<U+00A0>текст"), `.not-found.xml` (OK), `.cancel.xml`,
`.multiline.xml`, `.empty.xml`. Walks: "искомый текст" from n5 - `искомый текст`, `искомый  текст`
(two spaces), `искомый<U+00A0>текст`, the question (case-sensitive: "Искомый текст" is not found),
after OK the caret at the first text block and the next run at the first hit again; the clipboard
"искомый<U+00A0>текст" finds only the non-breaking one; "  (1+1)  " finds `(1+1)`. Fix: Cancel to the
question made the original search again from the start of its paragraph and ask again, until OK was
pressed; Cancel now ends the run. Differences: line breaks of any platform; the start of the book is
the first body's first text block; the clipboard refusal; the engine's.

### 80 Поиск нецензурных слов

`80_obscene-words`, id `21/obscene-words`, version 1.7, with imDaniX's swear-word expression (credited
in the kept notice). The original's settings and word lists (`astEnd`, `mat`, `neMat`) are kept as
written at the top of `index.js`. 14 entries: the exception list ("скипидар", "мандала"...) first,
words with asterisks, Russian swearing by the main expression, English swearing, mentions of
organisations banned in the Russian Federation; "nothing found" adds "«Поиск нецензурных слов» v.1.7";
returns "Found"/"NotFound"; `&shy;` not decoded. Book `obscene-words.fb2`; snapshots
`obscene-words.xml` (`--select n5:0:0`) and `.not-found.xml` (`--select n11:0:0 --answer ok`). Walk
from n5: "скипидара" and "мандала" are exceptions (without the exception entry both are hits of the
main expression), `мудаком` (МАТ), `fuck`, `х*й` (a word with an asterisk), `Facebook`, "nothing
found" with the version line.

### Not converted

None.

2 of the group's 25 scripts in 2.7.9 are the successors of the 2 packages converted from 2.7beta1
(task T087, recheck of `scripts/21_search-replace/`; the 2.7beta1 conversion is in
conversion-notes-c.md, group 21; the 23 new scripts are converted above). Both **updated**; ids
and folders unchanged. Both ran on the 0.0.1 port of 2.7beta1's engine (`regexp-search.js`,
Sclex's "Поиск по набору регэкспов" 2.9); in 2.7.9 they run on its 5.x engine, so both packages
now carry `regexp-set.js`, the port of that engine described above (an identical copy, as in the
group's other searches), and the 0.0.1 engine file is gone. Each keeps its original's `init()` as
written, only `addMacros`, `addRegExp` and `tagRegExp` handed in; `legacy` names the 2.7.9 file
and its version (5.1, 5.2); both gained `name.uk` and `description.uk`. Neither has a proverb.
Reference books: two new ones in `tests/scripts/fixtures/279/21/` (valid per
`resources/schema/FictionBook.xsd`); the new snapshots are in `tests/scripts/snapshots/21/` and
its `suite.json`. The walks below were written from the 2.7.9 code before the runs (for 04 also
cross-checked by applying the 174 entries to each paragraph's text and HTML as IE gave them) and
agree with the private probe's printouts run by run.

What the 5.x engine changes for these two packages, against their 0.0.1 engine:
- A hit right at a collapsed caret is found: 2.7beta1 started one character further
  (`ignoreNullPosition`, commented out in 5.x), so the caret placed in front of a hit skipped it.
- The paragraph is seen as IE showed it: in the text an inline picture is `~~~` (0.0.1 counted
  it as one character that no expression matched, to keep the positions right; the new engine
  maps positions back exactly), a soft hyphen is decoded (2.7beta1 left `&shy;` in the text,
  where the garbage expressions caught its `&`; 0.0.1 already had the character); in the HTML
  the marks nest as the book nests them (0.0.1 sorted them, emphasis outside strong), links are
  `<A class=note href="#n1">`, styles `<SPAN class=NAME>`, a picture `<SPAN class=image ...><IMG
  ...></SPAN>`, and `&nbsp;` and `&shy;` are entities.
- A tag hit that ends inside a tag, or fails its look-behinds, is tried again one character
  further (2.7beta1 and 0.0.1 resumed after that tag; 2.7beta1 resumed after a failing match,
  where 0.0.1's native look-behind already tried every position). With 04's entries, which cannot
  match across a tag's `>`, both give the same hits.
- Exceptions: a hit whose description starts with "Пропустить" is passed over.
- Nothing found: "Поиск завершен!" in the status bar, then the message. The caret's paragraph is
  not searched when the caret is at its end; an entry that does not compile is listed indented;
  with no selection, or a selected block picture, the original's "Не обрабатываемый тип
  выделения: sel.type" (0.0.1 said "Поставьте курсор в текст книги.").

### 04 Поиск (без замены) ошибок текста (регэкспы от wotti, Roxana, JonVic и др.)

`scripts/21_search-replace/04_text-error-search`, id `21/text-error-search`: **updated**, from
2.7beta1's *04_Поиск ошибок текста (регекспы от wotti, Roxana, JonVic и др.)*, version 2.9, to
5.1. 2.7.9 changed the engine only: the list - 174 entries (129 on the HTML, 45 on the text) and
13 more commented out - is the same call for call (the lists extracted by running the `init()` of
both originals and of the package are identical). Ported: the engine (`regexp-set.js` with `~~~`
and `&shy;` decoded, as the original's `imgTagRE_` and `shyRE`), the list as written with the
original's instructions in `init()`, the notice (*Версия 5.1*). Names: ru and undo label *Поиск
(без замены) ошибок текста (регэкспы от wotti, Roxana, JonVic и др.)*, en *Search (without
replacing) for text errors (regexps by wotti, Roxana, JonVic et al.)*, uk *Пошук (без заміни)
помилок тексту (регулярні вирази від wotti, Roxana, JonVic та ін.)*; the description gained uk.
Like the original it returns nothing to a calling script (a caller running it four times got
`undefined` four times). The list has none of the patterns JScript and JavaScript read
differently (no `\s`, no class opening with `]`), no exception, no entry without a description
and none that matches an empty string, so the engine's guards (see 10) do not come into play.

Book `text-error-search.fb2` (new). Expected walk from the caret right before "пего" (n5:6):
`пего` at the caret (n5; "слово "пего" ("него" с опечаткой)"); the inline picture (n6, the `~`
of its `~~~`: "мусор после скана"); nothing in "Это кни­га без ошибок." (soft hyphen decoded -
2.7beta1 reported the `&` of `&shy;`); `рсив` of `Кур<strong><emphasis>сив</emphasis></strong>`
("курсивность и жирность в слове."); `рный` of `Жир<emphasis><strong>ный</strong></emphasis>`
("жирность и курсивность в слове."); `3-4`; then "Поиск завершен!" and "От позиции курсора до
конца документа ничего не найдено." Found so. The 0.0.1 package on the same book passed over
`пего` and the picture, said "жирность и курсивность" for both words and left the status bar
alone at the end. On `tests/scripts/fixtures/books/conv-c-21.fb2` from n7 the walk is the 0.0.1
one - `пего`, `3-4`, `рсив`, the `е` ending a line without a full stop, `nи`, the `п` starting
the subtitle, ` ,` - then "Поиск завершен!" and the message.

Snapshots: `text-error-search.xml` (`conv-c-21.fb2`, `--select n7:0:0`) stays - a search changes
nothing, and its expected result, the unchanged book, is the same. Added:
`text-error-search.caret-at-hit.xml` (`--select n5:6:6`, the hit at a collapsed caret),
`.picture.xml` (`--select n6:0:0`, the picture hit), `.not-found.xml` (`--select n12:0:0 --answer
ok`). They equal the book except n10, whose `<emphasis><strong>` the editor writes as
`<strong><emphasis>` when it saves the book (a script that does nothing gives the same).

Differences: the engine's three (the hit selected exactly and the search started exactly at the
end of the selection; the view's scrolling; a picture selected as text searched past). No fixes.
Open question: an inline picture is reported as "мусор после скана", as in 2.7.9 and 2.7beta1
(the same question as 08); the 0.0.1 package passed over pictures, so users of 0.0.1 to 0.0.5 now
meet them among the hits - should pictures be passed over? Observed, not a difference of the
script: after the book is saved and reopened, a word in `<emphasis><strong>` is reported as
"курсивность и жирность" (the editor's nesting), where FictionBook Editor, which kept the book's
nesting, kept saying "жирность и курсивность".

### 10 Поиск (без замены) по набору регэкспов (версия с исключениями) (заготовка)

`scripts/21_search-replace/10_regexp-set-search-template`, id `21/regexp-set-search-template`:
**updated**, from 2.7beta1's *10_Поиск по набору регэкспов (заготовка)*, version 2.9, to 5.2
(paired by the review). 2.7.9 made it the template of the version with exceptions:
- the header of 06, kept as written: version 5.2, Sclex with TaKir's set, stokber's fixes of
  30 January and 6 April 2023, TaKir's advice (clean the text first, a hotkey, bookmarks such as
  `zzz`);
- the list: TaKir's seven macros (`<откр-закр-em-str>` to `<сокращения>`), stokber's comments on
  exceptions and one example entry, `addRegExp("123","","Найдено: 123.")`; 2.7beta1's placeholder
  `addRegExp("","i","Задайте список регэкспов, отредактировав скрипт…")` - an empty expression
  that moved the caret on by one character per run and showed that instruction - is commented
  out, and its italics-in-a-word examples are gone;
- the 5.2 engine (06's), which also returns "Found" or "NotFound" (`scriptResult`).

Ported: all three - `init()` as written, `regexp-set.js` with `~~~` and `&shy;` decoded, `run()`
returning the engine's result. The header's English translation of the instructions, kept from
0.0.1, now follows 2.7.9's (the look-behind limit, exceptions) and warns about empty hits (see the
open question). Names: ru and undo label *Поиск (без замены) по набору регэкспов (версия с
исключениями) (заготовка)*, en *Search (without replacing) by a set of regexps (version with
exceptions) (template)*, uk *Пошук (без заміни) за набором регулярних виразів (версія з
виключеннями) (заготовка)*; the descriptions now say what the shipped example finds.

Book `regexp-set-template.fb2` (new). Expected walk from n5:0 (one text entry, no word
boundaries): `123` (n5), the `123` inside `41234` (n6), `123` (n6), then "Поиск завершен!" and the
message; `1 2 3` and `12-3` are not hits; from the caret right before the `123` of `41234`
(n6:7) that one is found. Found so; a caller running the template four times through
`mfbe.scripts.run` got `["Found","Found","Found","NotFound"]`. On `conv-c-21.fb2` (no "123") from
n7:3 nothing is found.

Snapshots: `regexp-set-search-template.xml` (`conv-c-21.fb2`, `--select n7:3:3`) stays: 2.7beta1's
template moved the caret there, 2.7.9's finds nothing and says so, neither changes the book.
Added: `regexp-set-search-template.example.xml` (`--select n5:0:0`) and `.not-found.xml`
(`--select n7:0:0 --answer ok`), both equal to the book.

Differences: the engine's three. Fixes, as for the backward template 30 (the template is the list
meant for editing; the guards are in every copy of the engine): an entry without a description
stopped the original with an error when it was hit (it tested the description for
"Пропустить"), now an ordinary hit; an exception matching an empty string made the original
search the same place forever, now the search moves one character on. The shipped list has
neither, so its results are 2.7.9's. Open question: a hit right at a collapsed caret is not
skipped, so an entry that matches an empty string - among them the instructions' own
`addRegExp("(?=\")",...)` for putting the caret in front of the found text - finds the same place
on every run (a copy of the template with that entry stayed at the first straight quote three
runs running); kept as 2.7.9 behaves - skip an empty hit at a collapsed caret, as 2.7beta1 did?

### Harness commands

```bash
G=scripts/21_search-replace; F=tests/scripts/fixtures/279/21; S=tests/scripts/snapshots/21
node tests/scripts/run-script.mjs $G/04_text-error-search $F/text-error-search.fb2 --select n5:6:6 --snapshot $S/text-error-search.caret-at-hit.xml
node tests/scripts/run-script.mjs $G/04_text-error-search $F/text-error-search.fb2 --select n6:0:0 --snapshot $S/text-error-search.picture.xml
node tests/scripts/run-script.mjs $G/04_text-error-search $F/text-error-search.fb2 --select n12:0:0 --answer ok --snapshot $S/text-error-search.not-found.xml
node tests/scripts/run-script.mjs $G/10_regexp-set-search-template $F/regexp-set-template.fb2 --select n5:0:0 --snapshot $S/regexp-set-search-template.example.xml
node tests/scripts/run-script.mjs $G/10_regexp-set-search-template $F/regexp-set-template.fb2 --select n7:0:0 --answer ok --snapshot $S/regexp-set-search-template.not-found.xml
```

## 22_Дескрипшен

7 scripts in 2.7.9, all new, all converted (T064) into the new group `scripts/22_description/`
(*Дескрипшен*). They are by Александр Ка and edit the book's description, which the originals
reached as the fields of FictionBook Editor's Description form (the IE page `fbw_desc`) and as
the annotation and history blocks of the Body view. The packages do the same work on the
description of the document model: `mfbe.doc.get()` reads it and one `mfbe.doc.setDescription`
writes it back. Two rules carry the form over:

- a list of the form (genres, authors, translators, sequences, custom-info, source URLs) always
  held one row at least, a blank one for an empty list; the model's empty list is that row;
- the annotation and the history were always present in the Body view, an absent one as one empty
  line. An empty line the script adds is an `empty-line`, as 2.7.9 saved it, and an annotation or
  history that is left with empty lines only is not written, as 2.7.9 did not write it.

Reference books: `tests/scripts/fixtures/279/22/templates.fb2`, `templates-repeat.fb2`,
`edit-description.fb2`, `edit-description-auto.fb2` and `edit-description-history.fb2`. The templates are shipped with empty data,
and the two-step script needs a user between its steps, so most runs go through test packages in
`tests/scripts/fixtures/279/22/22_tests/`. These fill the template's sections, or edit the
intermediate body, and run the real package through `mfbe.scripts.run`. Each package therefore
takes its settings and data from `ctx.args` when another script runs it, with `today`
(YYYY-MM-DD) as the date it takes as today, so that a history line does not depend on the day of
the test run. Snapshots: `tests/scripts/snapshots/22/` (23), listed in its `suite.json`.

### 00 Изменить дескрипшен - исходный шаблон

Package `scripts/22_description/00_change-description-source-template`, id
`22/change-description-source-template`, version 1.4.

**What it does.** A template: the user writes into the script's sections НАСТРОЙКИ (template
name, the authors of the file added or replaced, a new document id, keep or delete the history
and the annotation, raise the version with a history line, its text and name) and ДОБАВЛЯЕМЫЕ
ДАННЫЕ the values for `<title-info>` (genres, authors, title, keywords, dates, languages,
translators, sequence, annotation lines with `<strong>`, `<emphasis>`, `<sup>`, `<sub>`),
`<src-title-info>`, `<document-info>` (version, authors, programs, dates with "сегодня" for
today, source OCR and URL, a history line), `<publish-info>` and `<custom-info>`. A filled value
replaces the book's. The window lists the fields changed; as shipped, the data are empty and the
template changes nothing, and the window says how to fill it in.

**Conversion.** `index.js` keeps the two sections as written, with English guidance: the same
variable names, the same values and the shared counter `k` that places every block at its own
index. So a section filled in for FictionBook Editor can be pasted into a copy unchanged. The
logic is `lib/change-description.js`, which is shared with templates 01 to 05 through a version
switch and is byte-identical in the six packages. It follows the original step by step, with the
same order and the same use of `k`:

- genres, authors and sequences are replaced row by row, the unused rows removed;
- the authors of `<document-info>` are added after the last row (into it when it is blank), and
  names that are there already are skipped, or replaced when ChangeAuthor = 0;
- an annotation line goes after an empty line separating it from the book's text, or makes the
  annotation when that is empty, and is not added a second time;
- the history line goes into the last empty line or a new one, and is not added a second time;
- *HistoryChange* updates the line of the last ten days that ends with "— name, date". It puts
  the text in front of "Скрипт" or after a full stop, and the date becomes today's. Without such
  a line it raises the version (1.3 → 1.4, 7 → 7.1, empty → 1.0 → 1.1), adds "v.<old> — ?" when
  the history does not mention the old version, and adds "v.<new> —  <text> — <name>, <date>".

The expressions that tested a line's HTML (the empty-line tests `reELine`, `reELine_ex`) run
verbatim on the line in the IE page's notation. The history lines are edited in the notation of
`lib/legacy-html.js`, as the original edited their `innerHTML`.

**Snapshots** (`templates.fb2` unless named), with the expected result written from the code:

- `change-description-source-template.xml`: as shipped. The book is unchanged; the window says
  ">> Исправлений нет" with the hint.
- `.replace.xml` (test package 01, ChangeAuthor = 0, today 2026-10-31):
  - genres sf_fantasy, adventure (the match 80 dropped);
  - authors Мария Иванова (keeps AUTHOR-1, since the data give no id), Гость
    (guest@example.com, AUTHOR-NEW), Третий Автор without an id (2.7.9: AUTHOR-NEW, see
    fixes);
  - title "Новое название", date "2026" with the value 2026-01-01, source language de;
    translator Отто Шмидт; sequence "Новая серия" 3, its nested sequence removed;
  - the annotation gets an empty line and "Новая **жирная** строка & *курсив*" (the empty first
    line and the blank last line are dropped);
  - `<src-title-info>` is created with John Smith, "Original Title" and en;
  - the document author becomes Новый Верстальщик;
  - the source URL is http://new.example only;
  - the history line "v.1.4 — Правка по шаблону <тест> — Зорро" is added;
  - the publisher, year 2026 and sequence "Серия издательства" without a number are set;
  - one custom-info "template" with two lines is left.
- `.add-history.xml` (test package 02, ChangeAuthor = 1, Version_on_off = 1, today
  2026-10-31): the document author Зорро (there already) is skipped and Новый Верстальщик is
  added. The keywords and the language equal the book's, so they are not reported. No history
  line of the last ten days exists (20.10.2026 is older), so the version becomes 1.4, "v.1.3" is
  in the history, and the line "v.1.4 —  Общая правка — Зорро, 31.10.2026" is added (the
  double space is the original's).
- `.history-line.xml` (test package 03, today 2026-10-25): "v.1.3 — Вычитка — Зорро,
  20.10.2026" is within ten days and becomes "v.1.3 — Вычитка. Общая правка — Зорро,
  25.10.2026". The version stays.
- `.clear.xml` (test package 04, ClearAnnotation = ClearHistory = ChangeID = 0, Version_on_off
  = 1): the annotation is only "Только <sup>новая</sup> строка". The id is new (elided in the
  snapshot). The history is emptied, then gets "v.1.3 — ?" and "v.1.4 —  Общая правка — Зорро,
  31.10.2026". The version is 1.4.
- `.repeat.xml` (test package 06 on `templates-repeat.fb2`): the annotation lines "Роман (1990)
  о **главном**.", an empty line, "Издание [второе] + исправленное?" and the history line
  "v.2 — Правка [вторая] + вычитка? — Зорро" are in the book already. Nothing changes, while
  2.7.9 added them again (see fixes).

**Differences.**
- A bundled script cannot be edited in place. The comment and the window say how to fill in a
  copy: Scripts > Open scripts folder, a new id in the copy's script.json, Scripts > Reload
  scripts.
- The work is done on the document's description, as described above.
- The reminder about the caret in a text field of the Description form (Napominanie) is gone. It
  guarded against a crash of FictionBook Editor that this editor does not have.
- main.js's global `fbeUserName` is not read, since there is no main.js.
- A language code is written as given; FictionBook Editor's list box took only the codes of its
  list.
- A sequence number that is not an integer is left out (the model holds integers only).
- The language of a sequence or a custom-info entry, which the form did not hold, stays.
- The window is the editor's message box, in Russian or English. The undo label is the
  package's, with the original's label as the step's name.
- Another script may pass settings, data and `today` in `args`.

**Fixes.**
- A person added beyond the book's persons no longer takes the id of the row before it. 2.7.9
  added the row as a copy of the row before, and 1.4 keeps a row's id when the data give none.
- The texts looked for are matched as written, not as regular expressions: the new history line
  and annotation lines ("already there?"), and the history text, the name, the dates and the
  version in *HistoryChange*. 2.7.9 added a text with brackets, "+", "?" or "[" again on every
  run, or stopped with a syntax error.

**Open questions.**
- A filled author keeps the id of the book's author in that row when the data give no id (1.4;
  1.2 cleared it). This is kept: is the id meant to stay with the row?
- Templates 01 to 05 are copies of version 1.2; should they follow 1.4? (See 01.)

### 01 Изменить дескрипшен - шаблон 1

Package `scripts/22_description/01_change-description-template-1`, id
`22/change-description-template-1`, version 1.2.

**What it does.** One of the five empty copies of the template that 2.7.9 ships, for five
templates of one's own. They are version 1.2 of the template, while the source template 00 is
1.4: the author improved 00 in 1.3 and 1.4 but did not refresh the copies. Each package keeps
its own version's behaviour, through the version switch of the shared engine. The differences of
1.2 are these:

- the annotation and history texts are HTML, not plain text with four tags (a "<" that starts no
  tag stays text, as the IE page read it);
- an author's id that the data leave empty is cleared;
- every field the data name is listed as changed, whether it changed or not;
- the empty-line tests take a line with only formatting as empty, but not one with a picture's
  SPAN, and the leading and trailing empty data lines are judged by their text;
- the "v.<old> — ?" line is added also when the version is not of the form digits.digits;
- there is no reminder.

**Snapshots.** `change-description-template-1.xml`: as shipped, the book unchanged.
`.replace.xml` (test package 05, the data of 00's `.replace`): the same result, except that
Мария Иванова has no id, since 1.2 clears it.

**Differences.** As for 00, without the reminder.

**Fixes.** The texts looked for are matched as written and as the page shows them. 2.7.9 compared
the template's own HTML, as a regular expression, with the page's normalised HTML, so a text with
brackets, "&" or tags in another case was added again on every run.

**Open question.** Should the five copies follow version 1.4 of the source template?

### 02 Изменить дескрипшен - шаблон 2

### 03 Изменить дескрипшен - шаблон 3

### 04 Изменить дескрипшен - шаблон 4

### 05 Изменить дескрипшен - шаблон 5

Packages `scripts/22_description/0N_change-description-template-N`, ids
`22/change-description-template-N` (N = 2 to 5). They are byte-identical copies of 01 apart from
the name, the id and the icon, as the 2.7.9 files are identical copies. Each has a snapshot as
shipped: `change-description-template-N.xml`, the book unchanged. Differences, fixes and the open
question are those of 01.

### 99 Редакция описания документа

Package `scripts/22_description/99_edit-description-as-text`, id `22/edit-description-as-text`,
version 1.1.

**What it does.** It works in two steps.

The first run writes the text data of the description into a body of its own, named
"Раздел «description-1.z.<code>»", where `<code>` sums the settings that shape it. The body holds:

- a citation that tells the settings;
- a section per part (`===<title-info>===` …), with the title "• Название:", the authors
  ("Фамилия | Имя | Отчество | Ник: … | Почта: … | Сайт: … | ID: …"), the keywords, the
  translators and the sequences ("• Серия:" and "• Номер:" in nested sections) of
  `<title-info>` and `<src-title-info>`;
- the authors, programs and source OCR of `<document-info>`;
- the book name, publisher, city, year and sequences of `<publish-info>`;
- the type and value lines of `<custom-info>`;
- an explanation.

There the data can be edited by hand or with other scripts.

The second run reads the body back with the original's rules:

- a name without separators is divided by its heuristic; a name with more than two separators
  asks whether to stop;
- repeated names are dropped, and the names are sorted when Sortirovka is on;
- a part whose heading is gone is emptied;
- the lists not shown are cleaned where they are.

It then applies its automatic operations:

- white space is made single and trimmed;
- a repeated source language is removed when DelLang = 0, and the source language of
  `<title-info>` is taken from `<src-title-info>`;
- the date value is made from a text date and the text from a value, and a text date
  "YYYY-MM-DD" is written out;
- a partly filled `<src-title-info>` gets the genres and the language of `<title-info>`.

Last, it removes the body, raises the version with the line "v.<new> —  Скрипт:
«Редакция описания документа» 1.1 — <name>, <date>" (or updates the line of the last ten days),
and shows what changed (2.7.9 added a proverb under the results; see the differences). With
Pause = 0 both steps run in one go, with nothing shown in the body: the automatic clean-up alone.

**Conversion.** `index.js` keeps the settings section as written, with English guidance. The
logic is `lib/edit-description.js`, which follows the original part by part:

- the body is built as 2.7.9 built it, with the same text, `inCode`, the same ShowEmpty
  conditions and the same "empty container" clean-up;
- the second step reads the body's lines as the IE page gave them (`innerText`: lines joined by
  CR LF, a non-breaking space read as a space) and applies the original's expressions verbatim:
  the name splitting `reFIO`, `reIOF`, `reFI`, `reIF`; the keyword extraction; the custom-info
  value's CR LF handling; the date formats of `AddDateVal`, `AddDate`, `ChangeDate`;
- the binary insertion that drops repeated names and sorts ("Ф LAST FIRST MIDDLE NICK ID", Ё after
  Е) is ported as written;
- *AddSeq*, which walks the body's sequence sections and the form's rows in step, runs on a model
  of the form's rows, so nested sequences and sections without a title come back as 2.7.9 wrote
  them.

The body, its markers and its explanation are in Russian in every interface, as in 2.7.9: they
are book content that the second step reads.

**Snapshots** (`edit-description.fb2` unless named), with the expected result written from the
code:

- `edit-description-as-text.xml` (as shipped, step 1): the body "Раздел
  «description-1.z.4087»" comes after the book's body, before the notes. It holds the citation,
  "• Название: Редакция  описания" and the authors "Сидоров | Иван | Петрович | Ник: | Почта:
  ivan@example.com | Сайт: http://sidorov.example | ID: AUTHOR-1" and "Ёлкина | Анна | | Ник: |
  Почта: | Сайт: | ID:". The author without a name is left out (2.7.9 failed on the list, see
  fixes). Then the keywords as they are, the translator, Цикл 2 with Подцикл 1 nested, the empty
  entries of `<src-title-info>`, the document author " | | | Ник: Зорро | Почта: … | Сайт:", the
  programs, source OCR, the four publish fields, Библиотека 7, the custom-info lines with one
  empty line, and the explanation. The description is unchanged.
- `.two-steps.xml` (test package 07: step 1, a user's edits, step 2, answer No):
  - the title "Новая редакция описания" and the keywords "редакция, описание, проверка";
  - the authors Иван Петрович Сидоров (AUTHOR-1, e-mail, site), Анна Ёлкина, Лев Николаевич
    Толстой (divided by `reFIO`) and Антуан / де Сент-Экзюпери (`reFI`); the repeated Сидоров
    line is dropped, and "Один | Два | Три | Четыре" asked about and skipped;
  - the date value 2025-05-17 made from "17.05.2025";
  - the translator kept with its id TR-1, which the text does not hold;
  - the sequences Цикл 2 with "Подцикл второй" 3, and "Новая серия" without its number "5а";
  - `<src-title-info>` with John Smith (from "Smith John"), "Original Title", the genres of
    `<title-info>` and the language en;
  - the source OCR removed with its section; the city removed; the year 2021; the ISBN trimmed;
  - custom-info "note" with the lines trimmed and the run of empty lines made one, and a new
    "added";
  - version 1.4 and the history line "v.1.4 —  Скрипт: «Редакция описания документа» 1.1 —
    Зорро, 31.10.2026"; the body is removed.
- `.two-steps-stop.xml` (the same, answer Yes): only the title was written before the stop. The
  version is raised with the history line, and the body stays, as in 2.7.9.
- `.automatic.xml` (test package 08, Pause = 0):
  - the title and keywords with single spaces, and the author without a name dropped;
  - the date value 2025-05-17, the source OCR with single spaces, the ISBN trimmed;
  - the custom-info lines trimmed;
  - version 1.4 with the history line;
  - no body left.
- `.first-body.xml` (test package 10): an old description body "…1.z.1" is put before the
  book's body, then Pause = 0 runs. The old body goes although it is the first body, and the
  result is that of `.automatic.xml`.
- `.other-settings.xml` (test package 09, step 1 with ShowEmpty = 0, FIO = 0, Delenie = 0,
  Sortirovka = 1, the sequences of `<title-info>` and the authors of `<document-info>` hidden,
  no explanation): "Скрыты списки: серии <title-info>; авторы <document-info>."; the authors
  sorted and without separators ("Анна Ёлкина", "Иван Петрович Сидоров | Почта: … | Сайт: … |
  ID: AUTHOR-1"); no empty entries; `<src-title-info>` only its heading.
- `.automatic-dates.xml` (test package 11 on `edit-description-auto.fb2`, Pause = 0,
  Sortirovka = 1, DelLang = 0, no history line):
  - "Иван " trimmed and the authors sorted (Ёлкина first), the repeated translator dropped,
    "Цикл  первый" made single-spaced;
  - "5 мая 2001 г." given the value 2001-05-05;
  - the repeated source languages ru and en removed, then the title-info source language taken
    from the source book's en;
  - the source book's "2020-12-01" given its value and written "1 декабря 2020".
- `.first-name-first.xml` (test package 12, FIO = 0, Delenie = 0, ShowEmpty = 0, names added
  between the steps): "Лев Николаевич Толстой" (`reIOF`), "Антуан де Сент-Экзюпери" (`reIF`
  gives first name "Антуан де", last name "Сент-Экзюпери": the heuristic that the explanation
  calls imperfect), "Ли | Бо", "Иван | Петрович | Сидоров | Ник: Ваня" (a person of its own,
  because of the nickname) and "Жюль Верн | Почта: verne@example.com".
- `.history-line.xml` (test package 13, Pause = 0, today 2026-10-25): as `.automatic.xml`, but
  "v.1.3 — Вычитка — Зорро, 20.10.2026" is within ten days. It becomes "v.1.3 — Вычитка. Скрипт:
  «Редакция описания документа» 1.1 — Зорро, 25.10.2026" (";" added and then made "." with
  "Скрипт:", then the name and the date), and the version stays 1.3.
- `.history-scripts.xml` (test package 14 on `edit-description-history.fb2`, Pause = 0, Vsegda_on_off
  = 1, today 2026-10-25): "v.1.0 — Скрипт: Почистить структуру 3.14 — Зорро, 24.10.2026" becomes
  "v.1.0 — Скрипты: Почистить структуру 3.14; «Редакция описания документа» 1.1 — Зорро,
  25.10.2026".
- `.history-version.xml` (test package 15 on `edit-description-auto.fb2`, Pause = 0, Vsegda_on_off
  = 1): the automatic clean-up of `.automatic-dates.xml` without sorting and with DelLang = 1. The
  book has no history, so the version becomes 2.1 with "v.2.0 — ?" and "v.2.1 —  Скрипт:
  «Редакция описания документа» 1.1 — Зорро, 31.10.2026".

**Differences.**
- The description is the document's and the body is a body of the book.
- The body is placed after the book's first body, not before it: a script cannot remove the
  first body. A description body that a book saved by FictionBook Editor holds first is
  replaced by the book's next body when it is taken out.
- FB2 needs content after a section's title and annotation, so an empty line follows the title
  of "Название", of each sequence and of the explanation; step 2 passes over it. An empty data
  line is an empty paragraph (to type into); a blank line of the explanation is an empty-line,
  as 2.7.9 saved it.
- The caret goes to the new body's title, while 2.7.9 only scrolled there. A name in error is
  selected, not coloured.
- The reminder (Napominanie), the setting for the window's height (Vysota_teksta) and the
  window's pages are gone; the message box scrolls.
- main.js's `fbeUserName` is not read.
- The results show no proverb: left out pending the requester's decision. 2.7.9 closed the
  window with a random saying from its own list of wartime proverbs, which is not in the package.
- Fields that the text does not hold come back for the names left unchanged: a translator's or
  document author's id, further e-mails and home pages, a sequence's language. 2.7.9's form did
  not hold them, so it lost them.
- A sequence number that is not an integer is left out.
- Another script may pass settings and `today` in `args`.

**Fixes.**
- A person without a name or nickname before the end of a list no longer stops the script.
  2.7.9's `M.pop()` dropped the last row instead and left a hole on which the sorting failed;
  this happened in step 1 and for the lists not shown.
- The texts looked for in the history are matched as written, not as regular expressions.
- A date value with the month 00 no longer gives the text month "undefined".
- A language copied into `<src-title-info>` is reported as "Язык", not "Язык оригинала".

**Open questions.**
- Answering Yes to "Прервать выполнение скрипта?" keeps what step 2 wrote before that name,
  raises the version and keeps the body, as 2.7.9 does. Should Yes rather leave the description
  as it was?
- Restore the proverb of the result message?

## 30_'Числовые' скрипты

13 scripts in 2.7.9: 12 new, 1 successors of converted packages. Not yet converted or rechecked.

## 31_Автоматизация

6 scripts in 2.7.9: 6 new, 0 successors of converted packages. Not yet converted or rechecked.

## 32_Маркеры сносок

9 scripts in 2.7.9: 9 new, 0 successors of converted packages. Not yet converted or rechecked.

## 34_Управление курсором либо выделением

One script in 2.7.9, **new, converted** (T068): `scripts/34_caret-selection/001_caret-to-document-start/`,
id `34/caret-to-document-start`, `legacy.source` the 2.7.9 path, name and description in ru, en
and uk, `needsSelection: false`, the 2.7.9 icon, the original's notice verbatim
(`check-notices.py --package`: OK).

### 001 Установить курсор в начало документа

v1.0, Sclex. The original collapsed a text range over its page's `fbw_body` to its start, nudged
it into the first character (`move("character", 1)`, `-1`), selected it and scrolled to the top:
the caret went to the start of the book annotation, which that page always showed first (a `DIV`
with one empty paragraph when the book has none). The Body view shows the book annotation first
in the same way (with an empty paragraph when there is none), so the conversion puts a caret - an
empty selection - at the start of the first text block of the Body view's annotation block (also
when the annotation starts with a cite or a poem: the first paragraph inside) and scrolls there.
The block is reached with `selection.selectNode('desc:annotation')`, the Body view's id of that
block (feature 004), whose selection starts at its first text block; the caret is then set there
with `selection.set`. The script API has no call for the start of the Body view, and the empty
paragraph of a missing annotation has a UI id the model does not know (`ui_block_1`), so a script
cannot name it otherwise. Should the Body view show no annotation block, the caret goes to the
start of the first text block of the first body. The document does not change.

**Acts on** the caret; **returns** nothing (`null` in a calling script). The combos of 2.7.9
(09/38, 09/39, 13/590, 14/057-062, 31/50, 31/51, 37/06, 37/07, the templates 31/30-33) run it
before a `while (… "Перейти на следующий …" … == "Found")` loop: afterwards the caret stands before
every body - in the annotation block - so the next navigation script searches from before the first
element of the first body, and finds one that starts at the very start of the body (the body
title) as in 2.7.9.

Reference books: `tests/scripts/fixtures/279/34/caret.fb2` (an annotation starting with a cite, a
history, two sections) and `caret-no-annotation.fb2` (the same without annotation and history).
Snapshots (`tests/scripts/snapshots/34/suite.json`; gate `tests/scripts/run-all.sh --group 34`: 3
snapshots, all pass):
- `caret-to-document-start.xml` (`--select n12:3:3`, a caret in the last paragraph): the book
  unchanged;
- `caret-to-document-start.chain.xml` and `.chain-no-annotation.xml`: the chain runner of
  `tests/scripts/fixtures/279/19/chain-runner` runs the script by its 2.7.9 path with a leading
  backslash (`\34_Управление курсором либо выделением\001_Установить курсор в начало документа.js`)
  from the same caret; its report (`.outputs.json`) shows the caret afterwards at `n15:0` - the
  cite's paragraph at the start of the annotation - and at `ui_block_1:0`, the empty annotation
  paragraph of the Body view, with an empty selection text.

No difference, fix or open question.

## 37_Эпиграфы

5 scripts in 2.7.9: 5 new, 0 successors of converted packages. Not yet converted or rechecked.

## 40_Таблицы

3 scripts in 2.7.9, all new, all converted (part of T068) into the new group
`scripts/40_tables/` (*Таблицы*). They are by stokber, and 01 uses Sclex's "go to the next
table". The originals rewrote the IE page's HTML of the tables. Here the tables are those of the
document model (contracts/document-model.md §4 of feature 006: `table` > `tr` > `td` / `th`,
with `colspan`, `rowspan`, `align` and `valign`).

Reference books: `tests/scripts/fixtures/279/40/tables.fb2` and `tables-none.fb2`. `tables.fb2`
holds these tables:

- in the book's annotation;
- two in chapter 1, the first with a header row aligned to the centre, a colspan, a rowspan with
  align and valign, an id and a style on the table and on cells, an empty cell, a non-breaking
  space, emphasis, bold, a note link and an inline picture in cells;
- one right after a section's title;
- one after a section's annotation;
- one in a citation;
- one alone in a section;
- one in the notes body.

Chapter 4 holds stray labels: struck out, in italics, with a picture. The notes body holds a
label too. Snapshots: `tests/scripts/snapshots/40/` (9 runs, 3 of them with
`<snapshot>.outputs.json` holding the report window), listed in its `suite.json`.

### 01 Показать следующую таблицу в HTML-виде

Package `scripts/40_tables/01_show-next-table-html`, id `40/show-next-table-html`, version 1.3.

**What it does.** It selects the next table after the end of the selection. A table the
selection ends in is skipped, since the search looks for the first text block in a different
table. It shows the table as an HTML table in a window. Without a table up to the end of the book
it says so and puts the caret at the end of the selection.

**Conversion.** The text blocks of the bodies are taken in document order, each with the table it
is in; they are the page's P elements. The search starts after the block of the selection's
end. The table is selected with `mfbe.selection.selectNode`. `lib/table-html.js` (shared with 02,
byte-identical) writes `<table>`, `<tr align>`, `<td>` / `<th>` with colspan, rowspan, align and
valign, and the cell's formatting in the page's notation (`lib/legacy-html.js`: EM, STRONG,
STRIKE, SUB, SUP, the code and style SPANs, A). Ids and styles are left out and non-breaking
spaces become spaces, as the original's expressions did. `mfbe.ui.report` shows it with the
style of `HTML/Показать таблицы в HTML-виде.html` and the title " :: Таблицы в виде HTML :: ".

**Snapshots** (the book unchanged in all three; the window in `.outputs.json`):

- `show-next-table-html.xml` (caret in "Перед таблицами."): the first table of chapter 1. The
  header row is centred, then "Объединено" colspan 2. "A1", an empty cell and "C1–C2
  **жирно**" with rowspan 2, right, top. Then "A2 с пробелом" (the NBSP a space), and "B2" with
  the link `<A class=note href="#n1">[1]</A>` and `<IMG alt="#pic.png">`. The ids and styles are
  gone.
- `.in-table.xml` (caret in the cell "A1"): the first table is skipped and the next one, "Одна
  ячейка", is shown.
- `.not-found.xml` (selection in the notes table's cell): no table after it. The message is
  "До конца документа не нашлось ни одной таблицы!", the caret goes to the selection's end, and
  no window opens.

**Differences.**
- The window is the editor's report window, with Copy and Save as…, not an IE window.
- The setting display = 1 (a temporary file opened in the default browser) is gone: it needs a
  file of the script's own and another program. Save as… of the window gives such a file.
- The HTML is written from the model's table, not by rewriting the page.
- The characters □▫◦ stay: they stood for non-breaking spaces in FictionBook Editor's view, and
  2.7.9 replaced them by spaces.
- A picture in a cell shows its name: a script gets no picture's bytes, and a report shows only
  embedded pictures.
- The tables of the book's annotation and history are not looked at, since the search runs
  through the bodies.

**Fixes.**
- An empty cell no longer takes the next cell's text. 2.7.9's expression `([\s\S]+?)` wanted
  one character at least, so the row lost a cell.
- A cell or table whose id is not a word (a hyphen in it) is converted like the others.

### 02 Показать все-все таблицы в HTML-виде

Package `scripts/40_tables/02_show-all-tables-html`, id `40/show-all-tables-html`, version 1.3.

**What it does.** It shows every table of the book, in the order of the page (the book's
annotation, the history, the bodies), each under "Табл. N из M", with four line breaks after
each. A book without tables gets "В документе таблиц не найдено!".

**Conversion.** As in 01 (`lib/table-html.js`, `mfbe.ui.report`).

**Snapshot.** `show-all-tables-html.xml`: the book is unchanged. The window shows the 8 tables:
"в аннотации" (1), the two of chapter 1 (2, 3), "Сразу после заголовка", "После аннотации
раздела", "В цитате", "Одна в разделе" and "В примечании" (8).

**Differences.** Those of 01 (window, display = 1, model-based HTML, □▫◦, pictures), without the
search.

**Fix.** A table or cell whose id is not a word is shown and counted like the others. 2.7.9 kept
only the lines that start with a bare table tag, so such a table lost its `<table>` and was not
counted.

### 03 Помочь заменить таблицы на их изображения

Package `scripts/40_tables/03_replace-tables-with-pictures`, id `40/replace-tables-with-pictures`,
version 1.11.

**What it does.** It helps replace tables with pictures of them, in two passes. The first
question chooses:

- **OK:** above every table it puts an empty picture (`#undefined`) and a struck-out label
  "zzz_табл N из M_zzz", N counting the tables in the order of the page; the pictures are then
  made and set by hand;
- **Cancel:** it deletes every table with its content, every paragraph that is only such a
  label (whatever its formatting, but not one with a picture) outside the annotations, the
  history and the notes and comments bodies, and the containers that this leaves empty.

The second question offers to stop and read the help instead. The counts go to the status line.

**Conversion.**
- The first pass inserts the label and then the picture before each table with
  `mfbe.doc.insertNode`. Where FB2 refuses the picture, it is tried after the label, then left
  out. Labels in the annotation and the history go in through `setDescription`.
- The second pass removes the tables from copies of the bodies, the annotation and the history.
  It then runs the original's `delNum` walk: a label is removed, and a container of `re1` that
  this empties is removed with it, upwards. Each changed body is written back with
  `mfbe.doc.replaceNode`.

**Snapshots:**

- `replace-tables-with-pictures.xml` (OK, OK), 8 labels "N из 8":
  - 1 in the annotation, label only;
  - 2 and 3 in chapter 1, picture and label;
  - 4 after chapter 2's title, the picture in the section's picture slot;
  - 5 after chapter 3's annotation, label, then picture;
  - 6 in the citation, label only;
  - 7 alone in a section;
  - 8 in the notes.
  The status line counts 2 tables without a picture.
- `.delete.xml` (Cancel, OK): the 8 tables are gone, including those of the annotation and the
  notes. The labels "9 из 9" (struck out) and "8 из 9" (italics) of chapter 4 are removed. The
  label with a picture and the notes' label stay. Chapter 2 is left with its title and the
  emptied section with nothing, so each gets an empty line.
- `.help.xml` (OK, Cancel): the help, the book unchanged.
- `.no-tables.xml` (`tables-none.fb2`, Cancel, OK): the two labels are removed, and the emptied
  section with them. Then "Таблиц в документе не нашлось.", as in 2.7.9, where `delNum` runs
  before that check.
- `.both-passes.xml` (test package
  `tests/scripts/fixtures/279/40/40_tests/01_pictures-both-passes`, both passes in a row): the
  pictures stand where the tables were. An empty line comes before the picture after chapter 3's
  annotation, and after the picture of chapter 2 and of the emptied section. The labels in the
  annotation and the notes stay (see open questions).

**Differences.**
- The work is done on the document model.
- Where FB2 allows no picture (a citation, an annotation, the history), only the label is
  inserted, and right after a section's annotation the picture follows the label. 2.7.9 inserted
  the picture there too, which FB2 does not allow. The status line names the tables without a
  picture.
- An empty line stays where the second pass leaves a section with no content after its title,
  epigraphs, picture and annotation (or with none at all), or with a picture first there. An
  emptied first body keeps one section. FB2 needs content there, while 2.7.9 left such sections.
- The questions are the editor's message boxes (OK / Cancel), in Russian or English.
- The icon is the skeleton's 16 × 13 picture, made from the original's .ico.

**Fix.** The tables are counted whatever their attributes. 2.7.9 counted only tables written
exactly `<DIV class=table>`, so with a styled table it numbered the labels wrongly, "0 из 2" for
three tables.

**Open questions.**
- The second pass does not delete labels in annotations, the history or the notes and comments
  bodies (the walker skips them, and processAnnotation and processHistory are false), although
  the first pass puts labels there. This is kept as 2.7.9 behaves.
- The second pass deletes labels even when there is no table, then says there is none. This is
  kept as well.

## 95_Для программистов

3 scripts in 2.7.9: 0 new, 2 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 99_Прочее

2 scripts in 2.7.9: 2 new, 0 successors of converted packages. Not yet converted or rechecked.

## TreeCmd

1 script in 2.7.9, *Пример 1.js*, byte for byte 2.7beta1's, and so is its icon (task T088,
recheck of `scripts/tree/example-1`; the 2.7beta1 conversion is in conversion-notes-c.md,
TreeCmd).

### Пример 1

`scripts/tree/example-1`, id `tree/example-1`: **unchanged**. The code is not touched; `legacy`
keeps the 2.7beta1 source `TreeCmd/Пример 1.js` and `fbeVersion` "2.7"; the original has no
header notice to keep. Names as 2.7.9's (the file name, and the title `GetTitle()` gave the tree):
ru *Пример 1*, en *Example 1* - 0.0.1 had added *: абзацы без точки* / *: paragraphs without a
full stop*, which the form's title keeps - and uk *Приклад 1*; the undo label was already *Пример
1* / *Example 1*. Gained `description.uk` *Приклад команди дерева: показує абзаци вибраного вузла
(або всієї книги), у яких немає крапки, і переходить до вибраного*. No proverb.

Snapshot `tree/example-1.xml` (`tests/scripts/fixtures/books/conv-c-16.fb2`, `--tree-node n14
--answer '{"target":"n23"}'`) stays; `tests/scripts/run-all.sh --group tree` passes.

Difference kept from 0.0.1, still true against 2.7.9: the original marked the document for the
Document Tree - `ProcessCmd()` wrapped every paragraph whose text holds no full stop in `<DIV
class="abc">` (`GetClassName()`), and the tree listed those paragraphs under «Пример 1». Tree
commands are entries of the Document Tree's context menu here, run on the clicked node, and the
document holds no marking classes: the command lists the text blocks without a full stop inside
the clicked node (the whole book without a node) in a form, selects the one chosen and gives
their count in the status bar. No fixes, no open questions.

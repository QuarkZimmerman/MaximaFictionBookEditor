# FictionBook Editor 2.7.9 scripts — groups 21 to 99, the root script and TreeCmd (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## (top level)

The one script at the top of 2.7.9's Scripts folder, outside every group, which the conversion of
2.7beta1 dropped; re-examined here under FR-024 with script API version 2 (part of T069), and still
not converted.

### 29 Режим чтения

v1.1 (Sclex), windows-1251; the 2.7.9 file is 2.7beta1's unchanged. Names: ru "Режим чтения", en
"Reading mode", uk "Режим читання". Inventory: `"group": ""`; no package and no id (had it been
converted it would have gone into `scripts/99_misc/` with an id `99/<slug>`).

**What it does.** `Run()` makes the Body view's page read-only (`fbw_body.contentEditable = "false"`)
and installs its own handlers on it, which stay after the script ends:
- the arrow keys and the mouse wheel scroll by whole text lines - Down one line, Right three, Up one,
  Left three - found by a binary search over the page's elements and the lines of a paragraph
  (`getBoundingClientRect`, `getClientRects`) and scrolled with `scrollBy`;
- a click on a link to a place in the book (`#id`) scrolls to its target and remembers the link;
  Backspace scrolls back to the last one remembered;
- any other click leaves the mode: the page becomes editable again, the caret goes to the clicked point
  (`moveToPoint`) and the handlers are removed.

**Reason (FR-024: the editor's own page).** A mode of the editor's view, not an edit of the book: a
script can neither make the Body view read-only, nor receive its clicks, keys and wheel turns, nor
measure or scroll it line by line, and its run ends before the reading begins - while a run lasts, the
document is under the run's lock and the script's dialogs are modal. API version 2 adds the clipboard,
files, report windows and other scripts, none of which helps.

**Needs.** A reading mode of the Body view in the editor itself: a read-only view with line-wise
scrolling by keys and wheel and a back stack of followed links. No script API within principle V could
offer it: it would need the view's events and layout.

Record: `tests/scripts/audit/updates-279/top.json` (`notConverted`, names reviewed).

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

12 scripts are new in 2.7.9 and all 12 are converted (T065) into `scripts/30_numbering/`, a new
group. The group's 13th script, *Нумерацию 'число пробел' в началах выделенных абзацев сделать
надстрочным текстом*, is 2.7beta1's *Нумерацию в началах строк - надстрочным текстом* moved here from
group 18 under a new name: its package moved here with it, to
`scripts/30_numbering/40_line-numbers-to-superscript` (its id unchanged), and is brought up to the
2.7.9 version in its recheck. None of the twelve needs a power beyond FR-024: they only read and edit
the book and ask the user.

**Where the originals worked.** FictionBook Editor showed the book as one HTML element, `fbw_body`:
a div for the title-info annotation, one for the document-info history (both always there, an absent
one as an empty `<P>`) and one per body. Every text block was a `<P>` - paragraphs, title lines,
verses, subtitles, text authors, dates (class `text-author`), table cells (class `td`/`th`) - and so
was an empty line, an empty `<P>`. The numbering scripts (Sclex, versions 1.2 and 1.3) pasted an
empty marker element (`<B id=BlockStart…>`, `<B id=BlockEnd…>`) at each end of the selection and
walked the page from the element under the selection's start: the `<P>` holding the start marker and
every `<P>` met after it, up to and including the one holding the end marker, got the number or
marker by `insertAdjacentHTML("afterbegin", …)` - plain text before everything else of the
paragraph, outside its formatting. The removal scripts (Sclex, 1.3) walked from the `<P>` holding the
start marker to the one holding the end marker and removed, in each, the start of its text that
matched their expression, counting the characters outside the tags of its `innerHTML`
(`removeSymbolsBeyondTags`). Afterwards both re-selected between the two markers, which had moved with
the text, and removed them. FictionBook Editor saved a numbered empty `<P>` as a paragraph and a `<P>`
left with nothing but white space as an `<empty-line/>` (FBDoc.cpp; a verse in a stanza as
`<v> </v>`).

**Shared code** (each package carries its own byte-identical copies):

- `lib/numbering.js` (new, all twelve): the selection on the page (`textSelection`: a caret or a
  selected picture is no selection), the paragraphs of the selection for the numbering scripts
  (`paragraphsOfSelection`: from the one holding its start to the one holding its end) and for the
  removal scripts (`paragraphsForRemoval`: the same, less a last paragraph at whose very start the
  selection ends), the originals' `isLineEmpty`, `insertAdjacentHTML("afterbegin")` on a paragraph
  (`withTextBefore`; an empty line becomes a paragraph), the originals' `processP` of the removal
  scripts with `removeSymbolsBeyondTags` kept as written (`removeLeadingNumbering`, on the
  paragraph's `innerHTML` in the notation of `lib/legacy-html.js`), FictionBook Editor's saving of an
  emptied `<P>` (`savedNode`), the writing back (`PageEdits`: the bodies' paragraphs with
  `doc.replaceNode`, the annotation's and the history's with one `doc.setDescription`, the empty
  paragraph of a missing annotation or history as a new one) and the re-selection (`reselect`).
- `lib/nav-lib.js` (the page as FictionBook Editor showed it, and the selection in it: `loadBook`,
  `locate`) and `lib/legacy-html.js`, copied unchanged from the packages of groups 16 and 06.

**Reference book and snapshots.** `tests/scripts/fixtures/279/30/numbering.fb2` (valid against
`FictionBook.xsd`): an annotation of two paragraphs and no history; a first chapter with a title, an
epigraph, paragraphs (one with italics, one starting with bold), an empty line, a paragraph of two
spaces, a paragraph holding only an inline picture, a poem (two verses, a text author), a subtitle, a
table of two cells, a cite and a last paragraph; a second chapter of numbered paragraphs ("1) ",
"1) 2) ", "12.  ", "3. ", "4.1. ", a bold "5)", a note link "6)", a paragraph "7)" alone,
"8. 9) ", "10)" without a space, a number in the middle, a poem with "13) " and "14.") and a notes
body. Snapshots: `tests/scripts/snapshots/30/`, 24 runs listed in `tests/scripts/snapshots/30/suite.json`;
the test package `tests/scripts/fixtures/279/30/30_tests/reselect` runs five of the scripts through
`mfbe.scripts.run` on selections it sets and records the selection each one leaves
(`number-with-dot.reselect.outputs.json`). The harness runs in the English interface. Every expected
result below was worked out from the original's code before the run; each snapshot equals it. Below,
`⍽` stands for a non-breaking space; "range A" is the selection from offset 5 of "Первый абзац главы."
(n10) to offset 8 of "Последний абзац главы." (n30), "the description range" from offset 3 of the
annotation's second paragraph (n59) to offset 5 of "Глава первая" (n6), "range R" from the start of
"1) Пункт со скобкой." (n34) to offset 3 of "15. Последний пункт." (n49).

**Common differences.** A selected picture gets the message for a missing selection (2.7.9 stopped
with a script error: its selection was then a control range); the originals' message for a
selection in an input field (`TEXTAREA`, `INPUT`) is gone, a script sees the Body view only. The
numbering scripts and the removal scripts need a selection (`needsSelection`) and keep their message
for a missing one.

**Common open question.** The originals re-selected with `tr1.setEndPoint("StartToStart", tr2)`
from the start marker's range to the end marker's; that is taken here, as in the earlier conversions
of the same code (`01_Регистр`, `18/line-numbers-to-superscript`), as selecting between the two
markers. If Internet Explorer collapsed that range instead, 2.7.9 left a caret at the end of the
selection.

### 01 В началах выделенных абзацев добавить нумерацию вида '1.' (не нумеровать пустые строки)

Package `scripts/30_numbering/01_number-with-dot`, id `30/number-with-dot`, version 1.2 (Sclex).

**What it does.** Puts "1.⍽", "2.⍽", … before the content of every paragraph of the selection, the
empty ones (an empty line, a paragraph of spaces and non-breaking spaces only) left out; a paragraph
holding only an inline picture is not empty (its `<IMG>` stayed in `isLineEmpty`'s text). Then it
re-selects the selection. The status text while it runs is the one of *Нумерацию в началах строк -
надстрочным текстом* ("Делаем числа в началах абзацев надстрочным текстом…"), as in the original.

**Conversion.** `numberParagraphs` with the prefix `cnt + "." + NBSP` and `skipEmpty`.

**Expected and snapshots.** `number-with-dot.xml` (range A): n10 "1.⍽", n11 "2.⍽", the empty line
and the paragraph of spaces left out, n14 "3.⍽" before its bold start (unformatted), n15 "4.⍽"
before the picture, the verses "5.⍽", "6.⍽", the poem's text author "7.⍽", the subtitle "8.⍽", the
cells "9.⍽", "10.⍽", the cite's paragraph and text author "11.⍽", "12.⍽", n30 "13.⍽".
`number-with-dot.description.xml` (the description range): the annotation's second paragraph "1.⍽"
before its italics, the empty paragraph of the missing history left out, the body title "2.⍽",
"Глава первая" "3.⍽". `number-with-dot.one-paragraph.xml` (n10 offsets 2-6): n10 alone.
`number-with-dot.next-start.xml` (n10 offset 3 to n11 offset 0): n10 and n11 - the paragraph at whose
very start the selection ends is numbered, as the walk met that `<P>` before its end marker. In
`number-with-dot.reselect.outputs.json` the selection after range A is n10:8-n30:12 (both ends moved
by the inserted characters).

### 10 В началах выделенных абзацев добавить нумерацию вида '1.' (нумеровать и пустые строки)

Package `scripts/30_numbering/10_number-with-dot-and-empty-lines`, id
`30/number-with-dot-and-empty-lines`, version 1.2 (Sclex).

**What it does.** As 01, the empty paragraphs numbered too: an empty line becomes a paragraph "N.⍽",
the empty paragraph of a missing annotation or history a new annotation or history holding it.

**Expected and snapshots.** `number-with-dot-and-empty-lines.xml` (range A): 1-15, the empty line
becoming `<p>3.⍽</p>` and the paragraph of spaces "4.⍽  ". `number-with-dot-and-empty-lines.description.xml`
(the description range): the annotation's second paragraph "1.⍽", a new history `<p>2.⍽</p>`, the
body title "3.⍽", "Глава первая" "4.⍽".

### 15 В началах выделенных абзацев добавить нумерацию вида '1)' (не нумеровать пустые строки)

Package `scripts/30_numbering/15_number-with-parenthesis`, id `30/number-with-parenthesis`, version
1.2 (Sclex). As 01 with "1)⍽". Snapshot `number-with-parenthesis.xml` (range A): 1)-13) as in 01. In
`number-with-dot.reselect.outputs.json`, on the description range, the selection after the run is
n59:6-n6:8.

### 20 В началах выделенных абзацев добавить нумерацию вида '1)' (нумеровать и пустые строки)

Package `scripts/30_numbering/20_number-with-parenthesis-and-empty-lines`, id
`30/number-with-parenthesis-and-empty-lines`, version 1.2 (Sclex). As 10 with "1)⍽". Snapshot
`number-with-parenthesis-and-empty-lines.xml` (range A): 1)-15) as in 10.

### 22 Добавить маркеры списка (по выбору пользователя) (не маркировать пустые строки)

Package `scripts/30_numbering/22_add-list-markers`, id `30/add-list-markers`, version 1.3 (Sclex).

**What it does.** Asks for a list marker - the ten signs of the dialog *Добавить маркеры списка (по
выбору пользователя) - основной диалог.htm* (—, ~, •, ■, ♠, ♣, ♥, ♦, #, ^) or one of your own - and
puts it with a non-breaking space before every non-empty paragraph of the selection, as 01. Cancel,
or an empty marker of your own, does nothing. The dialog escaped `&`, `<` and `>` of a marker of your
own, so it was inserted as typed; so it is here.

**Conversion.** The dialog is one `ui.form`: a radio field of the ten signs and "Задать свой маркер:",
a text field for the marker of your own; then `numberParagraphs` with `skipEmpty`.

**Expected and snapshots.** `add-list-markers.xml` (range A, "•"): "•⍽" before the 13 paragraphs of
01. `add-list-markers.own.xml` (n34 to n35 offset 3, "<1>&" of your own): n34 and n35 start with
"<1>&⍽". `add-list-markers.own-empty.xml` (range A, your own, empty): the book unchanged.

**Differences.** The choice of your own marker counts when its option is chosen (the original's dialog
chose it when its field got the focus).

### 25 Удалить 'один слой' нумерации вида '1)' в началах выделенных абзацев

Package `scripts/30_numbering/25_remove-parenthesis-numbering-layer`, id
`30/remove-parenthesis-numbering-layer`, version 1.3 (Sclex).

**What it does.** Removes one "number)" with the spaces and non-breaking spaces after it (the
expression `^\d+\)( |⍽)*`) from the start of every paragraph of the selection, as the text without
its tags - but `<IMG>` and `<A>` - starts: a number inside bold counts, one inside a link does not.
A paragraph left with nothing but white space is an empty line.

**Conversion.** `removeNumbering` with the original's `re3` (`removeLeadingNumbering` runs its
`processP` on the paragraph's HTML notation).

**Expected and snapshot** (`remove-parenthesis-numbering-layer.xml`, range R): n34 "Пункт со
скобкой.", n35 "2) Пункт с двумя слоями.", n39 "Пункт с жирным номером." (the bold went with its
text), n41 "7)" an empty line, n43 "Пункт без пробела.", the verse "Стих с номером."; the dotted
numbers, the link "6)", the number in the middle and n49 unchanged.

**Fixes.** (1) A paragraph at whose very start the selection ends is left alone and the walk stops
there, as the original meant (`nextPAfterBlockEndP`): 2.7.9 tested for that paragraph only on the
branch that walks into containers, so when it directly followed the previous paragraph (or the
selection ended at the start of a formatted part of it) the script went on removing numbering in
every paragraph to the end of the book, the notes included. (2) The original put the HTML of the
whole Body view (`fbw_body.outerHTML`) on the clipboard at every run - a debugging line left between
the walk's preparations - and so replaced what the user had copied (the inventory's `clipboardWrite`);
the conversion leaves the clipboard alone.

**Differences.** A paragraph left with nothing but white space is an empty line at once (a verse in a
stanza holds one space); FictionBook Editor showed an empty paragraph until the book was saved and
saved it so.

### 28 Удалить 'один слой' нумерации вида '1.' в началах выделенных абзацев

Package `scripts/30_numbering/28_remove-dot-numbering-layer`, id `30/remove-dot-numbering-layer`,
version 1.3 (Sclex). As 25 with `^\d+\.( |⍽)*`. Snapshot `remove-dot-numbering-layer.xml` (range R):
n36 "Пункт с точкой и двумя пробелами.", n37 "Пункт с неразрывным пробелом.", n38 "1. Пункт с номером
4.1." (one layer: "4."), n42 "9) Пункт со смешанной нумерацией.", the verse "14." a verse of one space,
n49 "Последний пункт.". In `number-with-dot.reselect.outputs.json`, on n36 offset 6 to n37 offset 3,
the selection after the run is n36:1-n37:0 (moved back by the removed characters before it). Fixes and
differences as 25.

### 31 Удалить 'один слой' нумерации вида '1.' или '1)' в началах выделенных абзацев

Package `scripts/30_numbering/31_remove-numbering-layer`, id `30/remove-numbering-layer`, version 1.3
(Sclex). As 25 with `^\d+[.)]( |⍽)*`. Snapshots: `remove-numbering-layer.xml` (range R: the changes of
25 and 28 together, n35 and n38 losing one layer, n42 "9) …");
`remove-numbering-layer.next-start.xml` (n34 offset 2 to the very start of n36): n34 and n35 change,
n36 stays - in 2.7.9 n36, n37 … n49, the verses and the note's paragraph would all have lost a layer
(fix 1 of 25). In `number-with-dot.reselect.outputs.json` the selection after that run is n34:0-n36:0.
Fixes and differences as 25.

### 33 Удалить все 'слои' нумерации вида '1)' в началах выделенных абзацев

Package `scripts/30_numbering/33_remove-all-parenthesis-numbering`, id
`30/remove-all-parenthesis-numbering`, version 1.3 (Sclex). As 25 with `^(\d+\)( |⍽)*)+`: every
"number)" in a row. Snapshot `remove-all-parenthesis-numbering.xml` (range R): as 25, n35 "Пункт с
двумя слоями.". Fixes and differences as 25.

### 35 Удалить все 'слои' нумерации вида '1.' в началах выделенных абзацев

Package `scripts/30_numbering/35_remove-all-dot-numbering`, id `30/remove-all-dot-numbering`, version
1.3 (Sclex). As 25 with `^(\d+\.( |⍽)*)+`. Snapshot `remove-all-dot-numbering.xml` (range R): as 28,
n38 "Пункт с номером 4.1." ("4." and "1. "). Fixes and differences as 25.

### 37 Удалить все 'слои' нумерации вида '1.' и '1)' в началах выделенных абзацев

Package `scripts/30_numbering/37_remove-all-numbering`, id `30/remove-all-numbering`, version 1.3
(Sclex). As 25 with `^(\d+[.)]( |⍽)*)+`. Snapshot `remove-all-numbering.xml` (range R): every numbered
paragraph but the link's and the middle one loses all its layers, n41 and n48 as in 25 and 28. In
`number-with-dot.reselect.outputs.json`, on n41 offset 1 to n43 offset 5, the start's paragraph "7)"
is an empty line afterwards and the selection starts right after it: n42:0-n43:2. Fixes and
differences as 25.

### 45 Расширенная нумерация абзацев

Package `scripts/30_numbering/45_extended-numbering`, id `30/extended-numbering`, no version (idea
Haliz, written by DeepSeek, 04.11.2025).

**What it does.** Asks for prefix, numbers on or off, start number, step, suffix, "only the selected
paragraphs" and "skip empty paragraphs" (the dialog *Расширенная нумерация абзацев - параметры.htm*),
then puts prefix + number + suffix before every paragraph of the selection (the walk of 01,
re-selected afterwards) or of the whole page - `fbw_body.getElementsByTagName("P")`: the annotation
and the history (their empty paragraphs too), then every body -, skipping the empty ones when asked
and numbering them otherwise (an empty line becomes a paragraph, the empty paragraph of a missing
annotation or history a new one). The number grows by the step only on the paragraphs processed.
With "only the selected paragraphs" and no selection it says "Нет выделения. Будут обработаны все
абзацы в документе." and numbers every paragraph. At the end: "Обработано абзацев: N" or "Не найдено
абзацев для обработки.".

**Conversion.** The dialog is one `ui.form` (its description of the settings as a static field); the
loop is the original's `processP` over `paragraphsOfSelection` or the page's paragraphs, written back
with `PageEdits`.

**Expected and snapshots.** `extended-numbering.xml` (range A, the defaults: no prefix, numbers from
1 by 1, suffix ". "): the 13 paragraphs of 01 with "1. " … "13. ", message "Обработано абзацев: 13".
`extended-numbering.all.xml` (every paragraph, no skipping, prefix "§", start 0, step 2, suffix ": "):
40 paragraphs "§0: " … "§78: " in page order - the two annotation paragraphs, a new history
`<p>§4: </p>`, the titles, the epigraph, the empty line `<p>§18: </p>`, the paragraph of spaces "§20:
  ", the verses, the cells, the second chapter, the notes body. `extended-numbering.no-selection.xml`
(a caret in n10, the defaults): the message for no selection, then 37 paragraphs of the page numbered
1-37 (the empty ones skipped). `extended-numbering.markers.xml` (n34 to n36 offset 4, prefix "• ",
numbers off, no suffix): "• " before n34-n36, message 3. `extended-numbering.negative-step.xml` (the
verses to the subtitle, start 10, step -3, suffix ") "): "10) ", "7) ", "4) ", "1) ".

**Fixes.** A start number of 0 starts at 0: the original's `parseInt(settings.startNumber) || 1` made
0 into 1, although the dialog accepts it and its description says the count may start at any number,
a negative one too (2.7.9 gives "§1: " … "§79: " in `extended-numbering.all.xml`).

**Differences.** The dialog's live preview is dropped. Its number fields always hold a number, so the
original's warnings "Начальное число должно быть целым!" and "Шаг инкремента должен быть целым!"
cannot occur (a fraction counts by its integer part, as `parseInt` took it). The prefix and the
suffix are put in as text; the original inserted them as HTML (`insertAdjacentHTML`), so tags or
entities typed into them were interpreted. A selected picture counts as no selection (2.7.9 stopped
with a script error).

**Open questions.** A step of 0 is taken as 1, as the original's `parseInt(settings.increment) || 1`
did: was a step of 0 (the same number on every paragraph) meant to be possible? And the common
question of the re-selection.

## 31_Автоматизация

6 scripts in 2.7.9: 6 new, 0 successors of converted packages. Not yet converted or rechecked.

## 32_Маркеры сносок

9 scripts are new in 2.7.9 and all 9 are converted (T067) into `scripts/32_note-markers/`, a new
group. None needs a power beyond FR-024: the four searches select a marker and write the status bar,
the two tables use `mfbe.files.saveText` and `mfbe.ui.report` where the originals wrote a file with
FileSystemObject and opened it in the default browser, and three scripts edit the book.

**Where the originals worked.** FictionBook Editor showed the book as one HTML element, `fbw_body`:
a div for the title-info annotation, one for the document-info history (an absent one as an empty
`<P>`) and one per body, every text block a `<P>`, every structural element a div, Internet Explorer
writing it out (`innerHTML`) with a line break before each block element. The searches (01-04, by
stokber) and the tables (11, 12, by stokber) took that whole `innerHTML` and turned it with a long
chain of regular expressions into a list of footnote markers; 60 (Sclex's engine, stokber's
edition) rewrote each `<P>`'s `innerHTML`; 70 and 71 (TaKir and DeepSeek) replaced in the text nodes of
the `<P>`s.

**Shared code** (each package carries its own byte-identical copies):

- `lib/marker-page.js` (01-04, 11, 12): `pageHtml()` rebuilds `fbw_body.innerHTML` from the
  document model in the notation of FictionBook Editor's page (files/fb2.xsl): the annotation and
  history divs, `<DIV class=body fbname=…>`, a div per section, title, epigraph, annotation, cite,
  poem, stanza, table and row, a block picture as `<DIV … class=image …><IMG …></DIV>`, every text
  block a `<P>` (class `subtitle`, `text-author` - a date too -, `td`, `th`), inside it `<STRONG>`,
  `<EM>`, `<STRIKE>`, `<SUB>`, `<SUP>`, `<SPAN class=code>`, `<SPAN class=NAME>`, `<A class=note
  href=…>` / `<A href=…>` and an inline picture `<SPAN class=image …><IMG …></SPAN>`, without
  languages (2.7.9 kept none), the text escaped as `&amp; &lt; &gt; &nbsp; &shy;`. It is a
  `TrackedString`: every character knows the place of the book it shows, and `replace` gives exactly
  what `String.replace` gives while carrying the places along (a group of the match keeps its places,
  a literal replacement of the match's length takes those of the matched characters). Every
  expression of these scripts is compiled as JScript read it (`lib/jscript-regexp.js`: `\s` without
  the Unicode spaces, `.` matching `\r`; the tables' zebra expression `(<tr>.+?\n)<tr>` only matches
  so). `selectMarker` selects the marker a search picked out of its text in the book.
- `engine.js` (01-04, 11, 12) is the original's code kept as written, generated from the 2.7.9 file
  with a short list of counted rewrites named in its header: `Run()` is `engine(host, tx)`; the
  variables it used without declaring them are declared (a module is strict code: `txt`, `i`, and in
  04 also `countSupDoZ`, `countSupDoT`, `markSnoski`); `fbw_body.innerHTML` is `host.innerHTML`; the
  dialog (with its Internet Explorer 6 size check) is `host.chooseMarker()`; `MsgBox`, `alert`,
  `confirm`, the status bar, the clipboard are the host's and awaited (so the functions calling them
  are async); `PerehodFinal` selects through the host; the tables' `MyMsgWindow`/`WriteFile` are the
  host's report window and file; every text is `tx(ru, en)`.
- `lib/search-host.js` (01-04) and `lib/table-host.js` (11, 12): those host objects - the dialog as a
  form, message boxes (`confirm`: OK / Cancel), the status text (kept after the run, as FictionBook
  Editor's stayed), the selection, the clipboard, the report window and the file.
- `lib/page-paragraphs.js` (60, 70, 71): the paragraphs of the page or of the selection (over
  `lib/nav-lib.js`, copied unchanged) and their writing back - the bodies' with `doc.replaceNode`, the
  annotation's and the history's with `doc.setDescription`. 60 also carries `lib/legacy-html.js`,
  11 and 12 `lib/jscript-regexp.js`, unchanged copies.

**Reference books** (`tests/scripts/fixtures/279/32/`, all valid against `FictionBook.xsd`):
`markers-edit.fb2` (60, 70, 71), and for the searches and the tables `markers-pages.fb2` (superscript
footnotes numbered per page on two "pages", [1] endnotes), `markers-in-note.fb2` (a reference inside a
footnote text), `markers-space.fb2` (a space inside a superscript), `markers-not-number.fb2` ([а] with
a letter, {1 } with a space), `markers-asterisks.fb2` (asterisks, a line "* * *", a page starting with
three), `markers-many-asterisks.fb2` (thirteen asterisks), `markers-tilde.fb2` ([~1~] text markers
1, 3; {~1~} text markers 1, 1), `markers-count.fb2` (two superscript references, one text; a # reference
and its text), `markers-text-first.fb2`
(the first marker a text marker), `markers-references-only.fb2`, `markers-smileys.fb2` (a "☺" in the
text). **Snapshots:** `tests/scripts/snapshots/32/`, 44 runs listed in its `suite.json`. The searches
leave the book as it is and the harness records no status text, so besides one direct run each they
run through the test package `tests/scripts/fixtures/279/32/32_tests/checks`, which runs the four
searches one after another (the first by its 2.7.9 path) from the start of the Body view and records
what each returned and the selection it left (`marker-checks.*.outputs.json`). Each expected result
below was worked out from the original's code before the run; for the searches a scratch copy whose
status texts also went to the clipboard confirmed every status text by hand. The harness runs in the
English interface.

### 01 Поиск некорректных маркеров постраничных сносок с постраничной нумерацией

Package `scripts/32_note-markers/01_check-footnote-markers-per-page`, id
`32/check-footnote-markers-per-page`, version 1.2 (stokber).

**What it does.** Asks for the kind of markers - superscript (`<SUP>` and the digits ¹²³…), `*`,
`[1]`, `{1}`, `[~1~]` or `{~1~}` - and checks their numbering for page (or chapter) footnotes numbered
anew on each page. The script wraps each marker of the kind in ☺…☻ (superscripts after mapping ¹²³ to
digits, `n` asterisks as the number `n`, a line of nothing but asterisks being a separator; note links
holding [N] are left out in the mode [1], plain links holding {N} in the mode {1}), takes a marker at
the start of a paragraph for a footnote text marker (t), any other for a reference marker (z), the
first reference after a text marker in the same paragraph, and a reference that follows another with
only formatting tags (and spaces) between them, for a reference inside a footnote text (Z), merges two
markers with only spaces between them, and cuts the list into
"pages", each a run of references followed by the run of texts that closes it. Then it checks, in this
order: more than twelve asterisks, Z, a space inside a reference marker, a reference or a text marker
that is no number, a first text marker before any reference, a page whose first reference or first
text is not 1, a page ending with a reference, references and texts not counting up by one, and a
page with different numbers of references and texts (it asks which of the last correct markers to go
to and gives the number of the future footnote). The first fault goes to the status bar and its
marker is selected: the original counted the markers before the fault in its list and moved the
selection to the same marker of its text. No marker of the kind: "В этом документе не найдено маркеров
сносок …". No fault: "Ошибок нумерации маркеров сносок не найдено." and `run()` returns true, as the
original's `Run()` did.

**Expected and snapshots.** Direct runs: `check-footnote-markers-per-page.xml` (markers-pages,
superscript: no fault) and `check-footnote-markers-per-page.cancel.xml` (the dialog cancelled); the
book stays as it is. Through `32_tests/checks` (the selection after the run): markers-pages,
superscript - no fault, true; markers-pages, [1] - no fault; markers-pages, {~1~} - no marker of the
kind ("…AS BRACES {~1~}."); markers-in-note - Z, the "2" in the footnote text; markers-space - the
space, "1 " in n7; markers-not-number [1] - no number, "а"; {1} - a text marker no number, "1 " of
"{1 }"; markers-asterisks - the second page starts with 3, "***" (the line "* * *" is no marker);
markers-many-asterisks - more than twelve, a caret before the asterisks (the original's length was the
asterisks themselves, which Internet Explorer took for no move; its message says "Курсор (без
выделения)"); markers-tilde [~1~] - text markers 1, 3, the "1" of the first; {~1~} - 1, 1, the "1" of
the first; markers-count - two references, one text: OK goes to the text marker "1" ("…маркер текста
БУДУЩЕЙ сноски № 1."), Cancel to the first reference "1"; markers-text-first - the first marker is a
text marker, its "1".

**Differences.** The marker is selected where it is in the book: the original put the caret at the
start of the Body view and moved the selection by its own count of characters, made on a text it
built from the page's HTML, which went wrong wherever its count and Internet Explorer's differed
(pictures, tables, soft hyphens, empty lines, the description's blocks). The dialog is a form without
its Help button, which opened a window of hints (*Поиск некорректных маркеров сносок - справка.htm*).

**Open questions.** In the mode {1} the original leaves out a link that holds {N} only when it is a
plain link (`<A href=…>`), while the mode [1] leaves out a note link (`<A class=note …>`) holding [N];
whether {1} meant note links too is unclear. Kept as 2.7.9.

### 02 Поиск некорректных маркеров концевых сносок

Package `scripts/32_note-markers/02_check-endnote-markers`, id `32/check-endnote-markers`, version 1.4
(stokber).

**What it does.** As 01 for endnotes: all references first, then all texts, so a reference after a
text marker is a fault of its own ("Маркер знака сноски после текстов сносок…", checked right after
the asterisks), the order checks come earlier, a first text marker before any reference says so
differently when there is no reference at all, the count of the whole book is compared, and the
no-fault message names the script and its version.

**Expected and snapshot.** Direct run `check-endnote-markers.xml` (markers-pages, superscript: the
reference "1" of the second page, after the texts). Through the test package: markers-pages - that
fault and marker; [1] - no fault, the message with "Скрипт 'Поиск некорректных маркеров концевых
сносок' v.1.4"; markers-asterisks - a reference after the texts, "***"; markers-text-first - a
reference after the texts, the second "1"; markers-count - OK the text marker, Cancel the first
reference; the other books as 01.

Differences and open questions as 01.

### 03 Поиск некорректных маркеров постраничных сносок со сквозной нумерацией

Package `scripts/32_note-markers/03_check-footnote-markers-continuous`, id
`32/check-footnote-markers-continuous`, version 1.2 (stokber).

**What it does.** As 01 for footnotes numbered through the book: the first reference of the book must
be 1, the last marker a text marker, the first page's first text marker 1, and the numbers go on from
page to page (references and texts checked across pages first, then within them); the count
question goes to the last correct reference or text marker.

**Expected and snapshot.** Direct run `check-footnote-markers-continuous.xml` (markers-pages,
superscript: after the reference 2 comes the reference 1 of the next page; the "2" in n7). Through the
test package: markers-pages - the same; markers-asterisks and markers-text-first - the last marker is
no text marker, the last reference; markers-count - OK the text marker "1", Cancel the reference "2";
the other books as 01.

Differences and open questions as 01.

### 04 Поиск некорректных маркеров концевых сносок с постраничной нумерацией

Package `scripts/32_note-markers/04_check-endnote-markers-per-page`, id
`32/check-endnote-markers-per-page`, version 1.1 (stokber).

**What it does.** As 01 for endnotes numbered anew on each page or chapter: the references of all
pages come first, then the texts, each page of them starting at 1; a reference after a footnote text
paragraph, with only plain text between them, is a fault ("…не характерно для концевых сносок с
постраничной нумерацией"); the lists of references and texts are cut into pages at each marker 1 and
compared page by page (the confirm question, then a hint in the status bar). When the numbers of pages
of references and of texts differ, a message says so - also after another fault was found, as in the
original. With no marker of the kind the original's code goes on after its message and ends with "no
fault": `run()` returns true.

**Expected and snapshot.** Direct run `check-endnote-markers-per-page.xml` (markers-pages,
superscript: the reference of the second page after the texts, then the message of the pages, 1 and
2). Through the test package: markers-pages - the same; markers-pages {~1~} - "no marker" then "no
fault", true; markers-not-number [1] - no number, then the message of the pages (2 and 1);
markers-asterisks - a reference after the texts, "***"; markers-tilde {~1~} - the second page of text
markers has no references (0 and 1): OK the reference "1" in n7, Cancel the second text marker "1",
then the message of the pages; markers-count - OK the text marker, Cancel the reference "2";
markers-text-first - a reference after the texts, then the message of the pages (0 and 1); the other
books as 01.

Differences and open questions as 01.

### 11 Создать таблицу расположения имеющихся маркеров сносок

Package `scripts/32_note-markers/11_note-marker-positions-table`, id `32/note-marker-positions-table`,
version 1.4 (stokber).

**What it does.** Asks for the kind of markers (also `#`) and makes an HTML table: each reference
marker with up to 120 characters of the text before it on the left, each text marker (at the start of
a paragraph) with up to 120 characters after it on the right, in book order; all rows in the first
zebra colour, the rows of the markers numbered 1 orange, the empty cells grey, a row "Новая страница с
маркерами сносок:" before a reference that follows a text. Note links that hold a superscript number
(FineReader's) are no markers. With the original's default `display = 1` the table is written
into a file and shown; `display = 0` only shows it. A book holding ☺ or ☻ gets a warning and the
expression `(☺|☻)+` on the clipboard; no marker of the kind, a message; markers of one side only, a
message and a table of that side.

**Conversion.** `engine.js`; `WriteFile` is `files.saveText` (the Save dialog proposes "temp.html";
windows-1251, as FileSystemObject wrote on a Russian Windows, with `WriteLine`'s line break) followed
by the report window; `MyMsgWindow` is the report window.

**Expected and snapshots.** `note-marker-positions-table.xml` (markers-pages, superscript, saved): 3
and 3 markers; rows "Начало текста¹" (orange), " и продолжение²", "¹ Первая сноска." (orange), "²
Вторая сноска.", the new page row, "Вторая страница¹" (orange), "¹ Сноска второй страницы." (orange);
the file `temp.html` and the report in the outputs. `.brackets.xml` ([1], saved): the references with
their whole paragraph before them ("…а в скобках [1]", orange), the endnotes. `.asterisks.xml` (the
Save dialog cancelled, the table shown all the same): "Текст*" orange, " и ещё**", "* Первая." orange,
"** Вторая.", a new page row, "Дальше***". `.none.xml` (#): "Не найдено ни одного маркера сносок вида
#." `.one-side.xml` (markers-references-only, the Save dialog cancelled): the message about the
missing text markers, then the table of the two references. `.smileys.xml`: the warning and the
clipboard. The other kinds, the Save dialog cancelled: `.braces.xml` ({1}: "фигурные{1}" orange, " и{2}",
"{2} Вторая фигурная."; "{1 }" with its space is no marker), `.tilde-brackets.xml` ([~1~]: the
references 1, 2, the texts 1 orange and 3), `.tilde-braces.xml` ({~1~}: one reference, two texts, all
orange), `.hash.xml` (#: the cells - not the rows - of the markers numbered 1 orange, as the original
coloured them in this mode).

**Differences.** The table is written where the user chooses (the original wrote HTML/temp.html next
to the program, or the path set in `filePatch`, without asking) and shown in the report window instead
of the default browser, which needed another program; the dialog is a form.

### 12 Создать таблицу соответствия маркеров будущих сносок

Package `scripts/32_note-markers/12_future-notes-table`, id `32/future-notes-table`, version 1.2
(stokber).

**What it does.** As 11, but the table puts the n-th reference marker (with the text before it) beside
the n-th text marker (with the text after it) under the number n of the future footnote; where the
two markers differ the number is red; the markers numbered 1 are orange. No marker of the kind, or no
marker of one side: a message and no table.

**Expected and snapshots.** `future-notes-table.xml` (markers-pages, superscript, saved): three rows
1-3, the markers 1 orange, no number red. `.mismatch.xml` ([~1~], saved): row 2 "[~2~]" beside "[~3~]
Третья.", its number red. The other kinds, the Save dialog cancelled: `.asterisks.xml` (row 3
"Дальше***" beside an empty cell, red 3), `.brackets.xml` ([1]: the two endnotes, no red), `.braces.xml`
({1}: "{1}" beside "{2} Вторая фигурная." red 1, "{2}" beside an empty cell red 2), `.tilde-braces.xml`
({~1~}: row 2 with an empty left cell, no red - the expression that marks a mismatch needs a reference
in the row), `.hash.xml` (#: one row, both cells orange). `.count.xml` (markers-count, the Save dialog cancelled): row 2 " и²" beside
an empty grey cell, its number red. `.none.xml` ({1}): "Не найдено ни одного маркера сносок вида
{1}.". `.one-side.xml` (markers-references-only): "Найдено: маркеров знаков сносок: 2 … текстов
сносок : 0. Таблица создана не будет.".

**Differences.** As 11.

### 60 Убрать пробелы из маркеров сносок надстрочным текстом

Package `scripts/32_note-markers/60_superscript-marker-spaces`, id `32/superscript-marker-spaces`, no
version in its name (VersionNumber 1.0; engine by Sclex, stokber's edition).

**What it does.** In every paragraph of the page - the annotation and the history included, as its
settings `ObrabotkaAnnotation` and `ObrabotkaHistory` say - three expressions on the `innerHTML`: spaces
(and non-breaking spaces) before the end of a superscript go after it, spaces at its start go before
it - in both cases a run of them becomes its last one, as "$1" took it -, and the spaces at the start
of a paragraph before a superscript are removed (emphasis and strong around allowed). Then the message
"–= Jurgen Script =– «Нормализовать пробелы маркеров сносок» v.1.0 stokber Edition", the time taken and
how many paragraphs each rule changed.

**Conversion.** The original's expressions run unchanged on each paragraph's notation of
`lib/legacy-html.js`, compiled with JScript's `\s` (a thin space is no space for them); the paragraphs
are written back with `lib/page-paragraphs.js`.

**Expected and snapshot** (`superscript-marker-spaces.xml`, markers-edit): the annotation's "сноской¹ "
→ "сноской¹  и"; "Текст<sup> 2</sup>" → "Текст <sup>2</sup>"; "<sup>3⍽⍽</sup>с" → "<sup>3</sup>⍽с";
"   <sup>4</sup>" → "<sup>4</sup>"; "<emphasis>Курсив<sup> 5 </sup></emphasis>" → "<emphasis>Курсив
<sup>5</sup></emphasis>  внутри"; the note's "  <sup>2</sup>" → "<sup>2</sup>"; "<sup>6</sup>Ничего"
unchanged, the superscript with `xml:lang` and the one ending in a thin space unchanged; counts 3, 2, 2.

**Differences.** A superscript, an emphasis or a strong with a language (`xml:lang`, which 2.7.9 did
not keep) is not matched by the expressions written for bare tags.

### 70 Заменить числа в круглых скобках на знак # (во всем документе)

Package `scripts/32_note-markers/70_parenthesized-numbers-to-hash`, id
`32/parenthesized-numbers-to-hash`, version 2.0 (idea TaKir, written by DeepSeek and TaKir).

**What it does.** Replaces every whole number in parentheses, "(12)", by "#" in the text nodes of
`document.getElementsByTagName(...)` for p, v, subtitle and text-author - on FictionBook Editor's page
that is every `<P>`: every text block of the annotation, the history and all bodies (table cells and
dates too); the other three tags did not occur there. Each run of text separately, so
"(<emphasis>8</emphasis>)" does not count. The status bar and a message (caption "FBE скрипт") give
the number, with a warning when it is odd; an error shows "Ошибка: …".

**Expected and snapshot** (`parenthesized-numbers-to-hash.xml`, markers-edit): 20 replacements - the
annotation, "(12)" and "(3)", "((6))" → "(#)", the italic "(7)", the note link "(9)", the verse, the
poem's date, the subtitle, the cell, the cite's paragraph and text author, the third chapter's seven
and the note's one; "(1a)", "(b2)", "( 4 )", "(-5)", "(2.5)" and "(<emphasis>8</emphasis>)" stay.

### 71 Заменить числа в круглых скобках на знак # (в выделенном фрагменте)

Package `scripts/32_note-markers/71_parenthesized-numbers-to-hash-in-selection`, id
`32/parenthesized-numbers-to-hash-in-selection`, version 2.0 (idea TaKir, written by DeepSeek and
TaKir).

**What it does.** As 70 in the whole paragraphs of the selection, from the one holding its start to the
one holding its end; it needs a selection.

**Expected and snapshots.** `parenthesized-numbers-to-hash-in-selection.xml` (from inside the
italics of "<emphasis>Начало (21)</emphasis> и текст (22)." to inside the italics of "Конец (24) и
<emphasis>курсив (25)</emphasis> в конце."): 5 replacements in these three paragraphs, the odd-count
warning, "(26)" and "(27)" after them unchanged. `.one-paragraph.xml` (a selection inside "Сноска(12)
и ещё (3)."): 2.

**Fixes.** The paragraphs are always those of the selection: the original took the element holding
each end of the selection (`parentElement`) for its paragraph, so a selection that started inside
formatting skipped its first paragraph, one inside a single formatted part replaced nothing, and one
that ended inside formatting went on to the end of the book (here 2.7.9 would have replaced (23)-(28),
6, leaving (21) and (22)).

**Differences.** A selected picture gets the message for a missing selection (2.7.9 showed "Ошибка:
…": its selection was then a control range); the message for a selection in an input field is gone.

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

5 scripts in 2.7.9, all new: the three that run no other script are converted here (part of T068)
into the new group `scripts/37_epigraphs/` (*Эпиграфы*): 05, 08 and 09. The combos 06 and 07
("(По очереди) расформатировать все эпиграфы от жирности и курсива"), which run scripts of groups 16,
19 and 34, are converted separately. Packages: `scripts/37_epigraphs/<NN>_<slug>/`, ids `37/<slug>`,
`legacy.source` the 2.7.9 path, `sourceVersion` from the header; `name` and `description` in ru, en
and uk, `needsSelection: false`, the 2.7.9 icon where there is one (05, 08), `undoLabel` the name and
the skeleton's notice lines verbatim in `index.js` (`check-notices.py --package`: OK for all three).
None needs a power beyond FR-024.

**Shared code** (each package carries its own copies): group 16's `nav-lib.js` (05 and 09, unchanged,
md5 `e8c399f2…`) for the page of `fbw_body` - the book's annotation and history, then the bodies - and
the selection in it; group 19's `lib/text-blocks.js` (08, unchanged, md5 `5bb0cdd2…`); the shared
`lib/legacy-html.js` (05, unchanged, md5 `72451573…`) for the inline notation of IE's HTML.

**Reference books** (`tests/scripts/fixtures/279/37/`, valid against `FictionBook.xsd`):
`unmarked.fb2` (05: fourteen chapters, each built for one branch of the original's tests, and a notes
body), `unmarked-none.fb2` (05: nothing to find after a marked epigraph), `from-paragraphs.fb2` (09: a
paragraph with an author line in italics, a chapter with an epigraph already, a chapter of one
paragraph, an id, a style and an empty line, a title, a poem of two stanzas, a citation, formatting in
the middle of a paragraph, an author line in part italic, the book's annotation); 08 runs on group 19's
`epigraphs.fb2` and on `tests/scripts/fixtures/279/14/cites.fb2` (no epigraph). **Snapshots:**
`tests/scripts/snapshots/37/`, 19, listed in `tests/scripts/snapshots/37/suite.json`; the selections of
05 and 09 through group 19's chain runner (`tests/scripts/fixtures/279/19/chain-runner`, used as it is),
whose report is recorded in `<snapshot>.outputs.json`. Each expected result below was worked out from
the original's code before the first run; for 05 a scratch copy of the original's `selEpi()`, taken
verbatim from the 2.7.9 file, was run on hand-written IE HTML of every container the search looks at,
in its 2.7.9 form and with the two fixes, and gave the verdicts below.

### 05 Поиск неразмеченных эпиграфов

Package `scripts/37_epigraphs/05_find-unmarked-epigraphs`, id `37/find-unmarked-epigraphs`, v1.12
(stokber, December 2024; built on Sclex's "Перейти на предыдущий заголовок стиха").

**What it does.** `Run1()` looks, from the end of the selection, for the next paragraph inside a title
(any title: of a body, a section, a poem, a stanza - not the one the selection ends in), selects the
title and moves the caret right after it; `selEpi()` takes the `outerHTML` of the DIV holding the first
paragraph after the title and tests it with regular expressions:
- a section, or a section holding one, whose id looks like a note's (`n_1`, `c2`, `comment_3`,
  `FbAutId_4`, `bookmark_5`): stop - "Поиск завершён! Скрипт не ищет эпиграфы после разделов со
  сносками." in the status bar and the message "Поиск завершён!\n\nСкрипт '...' v. 1.12.";
- a title (the first paragraph is another title's) - "Это просто заголовок!": the caret back into this
  title, the next title is tried;
- an epigraph, an annotation, a citation or a poem ("Это просто DIV!"), or a ® anywhere ("символ
  копирайта"): the next title is tried;
- else the section's HTML is cut: the title, then from the first picture, container or subtitle that
  starts a line, to at most 12 lines (the line break after the title counts as the first); tags go,
  entities and soft hyphens become characters (`&shy;` a space), footnote markers move before a
  final full stop; the lines are cut after a line of at most 80 characters followed by one of 81 or
  more, and after the last "epigraph's last line" (`^.{1,80}[\da-zа-яё]([!?]?[\)\}\]»”“*])?$`, i: a
  letter or a digit at the end, optionally `!`/`?` and a closing bracket or quote - an author's name);
  when such a line is left and the lines are not too long for their number (more than 3 lines with
  over 80 characters each on average), they are selected (`colSumb` characters from the caret) and the
  search ends; otherwise the next title is tried.
Nothing found up to the end: "До конца документа скрипт не видит неразмеченных эпиграфов." and the
"Поиск завершён!" message, the caret where the last title tried left it.

**Conversion.** The loop over the titles of nav-lib's page; `lib/ie-page.js` writes the DIV's
`outerHTML` as IE7 serialised FictionBook Editor's page - upper-case tags, the id first, unquoted
simple values, no line break between a container's start tag and its first child, CR LF between
siblings, an empty line `<P></P>`, a block picture `<DIV onresizestart="return false" class=image ...>`
- the layout the original's expressions rely on; `examine()` runs those expressions verbatim, keeping
track of the line on which each `<P>` starts (every step after the title's cut keeps whole lines from
the start), and the lines left are selected exactly with `selection.set`. Statuses and messages as the
original; `run()` returns nothing.

**Expected (unmarked.fb2) and recorded** - `find-unmarked-epigraphs.chain.xml`, 8 calls from the caret
a fresh book has: the body's title (another title follows) is passed, then
1. chapter 1: n7 «Я помню чудное мгновенье:» to n10 «А. С. Пушкин» (the 91-character paragraph after
   it ends the lines);
2. chapters 2 (an epigraph follows the title), 3 (a picture), 4 (only long lines), 5 (a subtitle), 6
   (see the fix) are passed; chapter 7: n46 «Песня ветра,» to n47 «(Из старой песни)»;
3. chapter 8 (a ®) is passed; chapter 9: n60 to n63 «Автор Девятый» (soft hyphens and a picture in the
   lines);
4. chapter 10: n69 «Первая строка,» to n72 «Автор Десятый», the empty line between included;
5. chapter 11 (a poem's title follows; the poem's stanza holds nothing) and «Часть вторая» (a
   subsection's title follows) are passed; chapter 12: n90 to n91 «Автор Вложенный»;
6. chapter 13 (a section with an id that holds a citation) is passed; chapter 14, the same without an
   id: n105 to n106;
7. the notes body's title (a title follows), then the note `n_1`: stop, the caret at the start of its
   text (n116:0), the status and the message;
8. no title after the caret: the two messages, the caret stays at n116:0.
`find-unmarked-epigraphs.none.xml` (`unmarked-none.fb2`): nothing found after the chapter whose title is
followed by an epigraph - the two messages, the caret at the start of the epigraph's paragraph (n8:0).
`find-unmarked-epigraphs.xml`: a run from the fresh caret, the book unchanged.

**Differences.** The lines are selected exactly (the original moved the end of IE's selection by a
count it worked out from the HTML: the lines' characters, one per line break - the one before the first
line included - and no inline picture); the editor scrolls the selection into view; a selected block
picture is refused with group 16's message (the original stopped with a script error); the message for
a selection in an input field is gone.

**Fixes (FR-023).**
- The superscript marks: the original replaced `<sup>` and `</sup>` by temporary marks, so that a
  footnote number in superscript at the end of a line would move before the full stop like `[1]`,
  `{1}` and `*`; written in lower case without the i flag, they never matched the page's `<SUP>`, and
  a line ending with a full stop and a superscript number counted as an epigraph's last line. Matched
  in any case now. On `unmarked.fb2` 2.7.9 selects chapter 6's «Всё проходит.[1]» and «И это
  пройдёт.²»; the conversion passes the chapter.
- The cut after the last line read `[\\}\]»”“*]` - a backslash - where the definition of that line
  (`rxEndStr`, and the commented-out `endStr` the expression was written from) reads `[\)\}\]»”“*]`;
  a last line ending with `)` now ends the lines. On `unmarked.fb2` 2.7.9 selects four lines of chapter
  7 (to «Ещё короткая строка.»), the conversion two.

**Open questions** (kept as 2.7.9 behaves): `rxCopyright` (`/^©|®/` on the whole section's HTML,
without the m flag) never matches a © at the start of a line, and a ® anywhere passes the whole section
over, whereas the changelog of 1.12 speaks of lines starting with © and of ®; a section with an id
escapes `rxP` (`^<DIV class=section>`), so one holding an epigraph, an annotation, a citation or a poem
anywhere is passed over while the same section without an id is looked at (chapters 13 and 14); the
search stops at any section whose id merely looks like a note's (FictionBook Editor gave `FbAutId_`
ids to link targets).

### 08 Удалить все эпиграфы и их содержимое

Package `scripts/37_epigraphs/08_remove-all-epigraphs`, id `37/remove-all-epigraphs`, v1.0 (Sclex). The
2.7.9 file is byte for byte `19_Обработка форматирования/15_Удалить все эпиграфы и их содержимое.js`
(package `19/remove-all-epigraphs`, see `conversion-notes-279-b.md`); this package carries the same
code under the place and the id of its own group: every epigraph of the bodies goes with its content,
from the last to the first; "Удалено эпиграфов с их содержимым: N." in the status bar, or "Эпиграфов в
документе не нашлось.". Snapshots: `remove-all-epigraphs.xml` on group 19's `epigraphs.fb2` - byte for
byte group 19's `remove-all-epigraphs.xml`, as expected - and `remove-all-epigraphs.none.xml` on
`cites.fb2` (the message, the book unchanged). No difference.

### 09 Создать эпиграф из полных абзацев

Package `scripts/37_epigraphs/09_epigraph-from-paragraphs`, id `37/epigraph-from-paragraphs`, v1.2
(Sclex). The 2.7.9 file is also in group 19, disabled (`64_Создать эпиграф из полных абзацев.js_`).

**What it does.** A variant of FictionBook Editor's own Add epigraph (main.js `AddEpigraph`, with
`GetCP`, `SkipOver`, `InsBefore`): the selection is widened to the elements holding its two ends; the
element holding that range, a paragraph counting as its container and a title as the title's container
(`GetCP`), must be a body, a section or a poem - otherwise nothing happens. A new epigraph goes after
the container's title and epigraphs (in a body after its picture, title and epigraphs too). Each `P`
of the range becomes a paragraph of the epigraph with its inline content (`innerHTML`: without its id,
style or class); of two or more, the last becomes a text author when an element of it has the
paragraph's whole text (`innerText`). The `P`s then leave, from the last to the first: one that is the
last child of a section is emptied (an empty line once saved), any other is removed, and a title, an
epigraph or a citation left empty goes. The caret goes to the end of the epigraph.

**Conversion.** nav-lib's page: the paragraphs from the one holding the selection's start to the one
holding its end, their lowest common container, the original's tests; the new epigraph and the
removals are made on a copy of the container, written with one `doc.replaceNode`; the caret with
`selection.set` at the end of the epigraph's last text block. FictionBook Editor saved an empty `P` - or
one of a single text of spaces, non-breaking ones too (`FBDoc.cpp` `ProcessP`, `is_whitespace`) - as
`<empty-line/>`: such a paragraph of the epigraph, and the emptied last paragraph of a section, are
empty lines here.

**Expected (from-paragraphs.fb2) and recorded.**
- `epigraph-from-paragraphs.xml` (`--select-range n7:5-n8:3`): chapter 1 gets an epigraph of «Мысль
  изреченная есть ложь.» and the text author `<emphasis>Ф. И. Тютчев</emphasis>`; `.chain.xml`: the same,
  the caret at the end of the text author (`sc_3:12`);
- `.after-epigraph.xml` (`--select n16:3:3`): a second epigraph after the old one, its bold word kept;
- `.last-paragraph.xml` (`n21`): the chapter's only paragraph moves into the epigraph, an empty line
  stays;
- `.id-style-empty-line.xml` (`n25:0-n27:5`): the paragraph without its id and style, the empty line,
  the bold line as the text author;
- `.title.xml` (a caret in the title of chapter 5): the title's line becomes the epigraph, the empty
  title goes;
- `.poem.xml` (`n41:2-n43:4`, across the stanzas): a poem epigraph of the two verses, each stanza keeps
  its other verse;
- `.whole-poem.xml` (`n40:0-n44:3`): the poem would keep no stanza - the message, the book unchanged;
- `.in-cite.xml`, `.annotation.xml`: a citation's paragraph, the book's annotation - unchanged;
- `.inside-italics.xml` (`n55:20-n56:4`, the start inside italics): both whole paragraphs (the fix);
- `.partial-italics.xml` (`n61:0-n62:3`): «Лев <emphasis>Толстой</emphasis>» stays a paragraph;
- `.body-title.xml` (a caret in the body's title): the body gets the epigraph, its title goes;
- `.two-sections.xml` (`n10:3-n16:4`): the body gets an epigraph of four paragraphs (the last of chapter
  1, the title of chapter 2, its old epigraph's line, its first paragraph); chapter 1 keeps an empty
  line, chapter 2 loses its title and its old epigraph.

**Differences.** A stanza left without a verse, a table row without a cell and a table without a row
go, and a result still not valid FB2 changes nothing and says so (2.7.9 left them and refused to save);
an element is a run of text with one mark (two adjacent elements with the same formatting are one); the
editor scrolls the caret into view.

**Fixes (FR-023).** A selection starting or ending inside formatting took the paragraph only from or up
to that element and removed only it (or stopped with a script error): whole paragraphs now. A selected
picture gets the message the original wrote for it, which its code never reached (its control range has
no `duplicate()`).

**Open question.** The text-author test means to compare the element spanning the last paragraph with
the single element of the paragraph before it (`upTag`), but `for (pptag in pptags)` runs over the
array's indices, never equal to a tag name: the last of two or more paragraphs becomes the text author
whenever one element spans its text. Kept as 2.7.9 (and FictionBook Editor's own Add epigraph) behaves.

### Harness commands

```bash
B=tests/scripts/fixtures/279/37; G=scripts/37_epigraphs; S=tests/scripts/snapshots/37; CR=tests/scripts/fixtures/279/19/chain-runner
R='37_Эпиграфы\05_Поиск неразмеченных эпиграфов.js'
node tests/scripts/run-script.mjs $CR $B/unmarked.fb2 --answer "$R|$R|$R|$R|$R|$R|$R|$R" --snapshot $S/find-unmarked-epigraphs.chain.xml
node tests/scripts/run-script.mjs $G/09_epigraph-from-paragraphs $B/from-paragraphs.fb2 --select-range n10:3-n16:4 --snapshot $S/epigraph-from-paragraphs.two-sections.xml
tests/scripts/run-all.sh --group 37        # 19 snapshots
```

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

3 scripts in 2.7.9: the successors of 01 *Показать код* and 02 *Показать весь код* (packages
`20/show-code`, `20/show-whole-code` of 2.7beta1's *Инструменты отладки*, left for their recheck) and
03 *Код в буфер*, which the conversion of 2.7beta1 dropped for want of the clipboard. 03 is re-examined
here under FR-024 with script API version 2 (part of T069) and converted.

### 03 Код в буфер

Package `scripts/95_programmers/03_code-to-clipboard`, id `95/code-to-clipboard`; no version in the
file (`legacy.sourceVersion` left out), no icon, and no notice of its own (FR-029: nothing to keep;
`check-notices.py --package`: OK). `name` and `description` in ru, en and uk, `needsSelection: false`,
`undoLabel` the name. The 2.7.9 file is 2.7beta1's `20_Инструменты отладки/03_Код в буфер.js`
unchanged.

**What it does.** The original copied the HTML of the editor's whole page
(`document.documentElement.outerHTML`) to the clipboard (`window.clipboardData.setData`): a debugging
aid for writing scripts against the editor's internal representation.

**Conversion.** Scripts now see the book as the JSON document model, as 01 and 02 show one element of
it, so that is what is copied, with `mfbe.clipboard.writeText`: the whole book as `mfbe.doc.get()` gives
it - the description, the bodies with their node ids, the binaries' metadata - indented by two spaces,
without the open file's path. A book whose snapshot is over the API's 64 MB is not copied; a message
gives the API's reason. `run()` returns nothing.

**Reference book** `tests/scripts/fixtures/279/95/code.fb2` (valid FB2: a section with italics and a
note link, a notes body). **Expected:** the book unchanged, the clipboard holding
`JSON.stringify(doc.get() without path, null, 2)`. **Snapshot** `tests/scripts/snapshots/95/
code-to-clipboard.xml` (listed in `tests/scripts/snapshots/95/suite.json`) with
`code-to-clipboard.outputs.json`: the JSON of the book - `binaries`, `bodies` (the main body and the
`notes` body, node ids `n1`...), `description`, `docId`, `extras`, `fileKind`, `modelVersion`,
`schemaHint`, `sourceEncoding`, `stylesheets`; no `path`. Gate: `tests/scripts/run-all.sh --group 95`
(3 snapshots with those of 01 and 02).

**Differences.** The document model's JSON instead of the page's HTML (the editor's page is not open to
scripts); the open file's path is left out (the file's place on the disk, not the book's code - and a
clipboard text that would differ from one copy of the files to the next); a book over the snapshot
limit is not copied, with a message.

Recheck of the two packages converted from 2.7beta1's *20_Инструменты отладки* (task T087, part;
their 2.7beta1 conversion is in conversion-notes-c.md, group 20, and the group folder became
`scripts/95_programmers` with 2.7.9's group): `01_show-code` and `02_show-whole-code`. Outcomes: 01
**unchanged**, 02 **updated**; ids `20/show-code` and `20/show-whole-code` unchanged (hotkeys, the
Scripts toolbar and Last script name them by id). Both gained `name.uk` and `description.uk`; the
names are 2.7.9's, the same as 2.7beta1's; the icons are 2.7.9's, the same images. 03 *Код в буфер*
is this feature's conversion (see the group's notes).

Both scripts show the code of the element holding the caret - the nearest container of its text
block: a section, a title, a stanza, a cite, the annotation… They now look that element up in the
whole book (`doc.get()`), the annotation and the history included, which the Body view shows before
the bodies as FictionBook Editor's page did. The conversion of 2.7beta1 asked `doc.getNode`, which
knows the bodies only, so with the caret in the annotation or the history both stopped with *Script
error: node: unknown nodeId*; 2.7.9 shows the annotation's or the history's HTML. Recorded as a fix
for each (a defect of the conversion; the result is now 2.7.9's).

### 01 Показать код

`01_show-code`, id `20/show-code`: **unchanged** (2.7.9's file is 2.7beta1's, byte for byte), so it
keeps `legacy.source` "20_Инструменты отладки/01_Показать код.js" and `fbeVersion` "2.7". uk
*Показати код*. The code changed only by the fix above; `index.js` now also quotes the original's
header (*Displays HTML code for the current section (only for script debugging)*). Snapshot
`show-code.xml` stays. Added `show-code.history.xml` (`tests/scripts/fixtures/279/95/
annotation.fb2`, a valid book with an annotation «Аннотация с курсивом.» and a history «История
версий.»; `--select n7:3:3`, in the history): expected and recorded - the book unchanged, a message
box with the JSON of the history (`n6`), no error. Differences (kept from 0.0.1): the document
model's JSON instead of the page's HTML (scripts see the model, not the editor's page); code over
2000 characters is cut, with a line pointing to *Показать весь код*.

### 02 Показать весь код

`02_show-whole-code`, id `20/show-whole-code`: **updated** (no header version, so no
`sourceVersion`). 2.7.9 changed the comment of its header (*Отображение HTML кода текущего раздела*,
where 2.7beta1 said *секции*) and its window: it opens `HTML/Показать весь код.html` - 2.7beta1's
`Scripts/debug.htm` moved, the same page by Jurgen - and spells the feature `resizable=yes`, which
2.7beta1 misspelt (`resizeble`), so the window can now be resized. Ported: the original's
`window.open` is now `mfbe.ui.report({ title, text })` (the mapping of feature 007 for a window the
original opened from `HTML/…`): a report window that can be resized and stays open after the run,
like the original's window, where the conversion of 2.7beta1 used a modal form with a text box.
`index.js` keeps 2.7.9's notice (*Отображение HTML кода текущего раздела (only for script
debugging)*, *THX to mkb (Konstantin Matveev) for ingenious idea*) and the page's author line;
`check-notices.py --package`: OK. Description now *…в окне отчета…*; uk *Показати весь код*.

Snapshots: `show-whole-code.xml` (`conv-c-16.fb2`, `--select n26`) stays - the book is unchanged -
and gained `show-whole-code.outputs.json`, the report the run opens: title *Code of the "cite"
element (1102 characters)* (the harness runs the English interface; Russian *Код элемента «cite»
(1102 символов)*) and the JSON of the cite holding `n26`, as 2.7.9 showed that cite's HTML. Added
`show-whole-code.annotation.xml` with its `outputs.json` (`annotation.fb2`, `--select n5:3:3`): the
report of the annotation (`n4`). Differences: the document model's JSON instead of the page's HTML
(kept from 0.0.1); the window is titled with the element and the length of its code, where 2.7.9's
was titled * :: Debugging HTML code :: *, and offers Copy and Save as… besides Close.

### Harness commands

```bash
G=scripts/95_programmers; B=tests/scripts/fixtures/279/95/annotation.fb2; S=tests/scripts/snapshots/95
node tests/scripts/run-script.mjs $G/01_show-code $B --select n7:3:3 --snapshot $S/show-code.history.xml
node tests/scripts/run-script.mjs $G/02_show-whole-code $B --select n5:3:3 --snapshot $S/show-whole-code.annotation.xml
```

## 99_Прочее

2 scripts in 2.7.9, both new and both by Александр Ка (part of T068): 09 is converted into the new
group `scripts/99_misc/` (*Прочее*); 10, a game drawn on the editor's own page, is not converted.

### 09 Цитатный фразотрон

Package `scripts/99_misc/09_quote-phrasetron`, id `99/quote-phrasetron`, v1.4 (Александр Ка,
29.04.2025); `name` and `description` in ru, en and uk, `needsSelection: false`, the 2.7.9 icon,
`undoLabel` the name, the skeleton's notice lines verbatim (`check-notices.py --package`: OK).

**What it does.** Every `P` of the bodies other than `notes` and `comments` (the book's annotation and
history are not bodies), in document order, with its `innerText`: a title's line, a subtitle and a text
author (a date too) are skipped; a verse stands for its whole stanza - the stanza's text with its line
breaks as " /&/  " - and the following lines of the stanza are jumped over by the number of the
stanza's children. A text with a keyword (`reTrueS`: the keyword followed by punctuation, a quotation
mark, a dash or a space) gives every match of `reTrue` - a sentence around a keyword: from the start or
after `….?!)]` and spaces, an optional dash, an optional stretch of up to 180 characters from a
capital, the keyword, up to 230 characters, to `…`, `.`, `?`, `!` or the end - longer than 15
characters, at most `Max_tsitat` (100). The keywords (`W`, regular expressions): Родина, смысл жизни,
Путин, путинский, разум, отчизна, мудрость, истина. Each quotation is trimmed of punctuation and spaces
at its ends, its spaces doubled, broken into lines of about 47 characters (`reZit`, `reZitAlt` once
the first fails; " /&/  " ends a line), headed by "◊ ◊ ◊" ("◊ ◊ ◊ ◊ ◊" when it names Путин) and
followed by an empty line; with `Podcherkivat_slova` the keywords get combining low lines (U+0332).
The window: " «Цитатный фразотрон» v.1.4", a rule, "• Найдено N цитат:" and the quotations, or
">>  Цитаты не найдены". With `SaveTsitat` and Yes to "Сохранить текст цитат в буфер обмена?" the
quotations - a heading, each one on its own, its stanza lines on lines of their own - and "(из книги:
<authors>.  «<title>»)" go to the clipboard; the authors are the first, middle and last names of
`<title-info>` (a nickname alone gives none).

**Conversion.** `lib/phrasetron.js` is the original's code in its order, with its own variable names
and comments: the `P`s are the text blocks and empty lines of the bodies (`mfbe.doc.get()`), a stanza's
children its title, subtitle and verses; the expressions are the original's strings, compiled with
group 06's `lib/jscript-regexp.js` (copied unchanged, md5 `e8fa308f…`) for JScript's `\s` (no
U+00A0); `GetNBSP()` gave U+00A0, which the original turned into the text "&nbsp;", so the
expressions' "|&nbsp;" alternatives look for that text, as they did; the window is one
`mfbe.ui.message`, the question a Yes/No message, the clipboard `mfbe.clipboard.writeText`. The
settings stay in `index.js` as the original's section НАСТРОЙКИ (with English glosses); another script
may pass settings of its own in the args of `mfbe.scripts.run`, and `run()` returns the window's text.

**Reference book** `tests/scripts/fixtures/279/99/phrases.fb2` (valid FB2): three authors (one a
nickname only), a quoted keyword in the book's annotation (not a body), the body's title, keywords in
paragraphs, a fragment of 7 characters, a quotation naming Путин, a subtitle, a citation, a stanza of
two verses and the poem's text author, a table cell, a long paragraph, an epigraph with its text author,
"путинской" in chapter 2 and a keyword in the notes body. **Expected:** the original's own code,
taken verbatim from the 2.7.9 file, was run (scratch, not shipped) on a stand-in of its page built from
this book, with JScript's `\s`: 9 quotations - the paragraphs on мудрость and Отчизна, Путин (five
diamonds), the citation on смысл жизни, the stanza (its two lines), the cell on разумное решение, the
whole long paragraph (истина), the epigraph on разум, the paragraph on путинской эпохи (five diamonds);
not «Истина.» (7 characters), the titles, the subtitle, the text authors, the annotation or the note.
**Snapshots** (`tests/scripts/snapshots/99/`, 6, in its `suite.json`; the book never changes): a run of
the package; four runs through the test package `tests/scripts/fixtures/279/99/99_tests/run-with-args`
(never bundled: it runs a script with the args its prompt gives and reports what `run()` returned,
recorded in `<snapshot>.outputs.json`) - `.window` (the window's text), `.clipboard` (SaveTsitat, Yes:
the clipboard too), `.clipboard-no` (SaveTsitat, No), `.underline` (Podcherkivat_slova, Max_tsitat 3:
"Найдены 3 цитаты", the keywords underlined); `.none` (`tests/scripts/fixtures/279/14/cites.fb2`, no
keyword: ">>  No quotes found", no question). Each window and clipboard text equals the original's on
the same book, apart from the window's own lines, which the harness's English interface shows in
English.

**Differences.** One message box, which scrolls: the original's pages ("Показать следующую
страницу?", "Закрыть окно?") and its setting for the window's height (Vysota_teksta) are gone; in the
English interface the window's own lines are in English; the authors and the title come from the
document's description (the original read the Description form's fields); `run()` returns the window's
text and takes settings from the args of another script; a quotation the line-breaking expression could
not take apart (a line break in it, which a paragraph's text does not hold) ends there instead of never.

**Open questions.** The keywords and the five-diamond heading for a quotation naming Путин are the
original's settings, kept as written: should the bundled script keep them? A stanza is searched at its
first line and the jump that follows counts its children: with a title or a subtitle it also passes the
paragraph after the stanza, and a stanza that starts with its subtitle is not searched; kept as 2.7.9
behaves.

### Not converted: 10 Быки и коровы (игра)

v2.1 (Александр Ка, 30.04.2025). Names: ru "Быки и коровы (игра)", en "Bulls and Cows (a game)", uk
"Бики та корови (гра)". The computer thinks of a number of distinct digits, the player guesses it in
InputBox prompts, each guess answered with "bulls" (right digit, right place) and "cows" (right digit,
wrong place); a "История" mode leads through a story of episodes, prizes open a digit.

**Reason (FR-024: the editor's own page).** The game draws itself into the editor's page: it inserts a
styled DIV of class body before the Description form, holding the game's title, its rules, the story
of the "История" mode, the record of the moves and a scoreboard of coloured FONT elements it rewrites
after every move; it measures the window (`getViewHeight`, `getBoundingClientRect`), scrolls it, drops
old records when they no longer fit, and removes the DIV at the end. Only the moves are typed into
prompts. **Needs:** a window a script can show and update while it waits in its prompts (a report
window whose content a later call replaces, or a form field of formatted, coloured text) - or a
redesign of the game around message boxes and prompts alone. The match results also showed a random
saying from its list "Пословицы и поговорки Великой Отечественной войны" (`Kn`), whose last lines are
about Kursk and Sudzha: nothing of the script, the list included, is copied.

### Harness commands

```bash
B=tests/scripts/fixtures/279/99; S=tests/scripts/snapshots/99; T=$B/99_tests/run-with-args
node tests/scripts/run-script.mjs scripts/99_misc/09_quote-phrasetron $B/phrases.fb2 --snapshot $S/quote-phrasetron.xml
node tests/scripts/run-script.mjs $T $B/phrases.fb2 --answer '{"ref": "99_Прочее\\09_Цитатный фразотрон.js", "args": {"SaveTsitat": 1}}' --answer ok --answer yes --snapshot $S/quote-phrasetron.clipboard.xml
tests/scripts/run-all.sh --group 99        # 6 snapshots
```

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

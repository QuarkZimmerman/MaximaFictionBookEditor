# FictionBook Editor 2.7.9 scripts — groups 01 to 09 (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## 01_Регистр

6 scripts in 2.7.9, the successors of 6 of the 8 packages converted from 2.7beta1 (task T073,
recheck of `scripts/01_case/`; the 2.7beta1 conversion is in conversion-notes-a.md, group 01).
Outcomes: 1 updated (08), 5 unchanged (01, 02, 04 *Первую букву…*, 05, 07), 2 without a 2.7.9
counterpart and kept as converted (03 *Предложение_alxs*, 04 *Предложение*; FR-027). Every
package gained `name.uk` and `description.uk`; the ids are unchanged. The unchanged and kept
packages keep their 2.7beta1 `legacy.source` and `fbeVersion` "2.7" and their snapshots.
Reference book: the existing `tests/scripts/fixtures/books/conv-a-01.fb2`; the new snapshot is in
`tests/scripts/snapshots/01/` and its `suite.json`. Its expected result was written from the
2.7.9 original before the run, and the snapshot equals it.

How 2.7.9 regrouped the case scripts: it dropped 2.7beta1's *03_Предложение_alxs* (only its icon
is left in the folder) and *04_Предложение*, and renamed *06_Капитализация первого слова* -
Sclex's v1.3, byte for byte the same code - to *04_Первую букву - в верхний регистр, остальные - в
нижний*, in the place and with the icon of *Предложение*. Following that rename and move
(FR-021), the package of 06 is its successor: unchanged, renamed, and moved from
`scripts/01_case/06_capitalize-first-word` to `scripts/01_case/04_capitalize-first-word` with its
id `01/capitalize-first-word`, so hotkeys, toolbar buttons and the Last script command keep
finding it (FR-028). The menu sorts by the number, then by the name, so it comes before
`04_sentence-case` and the 2.7.9 scripts keep 2.7.9's order (FR-026). *Предложение* keeps its
code, name, folder and default hotkey. (The first pairing review had put *Предложение* with
2.7.9's 04 by its place; the recheck found the identical code, and the pairing follows it.)

The originals 01, 02, 04 *Первую букву…*, 05 and 07 also handled a selection inside a text field
of FictionBook Editor's description page (a TEXTAREA branch); scripts here work on the Body
view's selection, the only one the script API gives - a difference recorded for each of them.

### 01 В верхний регистр

`scripts/01_case/01_upper-case`, id `01/upper-case`: **unchanged** (2.7.9's code is 2.7beta1's
*01_Верхний регистр*). Renamed as in 2.7.9: ru *В верхний регистр*, en *To upper case*, uk *У
верхній регістр*; the undo label follows. Snapshot `upper-case.xml` stays.

### 02 В нижний регистр

`scripts/01_case/02_lower-case`, id `01/lower-case`: **unchanged** (2.7beta1's *02_Нижний
регистр*). Renamed: ru *В нижний регистр*, en *To lower case*, uk *У нижній регістр*. Snapshot
`lower-case.xml` stays.

### 03 Предложение_alxs

`scripts/01_case/03_sentence-case-simple`, id `01/sentence-case-simple`: **no 2.7.9
counterpart**, kept as converted (FR-027). Gained uk *Речення_alxs* (the name keeps its author's
tag, as the Russian one does). Snapshot `sentence-case-simple.xml` stays.

### 04 Первую букву - в верхний регистр, остальные - в нижний

`scripts/01_case/04_capitalize-first-word` (moved from `06_capitalize-first-word`), id
`01/capitalize-first-word`: **unchanged** - 2.7beta1's *06_Капитализация первого слова*, renamed
and moved to place 04 by 2.7.9 with the same code. The code is not touched (the index gained a
comment on the rename); the first word of the selection, or the word under the caret, gets a
capital first letter and every other letter of the selection becomes lower case, across inline
formatting and paragraphs. Names as in 2.7.9: ru and undo label *Первую букву - в верхний
регистр, остальные - в нижний*, en *First letter to upper case, the rest to lower case*, uk
*Першу літеру - у верхній регістр, решту - у нижній*. 2.7.9 gave the script an icon (2.7beta1's
06 had none; it is *Предложение*'s image), so the package gained `icon.png`. Snapshot
`capitalize-first-word.xml` stays; its entry in `tests/scripts/snapshots/suite.json` names the
new folder.

### 04 Предложение

`scripts/01_case/04_sentence-case`, id `01/sentence-case`: **no 2.7.9 counterpart**, kept as
converted (FR-027): every run of equally formatted text in the selection gets a capital first
letter, with the default hotkey Ctrl+Shift+P of the original's `SetHotkey()`. Gained uk
*Речення*. Snapshot `sentence-case.xml` stays.

### 05 Капитализация выделения

`scripts/01_case/05_capitalize-words`, id `01/capitalize-words`: **unchanged** (the same file in
both). Gained uk *Капіталізація виділення*. Snapshot `capitalize-words.xml` stays.

### 07 Циклическое изменение регистра

`scripts/01_case/07_cycle-case`, id `01/cycle-case`: **unchanged** (the same file, v1.4). Gained
uk *Циклічна зміна регістру*. Snapshot `cycle-case.xml` stays. Difference kept from 0.0.1: the
original stops analysing the selection at the first text run holding an upper-case letter (`if
(bigLetterFlag && bigLetterFlag)`, a typo for a second flag), the conversion analyses the whole
selection; 2.7.9 kept the code, so the difference remains (it shows only when that run is
followed by lower-case runs). Also the description-page text field.

### 08 Регистр заголовков и подзаголовков...

`scripts/01_case/08_titles-case`, id `01/titles-case`: **updated** (the same file name; no header
version, so no `sourceVersion`). The script only opens its dialog, now *HTML/Регистр заголовков и
подзаголовков - набор фреймов.html*, version 1.9 instead of 1.6. 2.7.9 changed in it: the
version in the title, OK with nothing listed (1.6 took its "Пусто." / "Ничего не найдено."
message for the list and failed with a script error; 1.9 just closes the dialog), and the
stylesheet (font sizes, frame height). Ported: the forms' title reads *Регистр заголовков и
подзаголовков v1.9 (скрипт Sclex’а)*; the conversion already ended with *Ничего не найдено.* and
no change when nothing is listed. Gained uk *Регістр заголовків і підзаголовків...*.

Snapshots: `titles-case.xml` stays (a title is not part of the result). Added
`titles-case.nothing-found.xml` (`--answer '{"bodySectionTitles":false,"sectionSubtitles":false}'`:
nothing is listed, the message is shown, the book is unchanged), the case 1.9 fixed.

Differences (from the 0.0.1 conversion, still true against 2.7.9): Tier 3 - the dialog's editing
of single characters (clicking or dragging over the letters of a listed title, the context menu
*Большие буквы* / *Маленькие буквы*) cannot be expressed by a form; the first form asks the
dialog's five filters, the second lists the title paragraphs and subtitles found (all ticked)
with the operation upper case, lower case, sentence case or Capitalised Words. Every title
paragraph of a body or section is listed, where the original listed a title only when it was the
first child of its parent.

### Harness commands

```bash
G=scripts/01_case; B=tests/scripts/fixtures/books/conv-a-01.fb2; S=tests/scripts/snapshots/01
node tests/scripts/run-script.mjs $G/08_titles-case $B --answer '{"bodySectionTitles":false,"sectionSubtitles":false}' --snapshot $S/titles-case.nothing-found.xml
```

## 02_Примечания

19 scripts in 2.7.9: 10 new, all converted here (T047); the successors of the nine packages
converted from 2.7beta1 (`01_add-footnote` … `08_unify-footnotes-remove-unused`,
`20_test-footnotes`, with `notes-engine.js`) are left for their recheck. Packages:
`scripts/02_footnotes/<NN>_<slug>/` with the 2.7.9 number, ids `02/<slug>`, `legacy.source` the
2.7.9 path (`sourceVersion` from the header: 31 and 32 "1.2", 35 "1.0"; the others state none),
`name` and `description` in ru, en and uk, the 2.7.9 icon (38 has none), `undoLabel` the name,
`needsSelection` true for 12 only. In `index.js` the skeleton's notice lines verbatim
(`check-notices.py --package`: OK for all ten); the dialogs keep their credit in their title
("… v4.5. Автор Sclex."). Reference books `tests/scripts/fixtures/279/02/`, snapshots
`tests/scripts/snapshots/02/` (33, listed in its `suite.json`); every book validates against
`FictionBook.xsd`. The harness runs the English interface: the messages quoted below are the
Russian originals, the logs show their English texts.

### The common ground

**The page.** The note scripts walked FictionBook Editor's `fbw_body`: the book annotation and the
history first (DIVs `annotation`, `history`), then every body; a text block was a `P` (an empty
line an empty `P`, a subtitle `P.subtitle`, a text author and a poem's date `P.text-author`, a
table cell `P.td`/`P.th`), a link an `A` of `document.links`. `lib/notes-book.js` (byte-identical
in 09, 12, 15, 17, 19, 24, 38 and in 03/20, 03/38) gives that page from the document model: a
working copy of the description and the bodies that a script changes in memory, the text blocks
and the links (`linkGroups`: consecutive items under one link mark with the same marks outside
it - one `A`) in page order, FictionBook Editor's `getLocalHref`, the renumbering the note
scripts end with (`renumber`: the sections of a body get the ids `prefix`N and the titles N,
every link of the page whose address was a section's id gets the new address and, where the
script set `innerHTML`, the text [N] or a superscript {N} inside the marks around the link) and
`commit` - `doc.replaceNode` per changed body (its untouched nodes keep their ids),
`doc.insertNode('after', …)` for a body the script made, `doc.setDescription` for the annotation
and the history. The run is one undo step; a script that asks a question after changing the book
commits first, so the user sees the change behind the question, as in 2.7.9.

**Nesting of a new link.** The editor keeps a link outside the formatting of the same characters
when it writes FB2: a note link made inside an emphasis comes out as `<emphasis>…</emphasis><a
…><emphasis>[4]</emphasis></a>` where 2.7.9 wrote `<emphasis>…<a …>[4]</a></emphasis>`. The text
and its formatting are the same; the records list it as a difference.

**The IE HTML.** 09 and 35 run the originals' expressions on a paragraph's HTML. `lib/ie-html.js`
(byte-identical in both) writes a block in the notation of `lib/legacy-html.js` (`<EM>`,
`<STRONG>`, `<SUP>`, `<A class=note href="#n_1">`, `&nbsp;`, …) but nests the marks in the order
the model lists them - the order the book was read in, as they nested in the original's page,
where `legacy-html.js` sorts them with the link outermost - and maps every HTML position back to a
block offset. 09 reads its result back with `legacy-html.js`'s `parseInline` (copied unchanged
from General clean-up) and writes a mark's language as that module does; 35 only searches and
writes none, as Internet Explorer had none.

### 09 Перенумеровать примечания (расширенная версия)

`09_renumber-footnotes-extended`, id `02/renumber-footnotes-extended`. The original runs two
scripts in one undo step and then says «Скрипт «Перенумеровать примечания (расширенная версия)»
v.1.0 GE»:
- Run1, "Унификация сносок (объединенная)", the renumbering of 07 in its older form: the notes
  body gets the title «Примечания» when its first section/epigraph/title is no title, its sections
  the ids n_1, n_2… and the titles 1, 2… (a section without a title gets one), and every link of
  the page that points to one of them - the annotation and the history included, whatever its
  type - the address #n_N and the text [N]. Unlike 07 of 2.7.9 it adds no `type="note"` and shows
  no message of its own; with sections nested in the notes body it stops with «В body примечаний
  есть секции второго уровня вложения…».
- Run2, GE's "Уборка сносок": seven expressions over the `innerHTML` of every paragraph of the
  bodies (not the annotation, not the history - `ObrabotkaAnnotation`/`ObrabotkaHistory` false)
  around the links of class `note`: a closing `</EM>`/`</STRONG>` after the link goes before it,
  an opening one before it (after at most two dots or spaces) goes after it, a space or `&nbsp;`
  before the link goes, punctuation after it (`.,;` or `!?:…`, a closing tag and the spaces
  around it) goes before it, a `…` at the paragraph's end goes before it, a space comes after it
  before a letter, a dash, `(` or `[`.

Converted with `notes-book.js` (`renumber` on the working copy, then `commit`) and the
expressions run verbatim on `ie-html.js`'s HTML of each paragraph that holds a note link
(`\s` written out as JScript's `[ \f\n\r\t\v]`), read back with `parseInline`.

Books and snapshots: `renumber.fb2` (`renumber-footnotes-extended.xml`): an annotation with a note
link, ten paragraphs each exercising an expression, a comment link and an internal link left
alone, a notes body without a title whose sections are `n_3`, `old` (no title) and `n_1`.
Expected and recorded: the body titled «Примечания», the sections n_1 «Первое по порядку.», n_2
(titled 2) and n_3; the links #n_3 → [1], #old → [2], #n_1 → [3], the annotation's too
(«Аннотация [2] .» keeps its spaces - Run2 does not clean the annotation); "Первый[1] абзац,
слово[1] с пробелом." (the space before the second link goes, the one after comes back),
"<emphasis>Курсив</emphasis>[2] после.", "Точка.[3]", "Многоточие…[3]", "Запятая,[2] дальше.",
"Буква[1] дальше.", "<strong>Жирный</strong>[2] текст.", "Неразрывный пробел[3] и комментарий {1}
." (the `&nbsp;` before the link goes, the comment link and its space stay), "Ссылка на главу
глава ." unchanged. `renumber-no-notes.fb2` (`.no-notes.xml`): no notes body - nothing
renumbered, Run2 makes "Сноска без раздела.[1]". `renumber-nested.fb2` (`.nested.xml`): the
message, the book unchanged.

Differences: no notes body is made when there is none (2.7.9 made one holding only a title, which
FB2 does not allow); formatting with a language keeps its tags where they are (the expressions
match bare tags; FictionBook Editor dropped `xml:lang` of formatting when reading); the nesting
of a renumbered link inside formatting (above). Fix: with nested sections the script stops after
its message with nothing changed; 2.7.9 had already titled the body and then stopped with a
script error (it removed a link this script never inserts), so the clean-up and the final message
never came.

### The engine of 12, 15, 17, 19 and 24: `lib/paragraph-notes.js`

Sclex's "Создать сноски или комментарии из … абзацев" scripts open a modeless HTML dialog
(`HTML/Создать сноски … - задание параметров.htm`); the `.js` only passes the version. The dialog
does the work over the page, in passes:
1. the note texts: the selected paragraphs (12) or the paragraphs starting with the "first
   paragraph" marker (15-24); each starts a note text, one starting with the continuation marker
   («++», plain text, the dialog's field) continues the one before, its marker and the spaces
   around it removed; a poem, cite, table or epigraph is taken whole (its paragraphs stripped
   alike); a paragraph becomes a `<P>` of the note (a subtitle stays a subtitle; one with nothing
   but spaces an empty line, as FictionBook Editor saved it), losing its id and style;
2. the signs: the matches of the sign marker outside links - 12: in the text before the
   selection's first paragraph; 15-24: in every paragraph that is no asterisk line («* * *») and
   does not start with the first paragraph marker, not at the very start of a paragraph
   («совпадение должно быть не от начала абзаца»);
3. both numbers differ: «Найдены 2 маркера знака сноски. / Найден 1 текст сноски. / Поскольку эти
   числа не совпадают, добавление сносок не будет произведено.»; they agree: «… Ура! Эти числа
   совпали. А значит, сноски можно создать. Создать сноски?» (OK/Cancel). Then every sign, in
   order, becomes a link (class `note` with "[N]" for footnotes, a superscript "{N}" without type
   for comments) that takes the formatting of the sign's first character without superscript
   (`unsupReferences`), the spaces before the sign removed (`removeSpacesBeyondTags`, pictures in
   between kept); its section, titled 0 and holding the next note text, goes after the section of
   the note link before it (`findPreviousNote`: a link of class `note`, for footnotes, or one
   pointing into the target body), else at the start of the target body (titled «Примечания» /
   «Комментарии» first when it has no title), else into a new body at the end of the book; at the
   end the target body is renumbered (`renumberNotes`) and the status bar says «Было добавлено 5
   текстов сносок.»;
4. 15-24 ask «Удалить ли абзацы-исходники текстов сносок?» and remove the source paragraphs and
   containers with the empty lines right before and after each (`removeSourceNodes`).

The modeless dialog is a loop of forms: its action buttons are a radio choice («Создать сноски»,
«Создать комментарии», «Предпросмотр…»; «… и выйти» and «Выйти» are OK and Cancel), and the form
comes back where the dialog stayed open - after a preview (a report window: the note texts under
the original's heading and «Количество: N»), a count that does not agree, a declined
confirmation, an error - with the values entered. Creating the notes ends the run. The passes
work on the working copy: the texts and signs are taken from the book as it was, the links are
put in from the last sign of a paragraph to the first, the sections inserted, the body
renumbered, then committed; the removal of the sources (and its commit) follows the second
question. A sign that is a "number in superscript" is matched as the originals did: the paragraph
as text with only its first-level `<SUP>` tags (`leaveOnlyFirstLevelSups`) against their two
expressions (the count used `upperNumberRegExp` with every link's content replaced by "x", the
search the dialog's own one); the matches map back to the characters.

Differences of the five (each record lists its own): the form loop; the preview's report window;
a poem's date is not searched for signs (FB2 allows no link in it); an epigraph taken into a note
where it cannot open the section becomes a cite, and a new section with no note link before it
goes before the body's first section, after its title and epigraphs (2.7.9: right after the
title); a section emptied by the removal keeps an empty line (15-24), an annotation or history
emptied by it goes (2.7.9 saved none, as with group 19); the nesting of a new link (above).
Fixes: a note link before a sign that points to no section of the target body stops the creation
with the original's message before anything changes (2.7.9 showed it and went on, leaving the
sign replaced by a link with the placeholder text «Œ±Ǥ» and its note text unused, or put the new
section next to whatever the link pointed to); 15-24 do not take note texts from the notes and
comments bodies (the walk meant to skip them but tested the element's first child) and do not
search the sections they made for signs (2.7.9 did, so a note text holding the sign character got
a section of its own with the text «undefined»); in 15-24 an «&» before a sign no longer shifts it
(the dialogs' `unmakeEntities` left «&amp;» five characters long, so the link went four characters
past the sign and a character there was deleted); in 12 and 24 a superscript sign mixing Unicode
digits and `<sup>` loses its own characters only, and an empty match finds nothing (2.7.9 looped
for ever). Open question (15-24, kept): a «++» paragraph continues the note text before it
wherever it stands (`previosPWasPartOfNote` is never set false).

### 12 Создать сноски или комментарии из выделенных абзацев

`12_notes-from-selected-paragraphs`, id `02/notes-from-selected-paragraphs`, v4.2. The note texts
are the selection's paragraphs (the one the selection starts in whole, the one it ends at the very
start of left out; a selection starting inside a poem, cite, table or epigraph takes that
container); signs as chosen: «вида [1]», «{1}», «[~1~]», «{~1~}», «* (одна звездочка)», «число
надстрочным текстом» (the default) or «задать свой» (a regular expression with the flags gm, or
plain text); continuation «++». The selected paragraphs stay (2.7.9 left them to the user) and
the selection is put back. Form fields: `noteSign`, `refMarkerStr`, `interpretAsRegExp`,
`notFirstParagraphStr`, `action`.

Books and snapshots: `selected.fb2`, selection `n9:3`-`n17:0` - `notes-from-selected-paragraphs.xml`
(`{"noteSign":"1","action":"notes"}`, ok): notes 1 «Текст первой сноски.» + «Продолжение
первой.», 2 «Текст второй сноски.», 3 the poem + «после стиха.», 4 the subtitle «Подзаголовок
четвертой» («После выделения.» is not taken); signs [1], [2], [4] (in strong), [5] - «ссылка[3]»
is inside a link; links "сноска[1]", "сноска[2]" (the space before it gone), "сноска[3]" (strong),
"четвертая[4]"; `.comments.xml` the same as comments ({N}, a comments body); `.preview.xml` the
report of the four texts. `markers.fb2`, selection `n12:0`-`n15:14` - `.superscript.xml`
(defaults): signs `<sup>1</sup>`, «²», `<sup>12</sup>` (the linked `<sup>3</sup>` is no sign); the
four selected paragraphs are the texts as they are, «¹»/«²»/«³» included (12 removes no first
paragraph marker - it has none); links [1] [2] [3] without the superscript. All as expected.

Further differences: «задать свой» is a choice of its own (the dialog chose it when its field got
the focus); without a selection the message («Пожалуйста вначале выделите абзацы…») ends the run
(the menu item needs a selection; a modal form cannot wait for one); a custom marker that does not
compile gets the message of 15-24 and the form comes back (2.7.9: a script error); a pattern typed
into the dialog is a JavaScript regular expression (JScript's `\s` did not match U+00A0). Further
fix: the walk over the selection goes on after a container that ends its section (2.7.9 stopped
there and lost the rest), stops after the container holding the selection's end (2.7.9 took the
paragraphs after the selection up to the end of the book or the next container ending a section)
and no longer fails on a selection starting inside such a container (a script error in 2.7.9).

### 15 Создать сноски или комментарии из абзацев, помеченных звездочками

`15_notes-from-asterisk-paragraphs`, id `02/notes-from-asterisk-paragraphs`, v4.5. The dialog's
visible part: the two help texts (static fields), the continuation marker and the buttons; its
hidden settings are fixed: signs `\*+`, first paragraph marker `^[ \u00A0*]*\*[ \u00A0*]*` (the
original's two spellings, one with a typo «#\*», match the same), not at the paragraph's start.
Only this one of the four leaves a container whose first paragraph is an asterisk line alone.

Books and snapshots: `asterisks.fb2` - `notes-from-asterisk-paragraphs.xml` (`{"action":"notes"}`,
ok, ok): signs in the annotation «звездочкой*», «сноской*», «сноска **», «звездочкой*» (in an
emphasis), «цитату***»; not signs «* * *», «ссылка*» (in a link), the cite starting with «* * *»
(left alone), the sources; texts «Примечание к аннотации.», «Первое примечание.» + «Его второй
абзац.», «Второе примечание с <strong>жирным</strong> словом.» + the poem (its first verse without
«++ », the second without «*»), «Третье примечание.» (after spaces), the cite «Четвертое
примечание в цитате.» with its text author; a notes body after the main body, n_1…n_5, links in
sign order, «сноска[3] и» without the space; the five sources go with the four empty lines, the
section keeps its title and an empty line. `.comments.xml` (comments, keep the sources), `.preview.xml`,
`.mismatch.xml` (`mismatch.fb2`: two signs, one text - the message, the form, cancel),
`.broken-link.xml` (`broken-link.fb2`: the note link [9] to «#nowhere» before the sign - «Ошибка!
Ссылка в документе указывает на элемент, которого не существует.», unchanged),
`.annotation-source.xml` (`annotation-source.fb2`: the annotation's only paragraph is the text of
the one note; removed, the annotation goes). All as expected.

### 17 Создать сноски или комментарии из абзацев, помеченных знаками решетки

`17_notes-from-hash-paragraphs`, id `02/notes-from-hash-paragraphs`, v4.4: as 15 with «#» (signs
`#+`, first paragraph marker `^[ \u00A0#]*#[ \u00A0#]*`); a line of asterisks is skipped, as the
original's check (written for asterisks) did, but a line «# # #» is a note text.

Books and snapshots: `hashes.fb2` (a notes body with n_1, n_2 and links to them) -
`notes-from-hash-paragraphs.xml` (notes, ok, keep the sources): signs A «Начало#», B «новая##»
(after the link [1]), C «новая # сноска» (after an untyped link to n_2); A goes before n_1, B after
n_1, C after n_2 → n_1 A, n_2 old 1, n_3 B, n_4 old 2, n_5 C; the old [1] becomes [2], both links to
the old n_2 become #n_4 with the text [4] - the untyped one's word «второй» too, as renumberNotes
set every such link's innerHTML; the sources stay. `.comments.xml`: the note links are no
candidates for comments - c_1…c_3 in sign order, the notes untouched. `.preview.xml`;
`.mismatch.xml` (`mismatch.fb2`: «# # #» is a text, there is no sign - 0 against 1). All as
expected. Open question (kept): «# # #» as a note text.

### 19 Создать сноски или комментарии из абзацев, помеченных знаками карет

`19_notes-from-caret-paragraphs`, id `02/notes-from-caret-paragraphs`, v4.4: as 17 with «^».

Books and snapshots: `carets.fb2` (a history with a sign, a subtitle «* * *» skipped, a source
subtitle continued by a «++» paragraph) - `notes-from-caret-paragraphs.comments.xml` (comments,
ok, ok): a comments body after the main body, c_1 for the history's sign («История{1} правок.»),
«Комментарий{2} и еще один{3}», «Жирный{4}» in strong without its space; c_3 holds the subtitle
«Подзаголовок второго.» and «Абзац второго.»; the section of the sources keeps an empty line;
`.xml` the same as footnotes; `.preview.xml`; `.none.xml` (`mismatch.fb2`: «В документе не нашлось
ни одного абзаца-исходника текста сноски.», the form, cancel). All as expected. Open question
(kept): «^ ^ ^» as a note text.

### 24 Создать сноски или комментарии из абзацев, помеченных маркерами

`24_notes-from-marked-paragraphs`, id `02/notes-from-marked-paragraphs`, v7.3: the dialog shows all
its settings - the sign marker (`noteSign`: [1], {1}, [~1~], {~1~}, `[*]+`, «число надстрочным
текстом» the default, or one's own `refMarkerStr` with `interpretAsRegExp`), «совпадение должно
быть не от начала абзаца» (`matchNotFromBeginning`, on), the first paragraph marker
(`firstNoteP`: the same kinds as regular expressions with the flags gm, «число надстрочным
текстом» the default, or one's own `firstNotePMarkerStr` with `interpretAsRegExp2`), the
continuation marker; a pattern that does not compile: «Произошла ошибка при компиляции регэкспа
для маркера знака сноски.» (or «…маркера первого абзаца текста сноски.») with the engine's message,
and the form comes back.

Books and snapshots: `markers.fb2` - `notes-from-marked-paragraphs.xml` (defaults, ok, ok): signs
`<sup>1</sup>`, «²», `<sup>12</sup>`, not the linked `<sup>3</sup>`; texts «Первая сноска.»,
«Вторая сноска.» + «Продолжение второй.», «Третья сноска.» (a source starting with a space and
`<sup>3</sup>`); links without the superscript; `.comments.xml`, `.preview.xml`, `.bad-regexp.xml`
(own sign «[»: the message, unchanged); `markers-brackets.fb2` - `.brackets.xml`
(`{"noteSign":"1","firstNoteP":"30","action":"notes"}`, keep): «Текст[1]», «подряд[2][3]» - two
signs in a row - and the texts «Первая.», «Вторая.», «Третья.». All as expected. Further fixes:
the first paragraph marker is removed only at the start of a paragraph (this dialog searched it
anywhere and cut that many characters off the start of a continuation paragraph or a verse holding
a number further on); two signs in a row are both counted (2.7.9's count stopped with «Произошла
ошибка (код 1)» and still asked whether to remove the sources).

### 31 Расширенный поиск возможных сносок

`31_find-possible-footnotes-extended`, id `02/find-possible-footnotes-extended`; v1.2 (TaKir and
Sclex's set of 22.11.2024). "Поиск по набору регэкспов" of the current generation: group 16's
`regexp-set.js` and `nav-lib.js`, copied unchanged (engine 'current', `returns: false` - the
original's `Run()` returns nothing). The expressions, as JScript read the strings: `^[\]]` (the
original's "^[\]]" is `^[]]`, which JScript - like Perl - took for a "]" at the start) «Найдено:
скобки в начале строки»; `^[*]` outside subtitles; `([A-Za-zА-яЁё0-9…,;.»"!?:%“™”©\)])[[*]`
«звездочки или скобки после букв, цифр и знаков препинания»; four, three, two and one digits after
`[A-Za-zА-яЁё…,;.»"!?:%“™”©\)]` «… прилипшие к словам» (of two at one place the longer, registered
first, wins). Book `search.fb2`, snapshot `find-possible-footnotes-extended.xml` (`--select n5:0:0`,
unchanged) and the chain `chain-search.xml` (below). Expected and recorded from n5:0: n5:0-1 «]»,
n6:0-1 «*», n8:4-6 «о*», n8:13-15 «о[», n9:4-7 «т12», n10:5-9 «.123», n11:7-9 «)*», n12:10-12 «я1»
(the superscript is text), n14:16-18 «а5», n15:5-7 «.*», then «Поиск завершен!» and «От позиции
курсора до конца документа ничего не найдено.» with the selection left; from n8:5 n8:13-15 (the
match «о*» starts before the caret). Differences: a picture is one character (2.7.9: three); a
soft hyphen is a character (2.7.9: «&shy;», five, whose «;» could complete «…;*»); the
`addMacros` definitions, used by tag expressions only, are not carried over; no scrolling step.
Fix: the picture-selection message (group 16's).

### 32 Поиск возможных сносок (без скобок)

`32_find-possible-footnotes-no-brackets`, id `02/find-possible-footnotes-no-brackets`; v1.2. As 31
with its own set: «]» and «*» at the start; `([A-Za-zА-яЁё…,;.»"!?:%“™”©\)])([\x20\xA0])?[*]`
«звездочки после букв и знаков препинания» (a space or `&nbsp;` between allowed);
`[*]([\x20\xA0])?[A-Za-zА-яЁё]` «звездочки или скобки перед буквами»; the digits «… прилипшие к
словам и знакам препинания». Snapshot `find-possible-footnotes-no-brackets.xml` (`n5:0:0`) and
the chain. Expected and recorded from n5:0: n5:0-1, n6:0-1 (of «*» and «* з» at 0 the first
registered), n8:4-6, n9:4-7, n10:5-9, n11:7-9, n11:20-23 «а *», n12:10-12, n14:16-18, n15:5-7, then
the message. Differences and fix as 31.

### 35 Поиск возможных маркеров сносок

`35_find-possible-footnote-markers`, id `02/find-possible-footnote-markers`; v1.0 (20.02.2022).
The older generation of the engine (`marker-search.js`, on group 16's `nav-lib.js` and
`lib/ie-html.js`): a collapsed caret starts one character on and a match right at it does not
count, the caret's paragraph is searched to its end, no «Пропустить» exceptions, no «Поиск
завершен!»; and `tagRegExp`, expressions over the paragraph's HTML with the macros `<sup>`
(`<[Ss][Uu][Pp](?![a-z])[^>]*?>`) and `</sup>`, a match ending inside a tag passed over. The
set: a superscript number after a real space in the HTML («Пробел перед маркером сноски, возможно
приклеившийся абзац текста сноски»), a superscript at the start and in the middle of a paragraph,
digits stuck to letters (`i`) or to punctuation, apostrophes stuck to letters or digits (a space
between allowed for two more), asterisks stuck to letters, after `[»….,:;!\?-—–]` - whose range
`?`–`—` takes in every Latin and Cyrillic letter, so it also finds a letter and an asterisk, one
character before «Прилипшие к тексту звездочки» would -, after a letter and a space, and «*» at
the start outside subtitles. The look-behinds, cut off and checked by hand in the original, are
the engine's own: here both give the same matches. Snapshot `find-possible-footnote-markers.xml`
(`n5:0:0`) and the chain. Expected and recorded from n5:0: n6:0-1, n8:4-6 «о*» (the range),
n9:5-7 «12», n10:6-9 «123», n11:21-23 « *», n12:11-12 (the superscript in the middle, registered
before the digits at the same place), n12:22-23 (after a space), n13:0-1 (at the start), n14:8-9
«'», n14:17-18 «5», n14:18-19 «'», n14:27-29 « '», n15:5-7, then the message; from the caret n8:5
- n9:5-7 (the «*» right at the caret is not reached). Differences: a picture is one character
(2.7.9: «~~~») and an `<IMG href>` in the HTML (Internet Explorer: `<SPAN class=image><IMG src>`),
which no expression looks at; a soft hyphen is a character (2.7.9: «&shy;», whose «;» could
complete «Прилипшие к знакам препинания цифры»); the look-behinds; no scrolling. Fix: the
picture-selection message.

**The chain** `tests/scripts/fixtures/279/02/chains/search` (a test driver, not a bundled script)
runs 31 (11 times from n5:0 and once from n8:5), 32 (11 times) and 35 (14 times, and once from
n8:5) through `mfbe.scripts.run` by their FictionBook Editor paths and writes one line per call -
the value (null) and the selection - to the clipboard: `chain-search.outputs.json`, on
`search.fb2`, the book unchanged (`chain-search.xml`).

### 38 Превратить внешние ссылки в примечания

`38_external-links-to-footnotes`, id `02/external-links-to-footnotes`; stokber's compilation 1.3
(December 2024). The original first turns, in every paragraph (annotation and history included),
an external link - `<A (class="" )?href="(https?:|ftp:|file:|mailto:)…">text</A>`, no type - into
its text and the address between the temporary brackets 【♣★ ★♣】 (General clean-up's expression),
then runs "Примечания из скобок" (the 2.7beta1 604 with those brackets): every bracketed address
becomes a link [N] of class `note` to a new section holding the address, inserted before the
section of the next note link of the book (appended without one), and `finalization` renumbers
the sections (titles, ids n_N), the addresses of every link to them and the text of those of
class `note`. A book that already holds 【♣★ or ★♣】 is refused («Это невероятно, но в вашем
документе обнаружились…») with the pattern «【♣★|★♣】» on the clipboard. The end: «'Превратить
внешние ссылки в примечания' v1.3. / Добавлено примечаний: 5. / Затрачено времени: …».
Converted in one pass on the document (`lib/external-links.js`, shared with 03/38): every
external link's items lose the link mark and get a note link after them, inside the marks that
were around the link; the placement is worked out first, then the sections inserted, the body
renumbered (`renumber`) and committed; the clipboard through `mfbe.clipboard.writeText`.

Books and snapshots: `external-links.fb2` (`external-links-to-footnotes.xml`): links in the
annotation, plain, inside an emphasis, around a strong word (mailto:), ftp:; an old note [1], an
untyped internal link to n_1 and a «www.» address without a scheme. Expected and recorded: the
first three notes go before the old n_1 (the next note link after them), the last two at the end -
n_1 «http://example.com/annotation», n_2, n_3 «https://example.com/b?x=1&y=2», n_4 the old note,
n_5 «mailto:user@example.com», n_6; «ссылкой[1]», «первый[2]», «второй[3]» (in the emphasis),
«Старая сноска[4]», «<strong>письмо</strong>[5]» (the strong was inside the link), «файл[6]»; the
internal link gets #n_4 and keeps its text (only links of class `note` got [N]); the «www.» link
stays; «Добавлено примечаний: 5.». `external-links-broken.fb2` (`.broken-link.xml`): the note link
after the external one points to «#nowhere» - «Ссылка сноски ссылается на несуществующий
раздел…», «Добавлено примечаний: 0.», the book unchanged. `external-links-marks.fb2`
(`.marks.xml`): the refusal, the clipboard «【♣★|★♣】» in `outputs.json`, unchanged.

Differences: no brackets are written into the text (the refusal stays, as the observable
behaviour); the nesting of a new link (above). Fixes: a note link after an external link that
points to no section of the notes body stops the run before anything changes (2.7.9 stopped in the
middle, the later links left as «【♣★address★♣】» text); sections nested in the notes body stop it
before anything changes, as its message says (2.7.9 said so after bracketing the links and then
made the notes all the same).

## 03_Комментарии

10 scripts in 2.7.9: 2 new, both converted here (T048); the successors of the eight packages
converted from 2.7beta1 (`01_add-comment` … `08_unify-comments-remove-unused`, with
`notes-engine.js`) are left for their recheck. Packages: `scripts/03_comments/<NN>_<slug>/` with
the 2.7.9 number, ids `03/<slug>`, `legacy.source` the 2.7.9 path (20: `sourceVersion` "1.4"),
`name` and `description` in ru, en and uk, the 2.7.9 icon (38 has none), `undoLabel` the name,
`needsSelection` false; in `index.js` the skeleton's notice lines verbatim
(`check-notices.py --package`: OK for both). Both use `lib/notes-book.js`, the page helper of
group 02 (byte-identical; see the group 02 notes). Reference books
`tests/scripts/fixtures/279/03/`, snapshots `tests/scripts/snapshots/03/` (9, in its `suite.json`).
A comments body is a FictionBook Editor convention that FB2 2.1 does not allow (a second body
must be named "notes"): the books holding one validate without it and load as legacy, as
`conv-a-02.fb2` of the earlier conversion does.

### 20 Проверить корректность оформления комментариев

`20_check-comments`, id `03/check-comments`; v1.4. The counterpart of 02_Примечания/30 for
comments: no comments body - «Отсутствует body комментариев.»; a section of the comments body
without id - «Раздел номер N в body комментариев не имеет id. Перемещаемся на нее...»; then every
link of the page in order (the annotation and the history first), except external ones (an
address holding http://, https:// or ftp://) and those pointing into the notes body: an empty
text - «Текст ссылки равен пустой строке.», an empty address - «Пустой адрес ссылки.», no «#» -
«Отсутствует # в адресе ссылки.», no comment section of that id - «В body комментариев нет раздела
комментария с id, указанным в ссылке.», a section pointed to twice - «Вторая сноска, которая
ссылается на тот же раздел.», a link out of order - «Ссылки идут не по порядку…» with the previous
and the current section, the first link not to the first section - «Первая ссылка ссылается не на
первый раздел…»; each as «Ошибка в сноске {N} … Перемещаемся на ошибочную сноску...». Then the
sections no link points to - «Отсутствуют ссылки на некоторые разделы комментариев…» with their
list; else «Проверка корректности оформления комментариев завершена. Ошибок не обнаружено.
Затраченное время: …». After a problem the caret goes where it is, as FictionBook Editor's `GoTo`
put it: at the start of the faulty link, or of the first paragraph (the title) of the section.
Read-only; `selection.set` places the caret.

Books and snapshots: `check-comments.xml` (`check-ok.fb2`, `--select n5:0:0`, unchanged) and the
chain `tests/scripts/fixtures/279/03/chains/check` - it puts the caret at the start of the book,
runs the check through `mfbe.scripts.run` by its FictionBook Editor path and writes the value
(null) and the caret to the clipboard - on seven books, `chain-check.<book>.xml` with its
`outputs.json`. Expected and recorded: `ok` - no error, the caret left at n4:0; `order` (an
external link and a footnote link before the comment links {2}, {1}) - «Первая ссылка ссылается
не на первый раздел. … Номер: 2 id: c_2 Текст ссылки: {2}», the caret at n6:11, the link {2};
`unreferenced` - c_3 listed, the caret at the start of its title (n27:0); `no-id` - section 2, the
caret at its title (n23:0); `unknown` (a link to the chapter's id) - «В body комментариев нет
раздела комментария с id, указанным в ссылке.», the caret at n6:4; `twice` - «Вторая сноска…»,
the caret at the second link (n6:24); `no-body` - «Отсутствует body комментариев.», the caret
left.

Difference: the messages show a link's text ({1}) where 2.7.9 showed its HTML (`<SUP>{1}</SUP>`).
Fix: the order check compares a comment link with the comment link before it; 2.7.9 took the link
before it in the book, so a footnote or external link before the first comment link made it
report «Ссылки идут не по порядку» with «Номер: 0 id: undefined» and that other link's text
instead of «Первая ссылка ссылается не на первый раздел» (the `order` book); that message now
shows the link's text, which a stray semicolon dropped. Open question (kept as in 2.7.9, whose
test of the link type is commented out): every link that is neither external nor into the notes
body is checked as a comment link, so an internal link to a chapter is reported (the `unknown`
book).

### 38 Превратить внешние ссылки в комментарии

`38_external-links-to-comments`, id `03/external-links-to-comments`; stokber's compilation 1.3: as
02_Примечания/38 with the comment settings of its "Комментарии из скобок" - a comments body titled
«Комментарии», ids c_N, the links {N} in superscript without a type, the next comment link a link
whose local address starts with «c_», and every link to a comment section gets the text {N}
(`finalization` tested the address it had just written). Engine `lib/external-links.js`
(byte-identical with 02/38); the messages «'Превратить внешние ссылки в комментарии' v1.3.»,
«Добавлено комментариев: N.».

Book and snapshot: `external-links.fb2` (`external-links-to-comments.xml`): the links of the 02
book with an old comment {1} (to c_1) between the third and the fourth, a footnote link beside
it, and notes and comments bodies. Expected and recorded: the first three comments go before the
old c_1, the last two at the end - c_1 the annotation's address, c_2, c_3, c_4 the old comment,
c_5 «mailto:…», c_6; «ссылкой{1}», «первый{2}», «второй{3}» (in the emphasis), «Старый
комментарий{4}» with the footnote [1] untouched, «<strong>письмо</strong>{5}», «файл{6}»;
«Добавлено комментариев: 5.».

Differences and fixes as 02/38 (no brackets written into the text, the refusal kept; the nesting
of a new link in formatting; a comment link pointing to no comment section and sections nested in
the comments body stop the run before anything changes).

## 04_Примечания и комментарии из скобок

12 scripts in 2.7.9, all successors, with the same file names, of the 12 packages converted from
2.7beta1 (task T076, recheck of `scripts/04_notes-from-brackets/`; the 2.7beta1 conversion is in
conversion-notes-a.md, group 04). All 12 **updated**; ids and folders unchanged.

What 2.7.9 changed, the same in all twelve (Sclex's engine, still "v2.2" in its messages): the
word for a section, «раздел» where 2.7beta1 said «секция», in the comments and in three
messages - *В body примечаний есть разделы второго уровня вложения…* (nested sections in the
notes body), *Ссылка сноски ссылается на несуществующий раздел…* (a note link to a missing
section) and *Ссылка сноски ссылается не внутрь раздела в теле примечаний…* (a note link that
points outside the notes body). Nothing else changed. Ported: the three Russian texts in every
package's own copy of `brackets-engine.js` (the twelve copies stay identical); the English
texts already said "section". The packages now name their 2.7.9 original, keep its notice
(`извлечение сносок из разных скобок`, `написал Sclex`, the same as 2.7beta1's) and set
`legacy.fbeVersion` "2.7.9" (no header version, so no `sourceVersion`). Their Russian
descriptions say «раздел в body …» like 2.7.9, and every package gained `name.uk` and
`description.uk` (*Примітки з …* / *Коментарі з …*; «регэксп» is *регулярний вираз*).

Snapshots: none re-recorded and none added - a snapshot holds the book, and the book after a
run is the same as before (only message texts changed; the snapshots of `conv-a-04.fb2` and
`conv-a-04-errors.fb2` pass unchanged). Difference kept from the 0.0.1 conversion, still true
against 2.7.9: inline formatting that crosses a bracket is kept by the document model's marks,
so the original's error *Не все тэги, открытые внутри скобок, в них закрываются* cannot occur.
No fixes, no open questions.

### 601 Примечания из []

`…/601_footnotes-from-square`, id `04/footnotes-from-square`: updated as above; uk *Примітки з
[]*. Snapshots `footnotes-from-square.xml`, `footnotes-from-square.errors.xml` stay.

### 602 Примечания из {}

`…/602_footnotes-from-curly`, id `04/footnotes-from-curly`: updated; uk *Примітки з {}*.
Snapshot `footnotes-from-curly.xml` stays.

### 603 Примечания из [! !]

`…/603_footnotes-from-square-bang`, id `04/footnotes-from-square-bang`: updated; uk *Примітки з
[! !]*. Snapshot `footnotes-from-square-bang.xml` stays.

### 604 Примечания из [~ ~]

`…/604_footnotes-from-square-tilde`, id `04/footnotes-from-square-tilde`: updated; uk *Примітки
з [~ ~]*. Snapshot `footnotes-from-square-tilde.xml` stays.

### 605 Примечания из скобок, заданных регэкспами

`…/605_footnotes-from-regex-brackets`, id `04/footnotes-from-regex-brackets`: updated; uk
*Примітки з дужок, заданих регулярними виразами*. Snapshot `footnotes-from-regex-brackets.xml`
stays.

### 606 Примечания из скобок, заданных простым текстом

`…/606_footnotes-from-text-brackets`, id `04/footnotes-from-text-brackets`: updated; uk
*Примітки з дужок, заданих простим текстом*. Snapshot `footnotes-from-text-brackets.xml` stays.

### 607 Комментарии из []

`…/607_comments-from-square`, id `04/comments-from-square`: updated; uk *Коментарі з []*.
Snapshot `comments-from-square.xml` stays.

### 608 Комментарии из {}

`…/608_comments-from-curly`, id `04/comments-from-curly`: updated; uk *Коментарі з {}*.
Snapshot `comments-from-curly.xml` stays.

### 609 Комментарии из [! !]

`…/609_comments-from-square-bang`, id `04/comments-from-square-bang`: updated; uk *Коментарі з
[! !]*. Snapshot `comments-from-square-bang.xml` stays.

### 610 Комментарии из [~ ~]

`…/610_comments-from-square-tilde`, id `04/comments-from-square-tilde`: updated; uk *Коментарі
з [~ ~]*. Snapshot `comments-from-square-tilde.xml` stays.

### 611 Комментарии из скобок, заданных регэкспами

`…/611_comments-from-regex-brackets`, id `04/comments-from-regex-brackets`: updated; uk
*Коментарі з дужок, заданих регулярними виразами*. Snapshot `comments-from-regex-brackets.xml`
stays.

### 612 Комментарии из скобок, заданных простым текстом

`…/612_comments-from-text-brackets`, id `04/comments-from-text-brackets`: updated; uk *Коментарі
з дужок, заданих простим текстом*. Snapshot `comments-from-text-brackets.xml` stays.

## 05_Иллюстрации

23 scripts in 2.7.9: 14 new, 2 dropped when 2.7beta1 was converted and re-examined here (03, 04),
7 successors of converted packages (01, 02, 05, 06, 07, 08, 09: left for their recheck; they still
carry their 2.7beta1 `legacy` and have no Ukrainian texts yet). Converted here (T049, T069): 13 of
the 14 new scripts - "14_Удалить все иллюстрации, их тэги и пустые строки (комбо)" runs other
scripts and is converted with the combos - and 04; 03 stays not converted. Packages:
`scripts/05_images/<NN>_<slug>/` with the 2.7.9 number, ids `05/<slug>`, `legacy.source` the 2.7.9
path (the path `mfbe.scripts.run` resolves for the combo, which runs 10 among others). Every
package has `name` and `description` in ru, en and uk, `needsSelection: false`, the 2.7.9 icon
where the script has one (10 and the "15 …" without "1.3" have none; 04's `icon.png` is made from
its `.ico` with the converter of `tools/legacy-script-audit.py`, byte-identical to what the
skeletons got), and in `index.js` the original's leading comment verbatim (`check-notices.py
--package`: OK for all 14). Dialog and message texts in Russian and English (FR-026).

### The common ground

**The book as the originals saw it.** The scripts walked FictionBook Editor's `fbw_body` - the
book's annotation and its history first, then every body (`files/fb2.xsl` of 2.7.9) -, where a
block picture is a `DIV.image` and an inline picture a `SPAN.image` (each holding an `IMG`), a
paragraph or an empty line a `P`. The conversions rebuild that order from `mfbe.doc.get()`
(description and bodies): pictures of the book annotation and the history count as the originals
counted them, and are changed through `doc.setDescription`; the bodies through `doc.replaceNode`,
`doc.removeNode` and `doc.insertNode`. Those calls are schema-checked: an edit FB2 does not allow
at that place - which FictionBook Editor made, leaving an invalid book - is not made and not
counted (recorded per script).

**An emptied paragraph** is written as FictionBook Editor saved it (`FBDoc.cpp`, `ProcessP`): a P
with no child left, or with one plain text of white space, became an empty line; in a stanza a
verse of one space; a table cell stayed a cell (10, 13, 15, 16), as group 19's "Превратить таблицы
в простой текст" does.

**Engines** (each package carries its copy; byte-identical, md5-checked): `image-removal.js` (10,
16), `image-nav.js` (11, 12, 18, 19), `picture-refs.js` (17, 20, 25), `place-images.js` (both 15),
`lib/legacy-html.js` (13: a copy of `scripts/06_cleanup/02_general-cleanup/lib/legacy-html.js`).

**Run from other scripts.** Every `run()` returns what the original's `Run()` returned: nothing
(a caller of `mfbe.scripts.run` gets `null`), except 15 (`true` without a body, `false` when
cancelled at its first question). The navigation scripts return nothing either - their originals
had no "Found"/"NotFound" -, and say so in a message when there is no further picture, as 2.7.9.

**Reference books** (`tests/scripts/fixtures/279/05/`, valid FB2 2.1 against
`resources/schema/FictionBook.xsd`; PNG binaries made with zlib, the 8×6 JPEG of
`tests/fixtures/books/ai-selection.fb2`): `tags.fb2` (10, 16, 04, 15's mismatch, 20's set cover),
`navigation.fb2` (11, 12, 18, 19; 17's and 25's "none" runs), `copies.fb2` (17), `names.fb2` (25),
`covers.fb2` (20), `placement.fb2` and `placement-edge.fb2` (15), `sections.fb2` (30; 04 without
binaries; 13's direct run), `empty-lines.fb2` (13). Node ids: `run-script.mjs --list-nodes`.
**Tests**: `tests/scripts/snapshots/05/suite.json` (35 entries). Test drivers (packages under
`fixtures/279/05/chains/`, never bundled) run scripts through `mfbe.scripts.run` by their 2.7.9
paths: `navigation` (11, 12, 18, 19 from given selections; one clipboard line per call, recorded
in `chain-navigation.outputs.json`), `save-twice` (04 twice into one folder),
`empty-lines-{keep,auto-add,auto-remove,ask}` (13 with settings and a fixed date). Every snapshot
equals the result derived from the 2.7.9 code before its first run (below). Gate:
`tests/scripts/run-all.sh --group 05` - 45 snapshots (35 new, 10 of the 2.7beta1 packages) pass.

### 04 Сохранить вложения на накопитель

`04_save-binaries`, id `05/save-binaries` (T069: dropped from 2.7beta1, which had no file access).
Asks for a confirmation, saves every binary object with its original bytes, named by its id,
through `mfbe.files.saveBinaries` (script API version 2), and reports "Было сохранено N из M
бинарных объектов" with the original's time string, "Ни один бинарник не сохранён! Возможно файлы
уже существуют?" when none was saved, "В этом документе нет бинарных объектов." without binaries
(the "–= Alex Saveliev Script =–" banner kept). Snapshots: `save-binaries.xml` (`tags.fb2`, yes,
folder `pictures`: the outputs list cover.jpg 376, pic1.png 73, pic2.png 74 bytes with the SHA-256
of the book's base64 data), `.no` (declined), `.cancel` (folder dialog cancelled: nothing, no
message), `.none` (`sections.fb2`: the message), `chain-save-twice.xml` (second run into the same
folder: the editor asks for each file, Skip ×3, then the "none saved" message).
Differences: the folder is chosen in the editor's folder dialog (the original wrote next to the
book; the confirmation now says the user chooses it); an existing file is the editor's question
(Overwrite / Skip / Overwrite all / Cancel; the original never overwrote and counted it as not
saved).

### 10 Удалить все теги иллюстраций - теги image

`10_remove-image-tags`, id `05/remove-image-tags` (v1.6, Sclex). Removes every inline picture,
then every block picture from the last to the first together with the empty lines next to it,
then those empty lines; the cover stays. Message: block, inline, total, empty lines (the "(автор
Sclex)" banner kept).
Expected and obtained on `tags.fb2`: the 13 inline pictures go - the book annotation's line keeps
"Аннотация с картинкой  в тексте.", its paragraph of one picture becomes an empty line; the
history "История:  исправлена."; n16; n27 "Абзац  с жирной картинкой."; the verse n50 `<v> </v>`;
the cell n54 empty; the cite's text author n59 an empty line; n61 "Ссылка  и конец."; the note
n71 - and the 11 block pictures (n74, n63, n42, n36, n30, n25, n21, n14, n12, n8, n2); empty lines
removed: n73, n43, n31, n22, n19, n15, n13, n11, n9; n37 stays (after the title, last: needed);
n41 stays (its section would keep only its title); n26 "undefined" stays. Message 11, 13, 24, 9.
Snapshot `remove-image-tags.xml`.
Fixes (also in 16): the word "undefined" counted as an empty line (the expression was built before
its non-breaking space variable was set: `( | |&nbsp;|undefined)*`) - 2.7.9 removed n26; the empty
line after a picture that opens its section stayed whatever followed (operator precedence in
`emptyLineIsNeededForValidity`) - 2.7.9 kept n31.
Differences: the empty line that would leave a title alone stays (2.7.9 removed 10 lines and left
"Глава 4" invalid); an emptied formatting element or link goes (2.7.9: `<strong/>`, an empty
`<a>`); in a poem's text author the emptied paragraph stays (no empty line allowed there); the
count of "unclear" pictures (an IMG outside an image element) is gone.

### 11 Перейти на предыдущую 'блочную' иллюстрацию, 12 … следующую 'блочную' …, 18 … предыдущую инлайн-иллюстрацию, 19 … следующую инлайн-иллюстрацию

`11_previous-block-image` (`05/previous-block-image`), `12_next-block-image`, `18_previous-inline-
image`, `19_next-inline-image` (v1.1 Sclex and stokber; v1.0 stokber after Sclex). The originals
pasted a marker at the start of the selection, walked fbw_body forwards (pre-order) or backwards
(each container before its content, the content from the last) to the first `DIV.image` (11/12)
or `SPAN.image` (18/19) beyond it, went there with GoTo and stepped off the picture with Shift+Esc
and Left (previous) or Right (next). `image-nav.js` puts the text blocks and block pictures of the
book on one number line (a caret is its block's start plus its offset), finds the picture, and
puts the caret back with `selection.set`: 18 right before the inline picture, 19 right after it
(their setting `sel`, 0 as shipped, would select one character to the right); 11 at the end of the
text right before the block picture, 12 at the start of the text right after it - or, when another
picture or nothing lies there (pictures with only empty lines between them), right at the
picture's side, a place between blocks that `selection.get()` reports as the container and its
offset, which the next run reads back - so that repeated runs step through every picture. No more
picture: "  Иллюстраций больше нет." / "  Инлайн-иллюстраций больше нет." with the script line.
Expected and obtained (chain driver `navigation` on `navigation.fb2`, 43 calls,
`chain-navigation.outputs.json`): 12 from n48:0 - n4:0, n9:0, n5:53 (after n12, n14 follows past
an empty line), n5:55, n16:0, n19:0, n28:20, n36:0, n41:21, then the message (stays n41:21); 11
from n44:13 - n28:20, n29:17, n16:23, n5:55, n5:53, n9:38, n7:7, n51:22 (end of the history), then
the message; 19 from n48:0 - n48:13, n51:11, n9:14, n9:30, n19:1, n23:6, n36:8, n44:12, message;
18 from n44:13 - n44:11, n36:7, n23:5, n19:0, n9:29, n9:13, n51:10, n48:12, message; a selected
block picture n14 (`n13:0-n14:0`): 12 → n16:0, 11 → n9:38; a selected inline picture n11: 19 →
n19:1, 18 → n9:13; a text range n9:10-20 holding n10: 19 → n9:14 (the picture inside the range),
18 → n51:10. Every `run()` value `(nothing)`. Snapshots `previous-block-image.xml` (`--select
n16:5:5`), `next-block-image.xml` (n9:5), `previous-inline-image.xml`, `next-inline-image.xml`
(n9:20), `chain-navigation.xml`: the book unchanged.
Fix: a selected picture made the script stop with an error (its control range has no `duplicate`;
stokber's 2025 "костыль от ошибки выделения" stepped off it, but the code went on with the range it
had failed to copy): the search now starts where that step put the caret.
Differences: the check "Установите курсор в документ!" is dropped (scripts see the Body view's
selection only); 11/12's caret beside a block picture as described (2.7.9: where the arrow key put
IE's caret); the editor scrolls the place into view (GoTo centred it).

### 13 Пустые строки рядом с иллюстрациями

`13_empty-lines-next-to-images`, id `05/empty-lines-next-to-images` (v2.1, Александр Ка; the
change history at the end of the original is kept in the notice). A port on a tree mirroring
fbw_body (DIVs named by their FB2 element, a P for every paragraph and empty line), every edit
sent to the editor as it is made (the book annotation and the history at the end through
`doc.setDescription`), the italic and bold tests on the paragraph HTML of `lib/legacy-html.js`
with the original's expressions. Phase 1 over every P: 111 white-space lines emptied; 112 a line
of one inline picture stripped of spaces and formatting, 113 such a subtitle made a paragraph,
114 a cite or poem (with its stanza) holding nothing else dissolved; 121 repeated empty line, 122
cite / epigraph / poem / stanza / section annotation holding only an empty line dissolved, 123
empty lines at a container's edge (not after a title, epigraph, picture or annotation), 124 next
to a title, annotation, poem, epigraph, cite or subtitle (not next to a picture). Phase 2 over the
block pictures of sections: 201 (the head of a section: never met in valid FB2), 211, 212 (between
the picture and the section's edge), 221 (an empty line between a picture and a poem, table or
epigraph). Then the 26 combinations (picture + cite / subtitle / italic / bold / plain text /
text in a block / picture, with or without an empty line between; text + picture likewise), and
per the settings (0 remove, 1 add, 2 ask - the default -, 3 leave) the empty line between them is
added or removed: in mode 2 after a summary question ("• НАЙДЕНО … Продолжить?"), one question per
place (Да keeps the added line / removes the existing one, Нет the opposite, Отмена ends that
kind). Last the version of the file is raised with a line in the history (on by default; the name
"Зорро"), or a recent line of the history (within 10 days) is extended, and a window gives the
statistics. The settings are constants of the script; a script that runs it may pass its own in
`ctx.args`, with `today` (YYYY-MM-DD) for the history date.
Expected and obtained on `empty-lines.fb2` (`chain-empty-lines-keep.xml`, settings 3, date
2026-11-10): annotation - the empty line and the line of a space go (121, 123); section 1 - the
empty line after the title (124), the first of two (121); 2 - "   " and an italic space emptied
(111 ×2) and removed (124, 123); 3 - the epigraph and a cite of one empty line dissolved (122 ×2),
the first then removed (124), an empty line opening a cite removed (123); 4 - the subtitle of a
picture and a space becomes `<p>` with the bare picture (112, 113), the bold picture's cite
dissolved (112, 114), the poem around a verse of a picture dissolved with its stanza (114 ×2);
5 - the empty line between the picture and the section's end removed (212); 6 - empty lines
inserted between the poem and the picture and the picture and the table (221 ×2); 7-10 unchanged;
version 1.0 → 1.1 and "v.1.1 —  Скрипт: «Пустые строки рядом с иллюстрациями» 2.1 — (Зорро,
10.11.26)" appended (1.0 is mentioned already); statistics 17 block pictures, 5 picture lines,
22 corrections. `chain-empty-lines-auto-add.xml` (settings 1, date 2026-10-31): 25 empty lines
added - after the pictures of kinds 001-006 (12), before those of 021-026 (12), after the picture
before a picture (007) -, and the recent line "Правка — (Зорро, 25.10.26)" becomes "Правка; Скрипт:
«Пустые строки рядом с иллюстрациями» 2.1 — (Зорро, 31.10.26)", the version unchanged.
`chain-empty-lines-auto-remove.xml` (settings 0): 14 empty lines removed (011-016 after, 031-036
before, 017). `chain-empty-lines-ask.xml` (settings 2, 34 answers): 33 questions in the derived
order and counts, the result as answered (e.g. section 7: lines kept after n76, n83, n85, n87 and
before n76, n79, n83, n85; Отмена at the third of seven ends kind 005). Direct run
`empty-lines-next-to-images.xml` (`sections.fb2`, the summary answered Нет): unchanged, no history
line (no correction).
Differences: the result window shows no proverb - left out pending the requester's decision (the
original appended a random saying from its list of wartime proverbs; the list is not copied); an
edit FB2 does not allow there is not made and not counted; a container is dissolved in one step;
a question shows the place by the selection, not a coloured line; the "B mode" check and the
refreshing of the pictures have no counterpart; the user name is the setting "Зорро" (the original
also read a `fbeUserName` of its main.js). Open questions: restore the proverb of the result
message? keep "Зорро" as the history line's default name?

### 15 Расставить иллюстрации по заданным местам 1.3, 15 Расставить иллюстрации по заданным местам

2.7.9 ships the script twice, byte for byte the same (one with an icon and "1.3" in its name):
`15_place-images-1-3` (`05/place-images-1-3`) and `15_place-images-at-placeholders`
(`05/place-images-at-placeholders`), folders named so that the editor's natural order keeps 2.7.9's
menu order (" 1.3" before ".js"); one engine, `place-images.js` (v1.3, stokber). After an
OK/Cancel note, the places - pictures whose binary is missing (`#undefined`, `#nobin_undefined`),
counted over the book annotation, the history and all bodies - and the unused binaries (no picture
or cover uses them; probable covers and copies such as `cover.jpg`, `x.jpg_1` left out) are
compared: when as many, the i-th place of the first body gets the i-th unused binary in the order
of the binary objects, the first body's paragraphs of white space become empty lines (`correction`)
and "Расставлено изображений: N" follows, with the left-out names on request in a report window;
otherwise the counts, and on request the lists, in a report window.
Expected and obtained: `place-images-at-placeholders.xml` (`placement.fb2`, OK, OK) - n7 →
`#img01.png`, the inline n10 → `#img02.png`, n14 (`#nobin_undefined`) → `#img03.jpg`, n20 →
`#img04.png`; n11 "   ", n13 (italic space), n19 (a non-breaking space) become empty lines, the cell
n23 empty, the verse n28 one space; message 4; report "Skipped by the script as probable covers
and/or copies of pictures (2 in all): img05.jpg_1, cover.png" (`.outputs.json`; the same in
`place-images-1-3.xml`); `.no-details` (Cancel at the last question: no report), `.cancel` (Cancel
first: unchanged); `.edge` (`placement-edge.fb2`): the places with an id, with a title and
`#UNDEFINED` get p1-p4, the places in the annotation and the notes body stay, `cover_src.png` is
listed as skipped, message 4 (2.7.9: 8 unused - the src-title-info cover and cover_src.png
included - against 6 places, so it would have refused); `.mismatch` (`tags.fb2`: 9 places, no
unused binary): the message and the report "Empty pictures (9 in all) Among them: undefined (1)",
`.mismatch-no-details` without it.
Fixes: the src-title-info covers count as covers, compared by address (the original: the
title-info list as a text the id occurred in); `cover_src.*` is left out as a probable cover (the
original's `cover(_crs)?` - a slip for the `cover_src` of scripts 02 and 20); a place is found by its
address also with an id or a title (the original's expression over the body HTML missed them and
the binary went to the next place); the message counts the pictures placed (not the smaller
count). Differences: the lists in a report window (2.7.9: a message box; its `MyMsgWindow`, for a
page 2.7.9 lacks, commented out); no refresh of the view and the cover lists, no visible-nbsp
replacement. Open questions (kept as 2.7.9): the opening note promises alphabetical order, the
code uses the binaries' order; places outside the first body are counted but not filled; the
probable covers are listed with an unanchored expression and left out with an anchored one.

### 16 Удалить иллюстрации, не 'ссылающиеся' на наличествующий бинарник

`16_remove-images-without-binary`, id `05/remove-images-without-binary` (v1.0, stokber after
Sclex's 10): the steps of 10 for the pictures whose address is not "#" and an existing binary's id.
Expected and obtained on `tags.fb2` (binaries cover.jpg, pic1.png, pic2.png): inline n80
(`#missing-a.png`, its annotation line becomes an empty line), n18 (`#undefined`), n23 (n22 then
an empty line, removed with n21), n60 (the text author an empty line), n72; block n63 (external
address), n36 (n37 stays), n21 `#old-pic1.png`, n12; empty lines n22, n13, n11; message 4, 5, 9,
3. Snapshot `remove-images-without-binary.xml`.
Fixes: exact address comparison (the original's `RegExp(ids.join('|'))` passed `#old-pic1.png` for
`pic1.png`; 2.7.9 kept n21); the pictures kept are no longer counted (the original's last loop took
the IMG of every kept picture out of the view and counted it as an "unclear" removed one: 16 here,
so its "none found" message never came in a book with pictures); the two fixes of 10.
Differences: those of 10.

### 17 Исключение копий вложенных файлов

`17_exclude-binary-copies`, id `05/exclude-binary-copies` (v1.2, Александр Ка). Binaries of the
same size and the same image width and height are copies (covers aside, both description lists);
every picture using a copy is pointed to the binary found first. Report: binaries, covers,
pictures, names changed, and the original's warning about the imprecise search (reflowed as it
did).
Expected and obtained on `copies.fb2`: a-copy.png (the annotation's and n9's picture), a-copy2.png
(n11), b.png (n12: same size and dimensions, another colour - the documented imprecision) →
`#a.png`; picture-copy.jpg (n19) → `#picture.jpg` (cover.jpg, as large, is a cover and takes no
part); e2.png is a copy of e.png but nothing uses it; c.png (1 byte more), d.png (other size in
pixels) and the two fonts (no dimensions) are no copies; 5 names changed. Snapshots
`exclude-binary-copies.xml`, `.none` (`navigation.fb2`: unchanged, "Исправлений нет").
Difference: the copies keep their ids (2.7.9 renamed them `a_COPY_01.png`, `a_COPY_02.png`,
`a_COPY_03.png`, `picture_COPY_01.jpg`): the script interface cannot rename a binary.

### 20 Обновить иллюстрации (версия Александра Ка)

`20_refresh-images-alexander-ka`, id `05/refresh-images-alexander-ka` (v1.3). Of the original's
work - reloading the pictures of its view and tree, rebuilding the binaries panel's buttons,
setting the standard covers - the covers remain: when the title-info's cover list has one place
and it is empty (no cover, or one whose binary is no JPEG or PNG of the book: the form showed it
empty), the first JPEG/PNG binary named `cover.jpg`/`cover.png` becomes the cover; the same with
`cover_src.*` for the src-title-info. Report: pictures and image binaries "refreshed", covers set.
Expected and obtained: `refresh-images-alexander-ka.xml` (`covers.fb2`) - the title-info gets
`#cover.jpg` (the first of cover.jpg, cover.png), the src-title-info's `#missing-src.png` becomes
`#cover_src.png`; 3 pictures, 4 image binaries (not notes.txt), 2 covers; `.cover-set`
(`tags.fb2`): unchanged.
Differences: nothing to refresh (the counts reported as before); the cover's binary is not moved
to the front of the binaries (no API to reorder them); no "cover_src" cover for a book without a
src-title-info (2.7.9 wrote one with empty required fields).

### 25 Коррекция jpg-png

`25_fix-jpg-png-names`, id `05/fix-jpg-png-names` (v1.2, Александр Ка). A picture whose address
names no binary is pointed to an unused binary of its name (extension jpg/jpeg/png/tif/gif/bmp,
with an optional "_N", stripped) with the extension jpg, jpeg or png; the report counts the
changes by kind (21 kinds).
Expected and obtained on `names.fb2`: the annotation's n24 and n10 `#pic3.png` → `#pic3.jpeg`,
n9 `#pic2.jpg` and n14 `#pic2.jpg_1` → `#pic2.png`, n11 `#pic4.tif` → `#pic4.jpg`, n12 `#pic5` and
n13 `#pic5.bmp` → `#pic5.png` (one binary serves both, as in the original), n17 `#Pic6.jpeg` →
`#Pic6.JPG`, the inline bold n19 `#pic4.gif` → `#pic4.jpg` (bold kept); n7 `#pic1.jpg` has its
binary, n15 `#nothing.jpg`, n16 `#extra.png` (only extra.gif) and n20 `#cover.jpg` (cover.png is
the cover, not unused) stay; report: 8 binaries, unused 6 → 1, 1 cover,
13 pictures, without binary 12 → 3, jpg→png 2, jpeg→jpg 1, png→jpeg 2, tif→jpg 1, gif→jpg 1,
bmp→png 1, no format→png 1. Snapshots `fix-jpg-png-names.xml`, `.none` (`navigation.fb2`:
"Исправлений нет"). No differences.

### 30 Вставить пустые картинки в началах и концах секций

`30_insert-empty-images`, id `05/insert-empty-images` (v3.7, TaKir with DeepSeek, as its notice
says). The dialog (HTML/Вставить пустые ссылки на картинки - параметры.htm) becomes a form: two
check boxes (both on), its notes as text, "Выполнить" / "Отмена". Outside the notes body every
section gets an empty picture (`#undefined`) after its title, and a section without subsections
one at its end (an untitled one unless it ends with a subtitle), except where one stands already;
a section left with nothing but titles and empty pictures gets an empty line. Statistics as the
original.
Expected and obtained on `sections.fb2` (`insert-empty-images.xml`, both): starts in n4, n9 (after
the epigraph), n15, n18, n42 (before the section annotation); ends in n4, n9, n18, n31, n36, n39,
n42 and the empty section n48 (`<image/>` + `<empty-line/>`); n22 (untitled, ends with a
subtitle), n25 (pictures there already), the notes section unchanged; n31's start not inserted
(its head holds a picture); counts 13 (5 + 8), untitled 4, empty lines 1, notes 1, parents 1.
`.start` (5 pictures), `.end` (8 and the empty line), `.none` (no option: "Не выбрано ни одной
опции для вставки!"), `.cancel`: as expected.
Fix: a subtitle counted as the title (`className.indexOf('title')` matches "subtitle"): 2.7.9 put
n22's start picture after its closing subtitle (and then none at its end) and n39's after "* * *",
and counted 2 untitled sections (2.7.9 on this book, all told: 8 starts - n9's between title and
epigraph, n31's before its picture -, 8 ends, 16 in all). Differences:
the start picture after the epigraphs (2.7.9: between title and epigraph, invalid); none before an
ordinary picture heading a section (2.7.9 inserted it, invalid), not counted; the form.

### Not converted

- **03 Обновить иллюстрации** (EN "Refresh the illustrations", UK "Оновити ілюстрації"; v1.1):
  reassigns the `src` of every IMG of the Internet Explorer view so that the pictures are drawn
  again and refills the cover lists of the description form - the editor's own page; the book is
  not changed, and the editor's views show a binary's current content by themselves. Needs the
  editor's own page (FR-024 excludes it); no API change proposed.

## 06_Чистка

12 scripts are new in 2.7.9 and all 12 are converted (T050) into `scripts/06_cleanup/`, beside the
16 packages converted from 2.7beta1 (`conversion-notes-b.md`), which are left as they are until
their recheck. None needs a power beyond FR-024: the scripts only read and edit the book and ask
the user.

**Where the originals worked.** FictionBook Editor showed the book as one HTML page whose editable
part, `fbw_body`, held a div for the title-info annotation, one for the document-info history
(both always there, an absent one as an empty `<p>`) and one per body; every text block was a
`<P>` and every structural element a `<div class=...>`. The scripts walked that page. The
conversions walk the same parts of the document model in the same order, so a script that edited
the annotation or the history edits them too (through `mfbe.doc.setDescription`), and one that
looked only at bodies leaves them alone.

**Shared code** (each package carries its own byte-identical copies):

- `lib/book.js` (the nine small packages 17, 30, 35, 38, 40, 45, 50, 55, 60): the page's parts in
  order, a walk over the structural and block nodes, the removal of marks with an element count
  (a mark the previous inline node did not carry is one element), and `Changes`, which writes the
  topmost changed node of each branch back with `doc.replaceNode` and the description with
  `doc.setDescription`. The edits are made in memory on the snapshot of `doc.get()`.
- `lib/legacy-html.js` and `lib/interactive.js`, copied unchanged from the 2.7beta1 packages (the
  HTML notation of a block, and the engine of the interactive clean-up scripts).
- `lib/jscript-regexp.js` (55, 65, 68, 71): `jscriptRegExp(source, flags)` compiles an expression
  with JScript's meaning of `\s` and `.`, so the originals' expressions are kept as written and
  match what they matched in 2.7.9 (see "The regular expressions" below).
- `lib/fbe-page.js` (68, 71): the part of the page the two long scripts used - `fbw_body` and its
  three kinds of div, each `<P>` with its `innerHTML` (the notation of `lib/legacy-html.js`, inline
  pictures in the page's form `<SPAN class=image contentEditable=false href=...><IMG ...></SPAN>`),
  `innerText`, the class of its parent and of itself (`subtitle`, `text-author` - a `<date>` too -,
  `td`, `th`), the `<LABEL>` the scripts put around a word to show and replace it, the history's
  `lastChild`, `insertAdjacentElement` and `innerText`, the version field `diVersion`, and
  `fbwBody.getElementsByTagName("EM" | "STRONG")`. `commit()` writes the changed blocks back; a
  `p`, `subtitle` or `text-author` the script emptied becomes an `<empty-line/>` where one may
  stand, as FictionBook Editor saved an empty `<P>`.
- 68 and 71 keep the original's code as written in `engine.js`, generated by the conversion from
  the 2.7.9 file with a short list of counted rewrites named in its header: `new RegExp` reads
  `jscriptRegExp`, the host provides `document`, `window`, `AskYesNo` and `MsgBox`, the dialogs
  are awaited (so the functions that ask are `async`), `GoTo_0` selects instead of scrolling, the
  end of the undo unit commits, the long loops report progress, the history date comes from
  `host.now()`, the dialog texts get English counterparts (`tx(ru, en)`), and the proverb that
  ended the result window is left out, its list (`Kn`, from a collection of wartime proverbs) not
  copied, until the requester decides.

**Reference books** (`tests/scripts/fixtures/279/06/`, all valid against `FictionBook.xsd`):
`ids-styles-links.fb2` (17, 30, 35, 38, 40, 45, 50), `notes-sections.fb2` (55, 60), `numbers.fb2`
(65), `cyrillic-latin.fb2` and `cyrillic-latin-none.fb2` (71), `general-cleanup-auto.fb2` and
`general-cleanup-ask.fb2` (68); 40 and 45 also run on `tests/scripts/fixtures/books/marks-006.fb2`
(the inline marks of feature 006). A schema-valid book has no body named `comments` (excluded by
35, 40, 45 as in the originals, but not exercised) and no id on an empty line, a date, a title, a
stanza or a table row (such an id stays, a recorded difference). **Snapshots:** `tests/scripts/snapshots/06/`, 19, listed
in `tests/scripts/snapshots/06/suite.json`. 71 writes today's date into the history, so its runs
with corrections go through the test package `tests/scripts/fixtures/279/06/06_tests/
71_cyrillic-latin-dated`, which runs `06/cyrillic-latin` through `mfbe.scripts.run` with
`{ today: "2025-05-10" }`; the package takes that date only from a calling script. Each expected
result below was worked out from the original's code before the snapshot was recorded; for 68 a
scratch copy that logs the operation counters changed on every paragraph confirmed which rules
fired, each checked against its expression. Below, `\u00A0` stands for a non-breaking space.

### 17 Превратить внешние ссылки в текст

Package `scripts/06_cleanup/17_external-links-to-plain-text`, id `06/external-links-to-plain-text`,
version 1.2 (Sclex).

**What it does.** Removes, keeping the text, every link of the page (`document.links`: the
annotation and the history included) whose address does not match `^ *?(file://|#)` or matches
`# *https?:`, then reports the number in a message box (with Russian plural forms).

**Conversion.** `stripMarks` over the text blocks of the page's parts. The original read
`getAttribute("href")`, which in its page's IE7 document mode is the address resolved against
`file:///.../main.html`; the conversion resolves the same way: `#id` becomes
`file:///.../main.html#id`, an empty or relative address a `file://` one (kept), an absolute
address stays.

**Expected (ids-styles-links.fb2).** 8 links unformatted: `http://example.org/` in the annotation,
`https://example.com/history` in the history, and in the last paragraph `http`, `https`,
`mailto:`, `ftp:`, `#http://example.org/` and `# https://example.org/`; kept: `file:///C:/...`,
`  #p1`, `""`, `other.fb2#x` and every `#id`. Snapshot `external-links-to-plain-text.xml`.

**Differences.** A run of text carrying one link counts as one link.

**Open questions.** If 2.7.9 had run in a later document mode (address as written), an empty or a
relative address would be unformatted too. This file is the later version (v1.2) of 2.7beta1's
*Превращение внешних ссылок в текст* (v1.0, `06/external-links-to-text`), as its header says, but
the review recorded the old one as `noCounterpart`; both now stand at place 17 of the group.

### 30 Удалить id абзацев

Package `scripts/06_cleanup/30_remove-paragraph-ids`, id `06/remove-paragraph-ids`, version 1.2
(Sclex).

**What it does.** Removes the non-empty `id` of every `<P>` of every body (the notes body too):
paragraphs, verses, subtitles, text authors, table cells, in titles and epigraphs as well. The
annotation and the history are not bodies. Message "Всего удалено id абзацев: N".

**Expected.** 17 ids removed (`bt1`, `ep1p`, `ta1`, `s1t`, `p1`, `p2`, `P3`, `sub1`, `cp1`,
`cta1`, `v1`, `th1`, `td1`, `s2at`, `s2ap` in the main body, `n1t`, `n1p` in the notes); `ann1`
in the annotation and all section, picture and block ids stay. Snapshot `remove-paragraph-ids.xml`.

**Differences.** A non-schema id on an empty line or a date (an unknown attribute in the editor)
stays.

### 35 Удалить id разделов

Package `scripts/06_cleanup/35_remove-section-ids`, id `06/remove-section-ids`, version 1.2
(Sclex).

**What it does.** Removes the non-empty `id` of every section, at any depth, of every body except
those named `notes` and `comments` (their sections are the note targets). Message "Всего удалено
id разделов: N".

**Expected.** `s1`, `S2` and the nested `s2a` lose their id (3); `n1` in the notes body keeps it.
Snapshot `remove-section-ids.xml`. No differences.

### 38 Удалить id картинок

Package `scripts/06_cleanup/38_remove-image-ids`, id `06/remove-image-ids`, version 1.2 (Sclex).

**What it does.** Removes the `id` of every block picture of every body (inline pictures have
none). Message "Всего удалено id картинок: N".

**Expected.** `cover-img`, `img2`, `img3` and `nimg1` (notes) lose their id (4). Snapshot
`remove-image-ids.xml`. No differences.

### 40 Удалить теги style, id разделов, id абзацев и id картинок

Package `scripts/06_cleanup/40_remove-styles-and-ids`, id `06/remove-styles-and-ids`, version 1.2
(Sclex).

**What it does.** In one run: every `<span>` of the page that is neither `code` nor an inline
picture - the `<style>` elements - is unwrapped (the annotation and the history included), then
the ids of 30, 35 and 38 go. One message with the four counts.

**Expected.** ids-styles-links.fb2: 9 styles (`ann-style`, `hist`, `foo`, `outer`, `inner`, `bar`,
`pic` around a picture, `cell`, `note-style`), 17 paragraph ids, 3 section ids, 4 picture ids;
marks-006.fb2: 15 styles (five per block: nested styles and styles with a language), the pictures
keep their link and their bold, and the id `s2`. Snapshots `remove-styles-and-ids.xml`,
`remove-styles-and-ids.marks-006.xml`.

**Differences.** A run of text with one style counts as one element; a style named `code` or
`image` (which the page could not tell from `<code>` and a picture, and kept) is removed like any
other; an inline element unknown to FB2, kept by the editor as raw XML, stays (the page showed it
as `<span class=unknown_element>` and unwrapped it); a non-schema id on an empty line or a date
stays; the run is one undo step (the original left its undo unit open when only the first three
phases changed something).

### 45 Удалить атрибуты id, на которые нет ссылок, и теги style

Package `scripts/06_cleanup/45_remove-unreferenced-ids-and-styles`, id
`06/remove-unreferenced-ids-and-styles`, version 1.1 (Sclex).

**What it does.** Collects the ids the links of the book point to (an address `#id` or one
containing `main.html#`, any letter case), removes the styles as 40 does, then every unreferenced
id of the `<P>` of every body, of the block pictures of every body and of the other block elements
(sections, epigraphs, section annotations, cites, poems, tables) of every body but the notes body.
Message with the four counts.

**Expected.** ids-styles-links.fb2: 9 styles; 15 paragraph ids (`p1`, referenced by `  #p1`, and
`P3`, by `#p3`, stay); 3 picture ids (`img2` is referenced); 6 block ids (`ep1`, `cite1`,
`poem1`, `tab1`, `s2a`, `ann-s2a`; `s1` and `S2` are referenced). marks-006.fb2: 15 styles, `s2`
stays. Snapshots `remove-unreferenced-ids-and-styles.xml`, `...marks-006.xml`.

**Differences.** As 40 for the styles; a non-schema id on an empty line, a date, a title, a stanza
or a table row stays. **Open question:** spaces around an address are ignored as IE's resolution
ignored them; IE's percent-encoding of a fragment, if any, is not reproduced.

### 50 Расформатировать ссылки, адрес которых - пустая строка

Package `scripts/06_cleanup/50_unformat-empty-links`, id `06/unformat-empty-links`, version 1.2.

**What it does.** Unwraps every link of `fbw_body` whose `getAttribute("href")` is `""` or the
editor's folder (what IE7 mode gave for an empty address), and reports the number ("Ссылок с
пустым адресом — в документе не нашлось." when there is none).

**Expected.** 3 links: in the annotation, in the history and in the body. Snapshot
`unformat-empty-links.xml`. **Differences:** the link count as in 17. **Open question:** an
address of spaces only counts as empty, as IE7 mode resolved it to the folder.

### 55 Удалить ссылки 'bookmark', созданные FBD

Package `scripts/06_cleanup/55_remove-fbd-bookmark-links`, id `06/remove-fbd-bookmark-links`,
version 1.0 (Sclex).

**What it does.** In every `<P>` of the body named `notes` that starts - formatting tags aside,
spaces and non-breaking spaces allowed - with a link, deletes that link with its text and the
spaces around it (FictionBook Designer's back links). Status bar: "Было удалено N ссылок.".

**Conversion.** On the block's notation (`lib/legacy-html.js`): `processP()` and
`removeSymbolsBeyondTags()` of the original as written, its expressions through `jscriptRegExp`.

**Expected (notes-sections.fb2).** 7 links: `n1`, `n2` (4 spaces), `n3` (the link inside an
emphasis: `<emphasis>Курсивное</emphasis> примечание.`), `n4` (the paragraph held only the link:
an empty line), the picture-link with its picture, the non-breaking spaces case, the paragraph of
the cite. Kept: a link in the middle, a paragraph starting with a picture, the main body's note
link at a paragraph start. Snapshot `remove-fbd-bookmark-links.xml`.

**Differences.** An emptied paragraph becomes `<empty-line/>` (FictionBook Editor saved the empty
`<P>` so); another emptied block stays empty; an emphasis the link alone filled disappears.

### 60 Удалить разделы, внутри которых только заголовок и, возможно, пустые строки

Package `scripts/06_cleanup/60_remove-title-only-sections`, id `06/remove-title-only-sections`,
version 1.0 (Sclex).

**What it does.** Removes, in every body (the notes body too), the sections that hold a title and
nothing else than empty lines - `<empty-line/>` and paragraphs or subtitles of spaces and
non-breaking spaces only (tags aside; a picture makes a paragraph non-empty; a tab does too).
Status bar: "Было удалено N разделов.".

**Fix.** The original's test stopped at a section's first subsection (after removing an empty one
it took it for content), and at any other content before the later subsections; nested empty
sections after the first were never removed, and a section emptied of its subsections stayed. The
conversion examines every subsection and removes a section left with only its title and empty
lines together with them.

**Expected (notes-sections.fb2).** 11 sections removed: `b`, `c` (two blank paragraphs and an
empty line), `e` (empty subtitle), `g1` and `g3` (`g` keeps `g2` with text), `h` with `h1` and
`h2`, `i1` (`i` keeps its epigraph, so an empty line takes `i1`'s place), `k` (an emphasis of a
space), `n9` in the notes; kept: `a`, `d` (no title), `f` (a picture), `j` (an inline picture),
`l` (a tab). 2.7.9 removes 7 here (`b`, `c`, `e`, `g1`, `h1`, `k`, `n9`). Snapshot
`remove-title-only-sections.xml`.

**Differences.** A body keeps its last section, and a section with an epigraph, a picture or an
annotation that loses all its subsections gets an empty line (FB2 needs that content; 2.7.9 left
invalid FB2). The count includes the subsections removed with a section.

### 65 Дроби, степени, интервалы, габариты

Package `scripts/06_cleanup/65_fractions-powers-ranges-sizes`, id
`06/fractions-powers-ranges-sizes`, version 2.2 (jurgennt, engine by Sclex, regexps by stokber and
TaKir).

**What it does.** From the paragraph with the caret to the end of the book, one place at a time in
a Yes / No / Cancel input box: square and cubic units (`м2` -> `м<sup>2</sup>`), dimensions
(`120x30x40` -> `120×30×40`), fifteen fractions with a slash (`1/4` -> `¼`), ranges with a hyphen,
an em dash or a spaced en dash between numbers, the same with powers. Message with the number of
replacements and the time.

**Conversion.** `lib/interactive.js`, the engine of 06/large-numbers (the script this one was built
on); the 24 expressions are lines 61-234 of the original in `patterns.js`, through
`jscriptRegExp`; prompts as in the original (" :: Габариты ::\n > Замена:   ...").

**Expected (numbers.fb2, caret in the second paragraph).** 18 places asked in the order of the
patterns: `м2` (Yes), `км2` (No), `см3` (Yes), `120x30x40` (Yes), `21х29` (edited to `21 × 29`),
`1/4`, `1/2`, `3/4`, `1/3` (No), `2/3`, the ranges `1941-1945`, `10 - 15`, `2—3`, `5 – 7`,
`8 –9`, and the three ranges with powers; 16 replacements; the paragraph before the caret and
`11/4` stay. With Cancel at the seventh place the first two paragraphs are changed and the third
stays as it was. Snapshots `fractions-powers-ranges-sizes.xml`, `...cancel.xml`.

**Differences.** The title-info annotation is not processed (the original only when the caret
stood in it); the place is selected instead of highlighted.

### 68 Генеральная уборка (версия Александра Ка)

Package `scripts/06_cleanup/68_general-cleanup-alexander-ka`, id
`06/general-cleanup-alexander-ka`, «Текст-корректор» version 3.15 (Александр Ка, built on
*Генеральная уборка* by jurgennt, Sclex and Faiber).

**What it does.** A typographic clean-up in some 200 numbered operations, repeated on a `<P>`
until it no longer changes (at most 100 cycles), over the annotation, the history
(`ObrabotkaHistory_on_off = 1`) and the bodies: special characters (101-114), spaces at tag edges
and in runs (119-122), ellipses and punctuation (130-182), `_underlining_` made italic or bold
(155-158), italic and bold tags (201-270), the dash modes (301-321), punctuation and missing
spaces (401-472), dashes and hyphens (501-581), non-breaking spaces (601-691), abbreviations,
signs and units (730-772), final dots in titles (790), formatting of punctuation (801-803).
Addresses, links and (on request) `<code>` are shielded. Before it starts it asks about `<code>`,
hyphens next to one letter and en and em dashes next to letters, when the book has such places;
operations 155-158 ask when the book already has that formatting; then three by-hand passes ask
per place (901 a wrong °C, 911 a stress in capitals, 921 letter spacing). Result window with the
statistics, page by page.

**Conversion.** The original's code in `engine.js` (generated, rewrites listed there) on
`lib/fbe-page.js`; dialogs via the façade and `mfbe.ui`.

**Expected.** `general-cleanup-auto.fb2` (no questions; result window of two pages): the
annotation and the history lose their double spaces and the space before the dot (120, 420);
`Глава первая.` loses its dot (790) and `Часть XX в.` keeps it (790 exception, 770 adds a
non-breaking space); `Он сказал, что придёт…Но не пришёл.` (130, 420, 423, 454);
`—\u00A0Привет,\u00A0— сказал\u00A0он.` (551, 532, 610); soft hyphen, thin space, U+2011 and
U+2015 normalised (101-105); `½`, `¾`, `²`, `₂` written with tags (110-112); apostrophes `'`
(107); joined `<emphasis>Первый второй</emphasis>` and `<strong>жирный, ещё</strong>` (201);
punctuation unformatted (205); stresses `за́мок`, `писа́ть` (220); `: «Привет»,` (453, 423);
`1941–1945`, `стр.\u00A010–15`, `5 –\u00A07.` (510, 746, 514, 610); `т.\u00A0д.` (730); `№\u00A05`,
`20\u00A0°C`, `5%` (740, 741, 748); `ул.\u00A0Ленина`, `пл.\u00A0Пушкина` (450, 601); the web and
mail addresses untouched while the spaces around them go; the note link moved to its word (424,
472); the space after an inline picture kept; `P.\u00A0S.`, `1.\u00A0Первый` (765, 760);
`ЦК\u00A0КПСС`, `АО\u00A0«Ромашка»`, `XX\u00A0век`, `5\u00A0лет`, `3\u00A0метра` (630-772); in the
poem only the final hyphen becomes `\u00A0—` (520); `* * *` is left alone (129). Snapshot
`general-cleanup-alexander-ka.xml`. `general-cleanup-ask.fb2` with the answers code No, hyphen No,
en dash Yes, em dash Yes, 155 Yes, `1990 Сентябре`, `зАмок` (Yes with the found text applies the
proposal `за́мок`), 921 Yes, `разрядка в`: the code shielded, `Кто — то ... кто — то` (301),
`Он — она и он-она` (561, 550, 320), `<emphasis>очень важно</emphasis>` (155),
`<strong>слово</strong>` (156, no question as the book has no bold), `<strong>а</strong>` (158),
`1990 Сентябре` (901), `за́мок` (911), `<emphasis>разрядка</emphasis> в тексте` (921, 926; the
re-run then turns the non-breaking space after `в` back into a space, 690). With the other answers
(code Yes, hyphen Yes, en dash Yes, em dash No, 155 No, Cancel, No, 921 No): the code processed
(`a,b …`), `Кто– то ... кто –то` (580), `Он-она` (312), the underlining kept, 901 cancelled, 911
skipped, the spacing kept. Snapshots `general-cleanup-alexander-ka.ask.xml`, `...ask-other.xml`.

**Differences.** In a by-hand box Yes with an emptied text counts as No (the original applied the
proposal); the word is selected instead of coloured; italic and bold together are seen with the
bold outside (the editor does not keep the source nesting), so 215/216 may count work the
original did not do, with the same text; the result window shows no proverb: left out pending the
requester's decision (the dashed line that led into it is shown only before the line of a
holiday, a countdown or a wish). **Open questions:** restore the proverb of the result message?
The settings at the top stay as written; a user copies the package to change them, as one edited
the script in FictionBook Editor.

### 71 Кириллица-латиница

Package `scripts/06_cleanup/71_cyrillic-latin`, id `06/cyrillic-latin`, version 1.6
(Александр Ка).

**What it does.** Restores text typed in a mix of Latin, Cyrillic, Greek letters and digits, over
the annotation, the history and the bodies: Roman numerals with Cyrillic or Greek letters, Russian,
Latin and Greek words with foreign letters, `3` and `0` for `З` and `О`, stand-alone `Х`/`Ι` after
chapter words and before centuries; after a Yes / No question listing the places, foreign
one-letter prepositions; then, word by word, the mixed words left (Yes takes the text, No skips
the word and every equal one, Cancel ends the pass). With `Version_on_off = 1` it raises the
document version and writes a line into the history when it corrected something. Result window
with the statistics and the date.

**Conversion.** As 68: `engine.js` generated from the original, on `lib/fbe-page.js`. The history
date comes from `{ today }` when a script passes it (the suite's runner), otherwise the clock.

**Expected.** `cyrillic-latin.fb2` (runner, answers Yes, `На`, `кто`, No): `Книга о Москве и
Лондоне.` in the annotation (the `o` is replaced though the question did not list it: the question
looks at the original text, where the word before it was still Latin), `v.1.0 — первая версия` in
the history, `В XIX и XX веках`, `Москва — Здесь, Он сказал.`, `Он жил в London и Αθήνα.`,
`Дом а сад, кот с собакой. А потом`, `Глава X. Карл X, король.`, `На столе стоял кто-то.`, `Ho нет`
kept (No) and therefore `Ho всё же На месте.` (no question: `Ho` remembered as skipped, `Ha` as
replaced); version 1.1 and the new history line `v.1.1 —  Скрипт: «Кириллица-латиница» 1.6 —
(Зорро, 10.05.25)`; statistics 12 lines checked, 9 corrected. With Cancel at the first word the
two lines with `Ha` stay. `cyrillic-latin-none.fb2` (direct run, No to both): unchanged, no
history line. Snapshots `cyrillic-latin.xml`, `cyrillic-latin.cancel.xml`,
`cyrillic-latin.none.xml`.

**Differences.** Yes with an emptied text counts as No; the word is selected instead of framed and
coloured (the question still speaks of red characters); the result window shows no proverb: left
out pending the requester's decision; a calling script may fix the history date.
**Open questions:** restore the proverb of the result message? The history line names the user
"Зорро", the original's default; FictionBook Editor users changed it in the script or in
`main.js`.

### The regular expressions (JScript and JavaScript)

The originals ran in JScript 5.8 (the WebBrowser control's IE7 document mode: no
`FEATURE_BROWSER_EMULATION` in the 2.7.9 sources or installer; the scripts use the IE-only
`removeNode`). Checked for 55, 60, 65, 68 and 71 (about 7,500 lines; 68 compiles 410 expressions,
71 78):

- `\s` is `[\t\n\v\f\r ]` in JScript: no U+00A0 and no other Unicode space. 68 turns `&nbsp;`
  into U+00A0 while it works, so with ECMAScript's `\s` operations 562, 601, 730, 744, 760 and
  others would match the non-breaking spaces they insert again (counted twice); thin and other
  Unicode spaces would also count as spaces. `lib/jscript-regexp.js` writes `\s`, `\S` and `.`
  out with JScript's meaning, so the expressions stay as written.
- `.` is `[^\n]` in JScript (it matches `\r`, U+2028, U+2029); handled the same way, also for the
  regex literals applied to the book (`/<LABEL>.+?<\/LABEL>/g`, `/\n.+\n$/`).
- ECMAScript resets the captures inside a repeated group at each repetition, JScript kept them: the
  expressions with such captures (152, 129, 155-158, 620-622, 921, 922 of 68) never use them in a
  replacement, so nothing differs. 65 and 71 have none.
- An optional group cannot match the empty string in one iteration in either engine
  (`conversion-notes-b.md`); 65's prefixes are lazy (`^(.*?)??`), so no first character is lost.
- Not used: `split`, `RegExp.$n`, `lastIndex`, the `m` flag, `\S` inside a class, function
  replacements; `exec`/`test` only with non-global expressions (55, 60). Case-insensitive matching
  of Cyrillic and Greek letters is taken to be the same.
- Neither 68 nor 71 assigns to an undeclared variable (checked with a scope analysis), so their
  code runs unchanged in a strict module. U+2028 and U+2029 inside a string literal (68's
  operation 102) are valid since ES2019.

### Harness commands

```bash
export MFBE_CORE_BIN=... MFBE_UI_DIST=...
tests/scripts/run-all.sh --group 06        # every snapshot of the group, the 19 of snapshots/06/suite.json among them
F=tests/scripts/fixtures/279/06; S=tests/scripts/snapshots/06; G=scripts/06_cleanup
node tests/scripts/run-script.mjs $G/45_remove-unreferenced-ids-and-styles $F/ids-styles-links.fb2 --snapshot $S/remove-unreferenced-ids-and-styles.xml
node tests/scripts/run-script.mjs $G/65_fractions-powers-ranges-sizes $F/numbers.fb2 --select n6:0:0 --answer "м<sup>2</sup>" --answer "" ... --snapshot $S/fractions-powers-ranges-sizes.xml
node tests/scripts/run-script.mjs $F/06_tests/71_cyrillic-latin-dated $F/cyrillic-latin.fb2 --answer yes --answer "На" --answer "кто" --answer "" --answer ok --snapshot $S/cyrillic-latin.xml
node tests/scripts/run-script.mjs $G/68_general-cleanup-alexander-ka $F/general-cleanup-ask.fb2 --answer no --answer no --answer yes --answer yes --answer yes --answer "1990 Сентябре" --answer "зАмок" --answer yes --answer "разрядка в" --answer ok --snapshot $S/general-cleanup-alexander-ka.ask.xml
```

The complete arguments of every run are in `tests/scripts/snapshots/06/suite.json`.

No script of the group is left unconverted.

27 scripts in 2.7.9: 15 are successors of the 16 packages converted from 2.7beta1 (task T078,
recheck of `scripts/06_cleanup/`; the 2.7beta1 conversion is in conversion-notes-b.md, group
06), 12 are new (T050, conversion-notes-279-a.md). Outcomes: 10 updated (02, 04, 05, 06, 07, 08,
10, 12, 19, 20), 5 unchanged (03, 14, 15, 16, 21), 1 without a 2.7.9 counterpart of its own and
kept as it is (17; FR-027). The ids and folders are unchanged.

**Names and icons.** `name.ru` and `undoLabel.ru` are the 2.7.9 file names; 12, 15, 16, 19, 20
and 21 were renamed there, and their English names follow. Every package gained `name.uk` and
`description.uk`. 2.7.9 has an icon of its own for 15 (a new one), 16, 19 and 20 (none before):
the packages carry them, converted with the audit tool's `ico_to_png` as the skeletons were (16's
is 2.7beta1's icon of 15, as in 2.7.9).

**Origin.** The updated packages name their 2.7.9 original in `legacy` and keep its notice in
`index.js`. Their `sourceVersion` is the version the script states and shows: `VersionNumber`
(02 2.7, 04 2.3, 05 3.3, 07 2.3, 08 1.8, 10 2.6, 12 1.3), `versionStr` (06 4.5) or the dialog's
version (19, 20: 1.5). The inventory has the first line of the change log for 04, 05, 07, 08 and
10 (1.2, 1.1, 1.1, 1.2, 1.1: the audit's patterns do not know `VersionNumber`) and none for 06,
12, 19 and 20; the group's record carries the right values. The unchanged packages and 17 keep
their 2.7beta1 `legacy` (`fbeVersion` "2.7").

**JScript's \s and .** The updated packages whose expressions come from their original (02, 04,
05, 07, 08, 10) now compile them through `lib/jscript-regexp.js`, copied unchanged from the
packages of T050: `\s` is `[\t\n\v\f\r ]` and `.` is `[^\n]` as in the originals' engine. The
2.7beta1 conversions used ECMAScript's meaning, which also takes U+00A0 typed as a character and
the other Unicode spaces for spaces. On the books of the existing snapshots this changes nothing
(they hold no such characters); in *Генеральная уборка*, whose new rules replace Unicode spaces
after the old ones have run, it does (see 02). The unchanged 14 keeps its expressions as converted.

**Proverbs.** None of the rechecked originals carries the list of wartime proverbs (only 68 and 71
do, converted in T050); "Курске" in 10 is a proper name of its dictionary.

**Reference books** (new, `tests/scripts/fixtures/279/06/`, valid against `FictionBook.xsd`):
`general-cleanup-279.fb2` (02), `interactive-279.fb2` (04, 10), `paragraph-breaks.fb2` (06),
`win1252.fb2` (19, 20). **Snapshots:** 9 added in `tests/scripts/snapshots/06/` and its
`suite.json`, 1 re-recorded (`general-cleanup.conv-b-06.xml`); every other snapshot of the 16
packages passes unchanged. Each expected result was worked out from the 2.7.9 original before the
run. For 02 a scratch oracle ran the original's own `HandleP` (read from the 2.7.9 file and
executed with JScript's `\s` and `.`) on every block of `conv-b-06.fb2`, `marks-006.fb2` and
`general-cleanup-279.fb2`: the package's rules give the same HTML and the same counters on every
block, and the snapshots equal the oracle's result; run on 2.7beta1's file, the oracle also gives
the old `conv-b-06` snapshot, block for block.

### 02 Генеральная уборка

`scripts/06_cleanup/02_general-cleanup`, id `06/general-cleanup`: **updated** from version 2.3
to 2.7 (jurgennt, Sclex, Faiber, Golma; 2.3 to 2.5 by TaKir). What 2.7.9 changed in the rules:

- the ellipsis rule (re06, three dots or ",.." to "…") is switched off, so "троеточием..." stays;
- re44 is switched on: the spaces before a note link go ("ссылкой <a type=note>[1]</a>" becomes
  "ссылкой[1]");
- a title ending in "?..", "!.." or "?!." keeps its final dot (re84's exception gains `[?!]\.?`);
- re85 adds the missing space after a comma or semicolon before one lower-case letter (it needed
  three);
- 55 new rules (92-149; 100, 129 and 130 are switched off there), applied after the old ones and
  counted by matches: soft hyphens and the literal "&shy;", invisible characters (U+200B-U+200E,
  U+2060, U+FEFF, U+202B, U+2028, U+2029, U+FFFC, U+0323, private use U+E06E), Unicode spaces made
  normal or non-breaking (U+2000-U+200A, U+202F, U+E088, U+F04A), apostrophes ’ ‘ ´ ʼ ′ ˙ ΄ made
  ', an ellipsis stuck to a word ("Ну…и" to "Ну… и"), "!…", "?…", ",…" and "?..." made "!..",
  "?..", ",.." and "?..", " amp; " made " & ", "▫-", "□-", "◦-", "─", U+2010, U+2011 and U+2015 made
  hyphens or dashes, и with a combining breve made й, ˚ ̊ º ⁰ made °, ĸ made к, ë made ё, doubled
  <STRONG> tags, and "crooked" note links: a link whose address holds "#http" (re105) and a note
  link whose text holds no bracket (re106) become their text after a space;
- the statistics: new lines, capitalised labels, and the heading "Статистика" shown only for some
  counters (2.7.9 leaves out 83 and the new ones but 121 and 122); the message reads «Генеральная
  уборка» v.2.7 Golma+TaKir Edition 2025.

Ported: `rules.js` holds 2.7.9's 134 rules in its order, read mechanically from the original
(expressions, replacements, conditions, counters; a comparison with the old table found exactly
the changes above in the shared rules), compiled with JScript's meaning of `\s` and `.`; `index.js`
writes the statistics as 2.7.9 does (2.7beta1's conversion also showed the unlabelled counter 08).
Junk ids are now also removed from the annotation's and the history's paragraphs, as the original
did with every `<P>` of the page. The index keeps 2.7.9's notice.

Snapshots: `general-cleanup.conv-b-06.xml` **re-recorded**, its expected result changed in two
paragraphs: "— Диалог … троеточием..." keeps its three dots, and "Пауза... - потом тишина." stays
as it is (re13, which made the dash, needs "…"). `general-cleanup.marks-006.xml` stays (same result
in 2.7.9). Added `general-cleanup.279.xml` on `general-cleanup-279.fb2`: the annotation loses its
junk id, the space before its comma and its apostrophes ("Аннотация, с … 'таким'."); the history's
thin space becomes a space; "Он сказал... и замолчал. Неужели?.. Да. Что?.. Нет. Итак,..
продолжим."; "ссылкой[1] и маркер без скобок 2, а также кривая  ссылка и обычная <a>ссылка</a>."
(re44, re106, re105 with its added space; the external link stays); "Запятая, и точка с запятой; а
цифра 1, а и слово, которое."; "Д'Артаньян сказал: 'да' … 55°45'20″" (re22 writes the primes, re94
makes the first an apostrophe); "до  после" keeps two spaces (JScript's `\s` does not take the
em space for a space, so the double-space rules do not see it before re132 makes it one;
ECMAScript's meaning would have given one space), the other spaces and invisible characters as
listed above; "Noёl", "йод", "20°, 25°, 30°, 40°"; in the poem "Строка стиха" (re96, re80 leaves
stanzas alone) and "Вторая строка —" (re19); the titles "Ты кто?!." and "СССР: вернуться в
детство?.." keep their dots, "Глава вторая" loses it. No differences from 2.7.9 in what is
changed. **Open questions:** re106 unformats every note link whose text holds no bracket, a plain
"1" or "*" included, although its comment speaks of letter markers whose note is a web address -
limit it so that books with unbracketed note markers keep their links? re94 also changes
apostrophes and primes in Latin text and after re22/re23, and re149 turns every ë, and Ë, into a
lower-case ё (Noël becomes Noёl) - spare Latin text?

### 03 Латиница в Кириллице

`scripts/06_cleanup/03_latin-to-cyrillic`, id `06/latin-to-cyrillic`: **unchanged** (the same
file in both). Gained uk *Латиниця в кирилиці*. Snapshot `latin-to-cyrillic.conv-b-06.xml` stays.
Differences kept from 0.0.1: the rule "6 → б" is used as intended (`[^\d]`; the original's string
literal lost the backslash, `[^d]`, and 2.7.9 kept it), and the annotation is not processed
(`doc.replaceAll` covers the bodies).

### 04 Фамилия И. О.

`scripts/06_cleanup/04_surname-initials`, id `06/surname-initials`: **updated** from 2.2 to 2.3.
2.7.9 changed the pattern of "Пётр I" (re70): the numeral is one or more of I, V, X, and what
follows it must start with a character that is neither a letter, a digit nor a dash, or be
nothing (it was one numeral letter followed by at least one character). So "Пётр I" at the end of
a paragraph is found, "Карл XII" is offered whole (and remembered whole), and "Tom Victor" or
"Людовик XIV-й" are no longer offered. Also the version in the result message and the notice
("Автор скрипта - jurgennt"). Ported; all seven expressions now compile with JScript's `\s` and
`.` (the six others are 2.7beta1's, unchanged). uk *Прізвище І. П.*

Snapshots `surname-initials.conv-b-06.xml` and `.marks-006.xml` stay ("Пётр I." matches both
patterns alike). Added `surname-initials.279.xml` (`interactive-279.fb2`, caret in "Царь Пётр I"):
two questions, "Пётр I" and "Карл XII", accepted with their proposals: "Царь Пётр I", "Король
Карл XII, шведский."; "Привет от Tom Victor." and "Людовик XIV-й правил долго." are not asked
about. Difference kept from 0.0.1: started with the caret in the annotation, the original went
through the annotation and the history before the bodies; the conversion starts at the first
paragraph of the bodies.

### 05 Слипшиеся слова

`scripts/06_cleanup/05_stuck-words`, id `06/stuck-words`: **updated** from 2.92 to 3.3. 2.7.9
fixed two branches past the tenth replacement of a paragraph (`sobCol[sv4]`, an undeclared
variable, and `k && sobCol[v5]==null>=10`, which never asked and looped) and the highlight's
offsets; the conversion, which has no limit of ten placeholders and measures the place on the
plain text, already behaved so. Ported: the version in the result message, the notice (with
"Автор скрипта - jurgennt"), the expressions with JScript's `\s` and `.`. uk *Злиплі слова*.
Snapshots `stuck-words.conv-b-06.xml`, `.marks-006.xml` stay (the book is changed as before).
Differences kept from 0.0.1: the re20 branch uses its own head of the paragraph (the original's
`sl1` for `sl2`, still in 2.7.9); the prefix `^(.*?)` (a place at the very start of a paragraph
keeps its first letter); the annotation and the history.

### 06 Управляемое исправление разрывов абзацев...

`scripts/06_cleanup/06_guided-paragraph-breaks`, id `06/guided-paragraph-breaks`: **updated** from
3.8 («Интерактивная ликвидация разрывов абзацев») to 4.5, with its two dialogs (*… - выбор
режимов.html*, *… - сомнительные места.html*). What 2.7.9 changed, all ported:

- the letters: lower and upper case are 2.7.9's long lists of many scripts (Latin with
  diacritics, Greek, Cyrillic beyond Russian, Armenian, Georgian, Glagolitic, Coptic, Cherokee,
  fullwidth...), copied into `letters.js` as written, instead of `[а-яёa-z]` and `[А-ЯA-ZЁ]`;
- a paragraph holding a picture is no longer an empty line (its HTML still has the `<IMG>`); it
  stays, and with nothing to end it, a following paragraph that starts lower-case is a class-7
  place;
- a class-7 place asked by hand is offered its own actions (2.7beta1 listed it under class 1 and
  offered class 1's); 2.7.9 also marks a place of class 2 or 3 asked by hand as settled, which
  changes nothing, as no later class can apply to it;
- class 7 now takes a closing quote after one of ?.!… (2.7beta1 required the opposite, against
  its dialog's own description): «Привет!» / сказал он is a place, Он сказал «привет» / и ушёл no
  longer;
- the actions: 6 removes the hyphen or dash and joins with a space (it joined without one), 9 joins
  with a space and makes the first letter of the second paragraph lower-case, 10 adds ":" and
  joins, 11 adds ":" (2.7beta1's dialogs had ":" as 9 and 10, which its automatic pass ignored),
  12 joins without a space keeping the hyphen or dash (2.7beta1's "Соединить без пробела, сохранив
  тире/дефис" was action 8, which removed it);
- the options of each class and their labels, as both 2.7.9 dialogs give them (class 3 gains 9,
  class 4 gains 6, class 5 offers 12, 7, 6, 8, class 2 gains 11 and 9), the descriptions of the
  first dialog's switches and classes, its title («Управляемое исправление разрывов абзацев
  v4.5»), the second dialog's «Предположительных разрывов», the result message (*Исправление
  разрывов абзацев завершено*, *Произведено автоматических слияний…*, the times of the automatic
  and of the manual processing).

uk *Кероване виправлення розривів абзаців...* Snapshot `guided-paragraph-breaks.conv-b-06.xml`
stays: its places and their automatic actions (1, 8, 2, 3) mean the same in 2.7.9. Added on
`paragraph-breaks.fb2`: `guided-paragraph-breaks.auto.xml`, every class automatic with a new action
(1 → 10, 2 → 9, 3 → 9, 4 → 6, 5 → 12, 6 → 1, 7 → 1): "Сказал так: приходи завтра.", "Он пришёл
вечером всё стихло.", "Он сказал, что придёт.", "Абзац с запятой, а дальше маленькая буква.", "Он
стоял у окна.", "Северо-запад.", "Шёл дождь — и ветер.", "«Привет!» сказал он.", "Он сказал
«привет»" / "и ушёл." untouched, "Мы пили кофе в café: и говорили." (é is a lower-case letter:
class 1), "Мы приехали в город évreux вечером." (É is a capital: class 2), and the picture's
paragraph kept, with "и текст после." joined to it, "Текст до картинки" untouched; 11 automatic
actions. `guided-paragraph-breaks.manual.xml`, classes 3 and 7 by hand, the others left: four
places, answered "Он сказал." (3), "Абзац с запятой, а дальше…" (1), "«Привет!» сказал он." (1)
and the picture's place left (0); 3 corrections confirmed by hand (2.7beta1 would have asked about
three: the two commas and, under class 1, "Он сказал «привет»" / "и ушёл."). Differences
kept from 0.0.1: the modes dialog is one form (a choice per class of "Ручной выбор" or an action,
so a place asked by hand starts on "Не трогать", the original's default, where the original's
separate box let the class's radio buttons preselect it), and the second dialog is one form per
place, "Прекратить" leaving the rest as it is. No fixes.

### 07 10.000.000.000

`scripts/06_cleanup/07_large-numbers`, id `06/large-numbers`: **updated** from 2.12 to 2.3. 2.7.9
fixed the highlight's offset for entities, already the conversion's behaviour. Ported: the result
message as written in 2.7.9 (and 2.7beta1), «Большие числа» v.2.3 with the dot after the time (the
0.0.1 conversion had written «10.000.000.000»), the notice, the expressions with JScript's `\s` and
`.`. uk name *10.000.000.000*. Snapshots `large-numbers.conv-b-06.xml`, `.marks-006.xml` stay.
Differences kept from 0.0.1: the prefix `^(.*?)`; the annotation.

### 08 Дефис - Тире

`scripts/06_cleanup/08_hyphen-vs-dash`, id `06/hyphen-vs-dash`: **updated** from 1.62 to 1.8: the
highlight's fix as in 07 (already the conversion's), the version in the result message, the
notice, the expression with JScript's `\s` and `.`. The word lists are unchanged. uk *Дефіс - Тире*.
Snapshots `hyphen-vs-dash.conv-b-06.xml`, `.marks-006.xml` stay. Differences kept from 0.0.1: the
prefix `^(.*?)`; the annotation.

### 10 Точка.

`scripts/06_cleanup/10_missing-full-stop`, id `06/missing-full-stop`: **updated** from «Точка.
Точка, запятая» 1.9 to «Точка.» 2.6. 2.7.9 reads the paragraph's `&nbsp;` as the character and finds
a place also when a non-breaking space separates the lower-case word from the capitalised one; the
proposal keeps the separator as typed (re11 "$2$3$4$5$6"). It also drops its debugging `alert`, the
empty names of its dictionary and the limit of ten placeholders per paragraph (none of which the
conversion had). Ported: the expression (with JScript's `\s` and `.`), the reading and writing back
of `&nbsp;`, the result message and the notice. uk *Крапка.* Snapshots
`missing-full-stop.conv-b-06.xml`, `.marks-006.xml` stay (no non-breaking spaces there). Added
`missing-full-stop.279.xml` (`interactive-279.fb2`, caret in "Он пришёл домой Было поздно."):
the place "домой Было" is asked about and answered "домой. Было". Differences kept from 0.0.1:
the prefix `^(.*?)`; the annotation.

### 12 Удалить возвратные ссылки, созданные FBD

`scripts/06_cleanup/12_remove-back-links`, id `06/remove-back-links` (2.7beta1 *12_Удаление
возвратов*): **updated** from 1.2 to 1.3. 2.7.9 says «раздел» where it said «секция» in its warning
about notes sections with not exactly one back link, and ends its result message with the run time
instead of 2.7beta1's list of binaries (which named variables of another script and failed). Ported
(the English texts already said "section"). en *Remove the back links made by FBD*, uk *Видалити
зворотні посилання, створені FBD*. Snapshot `remove-back-links.conv-b-06.xml` stays (only texts
changed). **Fix:** 2.7.9 appends the time twice ("Время выполнения: 0.01 сек.0.01 сек", where the
list was); the package shows it once, and leaves out the stray quotation mark before «Удалено» of
both originals as 0.0.1 did. Difference kept from 0.0.1: only the links matching `^_ftnref` or
`^_ednref` are removed (the original's counter is never reset inside a notes section, so every link
after the first back link went too; 2.7.9 kept it).

### 14 Разрыв предложения

`scripts/06_cleanup/14_broken-sentences`, id `06/broken-sentences`: **unchanged** (the same file).
Gained uk *Розрив речення*. Snapshots `broken-sentences.conv-b-06.xml`, `.marks-006.xml` stay. Its
expressions keep ECMAScript's `\s` as converted in 0.0.1 (a difference only for U+00A0 typed as a
character and the other Unicode spaces).

### 15 Точка, тире, буква в нижнем регистре...

`scripts/06_cleanup/15_dot-dash-letter`, id `06/dot-dash-letter` (2.7beta1 *15_Точка, тире,
буква...*): **unchanged**: 2.7.9 renamed the script and its dialog files; the frames are the same
but for the names of their stylesheets, and the dialog's title is still *Точка, тире, буква v1.3*.
en *Full stop, dash, lower-case letter...*, uk *Крапка, тире, літера в нижньому регістрі...*; the
icon is 2.7.9's new one. Snapshot `dot-dash-letter.conv-b-06.xml` stays.

### 16 Точка, тире, буква в нижнем регистре (без поиска многоточий)...

`scripts/06_cleanup/16_dot-dash-letter-no-ellipsis`, id `06/dot-dash-letter-no-ellipsis`:
**unchanged**, renamed as 15; it gained 2.7.9's icon (2.7beta1's icon of 15). en *Full stop, dash,
lower-case letter (without searching for ellipses)...*, uk *Крапка, тире, літера в нижньому регістрі
(без пошуку трикрапок)...* Snapshot `dot-dash-letter-no-ellipsis.conv-b-06.xml` stays.

### 17 Превращение внешних ссылок в текст

`scripts/06_cleanup/17_external-links-to-text`, id `06/external-links-to-text`: **no 2.7.9
counterpart** by the pairing review (T019, `pairing-overrides-279.json`: null), kept as converted
(FR-027; inventory entry `fbeVersion` "2.7"). Gained uk *Перетворення зовнішніх посилань на текст*;
code, name and undo label unchanged. Snapshot `external-links-to-text.conv-b-06.xml` stays.

**Open question (for the requester).** 2.7.9's *17_Превратить внешние ссылки в текст.js*, converted
in this feature as `06/external-links-to-plain-text`, is this script's later version: its header
names the same script («Превращение внешних ссылок в текст», Sclex, version 1.2 against 1.0), it
stands at the same place 17, and it keeps the undo label, the expression `^ *?(file://|#)` and the
loop over `document.links`; it adds the links whose address holds "#http:" or "#https:" (the
expression `# *https?:`) and a message with the count. Under the recheck rules this package would
follow it - status updated, id kept (FR-028) - and `06/external-links-to-plain-text`, never
released, would leave the menu, its conversion and its snapshot becoming this package's; one entry
would then stand at place 17, under 2.7.9's name, and 2.7.9's *Автоматическая чистка простых
текстов*, which runs `06_Чистка\17_Превратить внешние ссылки в текст.js`, would reach it through
`legacy.source`. That reverses a recorded review decision (and T078's wording) and removes a package
of T050, and the rules allow one entry only by dropping one of the two converted packages; so
nothing was changed, and both stay at place 17 until the requester decides.

### 19 Символы win-1252, истолкованные как win-1251 ('cafй' и т.п.) (поиск отдельных букв)...

`scripts/06_cleanup/19_win1252-letters`, id `06/win1252-letters` (2.7beta1 *19_Символы win-1252
(буквы)...*): **updated** to the dialog's version 1.5 (*HTML/Символы win-1252, истолкованные как
win-1251 - набор фреймов.html* and its frames). What 2.7.9 changed: a button *Заменить все от
текущей позиции до конца документа* replaces the place and every later one with their proposals
(the text field is not used) and reports *Произведены автоматические замены такого количества
букв: N.*, or *От текущей позиции до конца документа больше ничего не найдено.* when nothing
followed the place; the end of the search says *Больше ничего найти не удалось.*; the title; Enter
in the field replaces with its text (a form's Enter is its OK, whose default action is that one);
the caret inside formatting, at the start of a paragraph and
soft hyphens are measured right (the conversion works on the block's plain text and its offsets,
so this was its behaviour already). Ported in the shared engine `win1252.js` (identical in 19 and
20): the action *Заменить все…* in the form, the texts and the title. The icon is 2.7.9's.
en *win-1252 characters read as win-1251 ('cafй' etc.) (search for single letters)...*, uk
*Символи win-1252, витлумачені як win-1251 ('cafй' тощо) (пошук окремих літер)...*

Snapshot `win1252-letters.conv-b-06.xml` stays. Added `win1252-letters.all.xml` (`win1252.fb2`, caret
at the start, *Заменить все…* at the first place): all nine letters recoded, "Слова café и Zürich,
затем München и ещё naïve." and "Ещё Götterdämmerung и crème brûlée на десерт.", message "…букв: 9."
Differences kept from 0.0.1: a form per place instead of the three frames, the field holding plain
text (the original accepted and checked formatting tags in it); Ѓ, Ќ, Џ, ђ and ќ, whose windows-1252
bytes are undefined, are not searched for.

### 20 Символы win-1252, истолкованные как win-1251 ('cafй' и т.п.) (поиск слов)...

`scripts/06_cleanup/20_win1252-words`, id `06/win1252-words` (2.7beta1 *20_Символы win-1252
(слова)...*): **updated** as 19 (the same dialog; *…в таком количестве слов: N.*). 2.7.9 also
reworked its search engine: tags may now stand before the first letter of a match and the tag
groups are greedy (only the HTML around the word differs), the look-behind looks at one character,
and the search starts one character before the caret, where 2.7beta1 started one after a collapsed
caret: a word whose first letter is right before the caret is found. The conversion searches the
plain text, so only the start differs; ported: a search for words starts one character before the
caret. The icon is 2.7.9's. en *win-1252 characters read as win-1251 ('cafй' etc.) (search for
words)...*, uk *Символи win-1252, витлумачені як win-1251 ('cafй' тощо) (пошук слів)...*

Snapshot `win1252-words.conv-b-06.xml` stays. Added on `win1252.fb2`: `win1252-words.all.xml`
(*Заменить все…* at the first word: the seven words recoded, "…слов: 7."), `win1252-words.caret.xml`
(caret after the "c" of "cafй": the first place is "cafй", replaced with its proposal, then Exit:
only "café" changes; 2.7beta1 began with "Zьrich"), `win1252-words.all-last.xml` (caret before
"brыlйe", *Заменить все…*: only "brûlée" changes, message *От текущей позиции до конца документа
больше ничего не найдено.*). Differences kept from 0.0.1: as 19, and a mixed word at the very start
of a paragraph is found too (the original's look-behind needs a character before it).

### 21 Удалить теги style

`scripts/06_cleanup/21_remove-style-tags`, id `06/remove-style-tags` (2.7beta1 *21_Удаление тегов
style*): **unchanged** (the same code). Renamed: ru and undo label *Удалить теги style*, uk
*Видалити теги style*. Snapshots `remove-style-tags.conv-b-06.xml`, `.marks-006.xml` stay.

### Harness commands

```bash
export MFBE_CORE_BIN=... MFBE_UI_DIST=...
tests/scripts/run-all.sh --group 06      # every snapshot of the group, the 9 added ones of snapshots/06/suite.json among them
G=scripts/06_cleanup; F=tests/scripts/fixtures/279/06; S=tests/scripts/snapshots/06; NB=$'\xc2\xa0'
node tests/scripts/run-script.mjs $G/02_general-cleanup tests/scripts/fixtures/books/conv-b-06.fb2 --snapshot $S/general-cleanup.conv-b-06.xml   # re-recorded with --update
node tests/scripts/run-script.mjs $G/02_general-cleanup $F/general-cleanup-279.fb2 --snapshot $S/general-cleanup.279.xml
node tests/scripts/run-script.mjs $G/04_surname-initials $F/interactive-279.fb2 --select n5:0:0 --answer "Пётр${NB}I" --answer "Карл${NB}XII" --snapshot $S/surname-initials.279.xml
node tests/scripts/run-script.mjs $G/06_guided-paragraph-breaks $F/paragraph-breaks.fb2 --answer '{"case1":"10","case2":"9","case3":"9","case4":"6","case5":"12","case6":"1","case7":"1"}' --snapshot $S/guided-paragraph-breaks.auto.xml
node tests/scripts/run-script.mjs $G/06_guided-paragraph-breaks $F/paragraph-breaks.fb2 --answer '{"case1":"0","case2":"0","case3":"manual","case4":"0","case5":"0","case6":"0","case7":"manual"}' --answer '{"action":"3"}' --answer '{"action":"1"}' --answer '{"action":"1"}' --answer '{"action":"0"}' --snapshot $S/guided-paragraph-breaks.manual.xml
node tests/scripts/run-script.mjs $G/10_missing-full-stop $F/interactive-279.fb2 --select n12:0:0 --answer "домой. Было" --snapshot $S/missing-full-stop.279.xml
node tests/scripts/run-script.mjs $G/19_win1252-letters $F/win1252.fb2 --select n5:0:0 --answer '{"action":"all"}' --snapshot $S/win1252-letters.all.xml
node tests/scripts/run-script.mjs $G/20_win1252-words $F/win1252.fb2 --select n5:0:0 --answer '{"action":"all"}' --snapshot $S/win1252-words.all.xml
node tests/scripts/run-script.mjs $G/20_win1252-words $F/win1252.fb2 --select n5:7:7 --answer '{}' --answer cancel --snapshot $S/win1252-words.caret.xml
node tests/scripts/run-script.mjs $G/20_win1252-words $F/win1252.fb2 --select n6:28:28 --answer '{"action":"all"}' --snapshot $S/win1252-words.all-last.xml
```

## 07_Символы

9 scripts in 2.7.9: 2 new, 7 successors of converted packages. Not yet converted or rechecked.

## 08_Структура разделов

6 scripts in 2.7.9: 4 new, 1 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 09_Стихи

10 scripts in 2.7.9: 7 new, 3 successors of converted packages. Not yet converted or rechecked.

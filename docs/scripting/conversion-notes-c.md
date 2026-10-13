# Conversion notes - groups 13, 16, 17, 18, 19, 20, 21, root script 29 and the tree command

Scope: tasks T120-T126 - the legacy FictionBook Editor scripts of the groups
`13_Подзаголовки, пустые строки`, `16_Поиск форматирования`, `17_Перенос примечаний в скобки`,
`18_Мелочи редактирования`, `19_Обработка форматирования`, `20_Инструменты отладки`,
`21_Поиск и замена`, the root script `29_Режим чтения.js` and `TreeCmd/Пример 1.js`.
Every package lives in `scripts/<group>/<original file name>/` with `legacy.source` set; ids are
`<NN>/<slug>`. Fixture books: `tests/scripts/fixtures/books/conv-c-{13,16,17,18,19,21}.fb2`
(all valid FB2 2.1 per `mfbe-core validate`; groups 20 and `tree` reuse `conv-c-16.fb2`) plus
`conv-c-17-comments.fb2`, a deliberately legacy-shaped book with a third `comments` body (the
bundled 2.1 schema allows one notes body only, but FBE books with comments bodies exist and the
group-17 scripts handle them). Snapshots: `tests/scripts/snapshots/<NN>/<slug>…xml`.
No reference output of the original editor was available: expected results were derived from a
line-by-line reading of the legacy sources (`FBE/files/Scripts`, `FBE/fb2.xsl` for the HTML the
scripts saw, `FBE/main.js` for the host helpers) and checked by hand on the fixtures.

## General differences (all groups)

- **Empty lines.** FBE rendered `<empty-line/>` as an empty `<p>`; the model has a distinct
  `empty-line` node. Scripts that tested "is this paragraph empty" treat both an `empty-line`
  and a text block containing only spaces / non-breaking spaces as empty.
- **Non-breaking spaces.** FBE displayed U+00A0 as a configurable character and gave it to
  scripts through `GetNBSP()`; the model holds the real U+00A0, so all `nbspChar` logic became
  a literal `\u00A0`.
- **Inline "elements".** Formatting is stored as marks, so an `<emphasis>` element becomes a
  maximal run of text carrying the mark. Two adjacent elements of the same kind
  (`<sup>3</sup><sup>4</sup>`) are one run in the editor; counts and navigation treat them as one.
- **Book annotation / history.** FBE's `fbw_body` included the description's annotation and
  history; `mfbe.doc` exposes bodies only, so those two blocks are not touched.
- **Schema checks.** The editor validates every structural edit. Where the original produced
  invalid FB2 (a `<subtitle>` inside an epigraph, a `<p>` appended after sub-sections, an empty
  `<section/>`, a `<title>` in the middle of a section) the converted script skips the edit and
  reports it, or performs the closest valid variant (documented per script below).
- **Language.** `ctx.uiLanguage` selects Russian or English messages; the legacy Russian texts
  are kept verbatim for `ru`.
- **Shared code.** The sandbox only loads modules from the script's own folder, so a group's
  engine file is copied into every package of the group (identical copies: `format-search.js`
  ×24, `subtitles-lib.js` ×4, `notes-lib.js` ×3, `move-all.js` ×2, `strip-lib.js` ×2,
  `sup-brackets.js` ×2, `regexp-search.js` ×2).

## 13_Подзаголовки, пустые строки (T120, Tier 2) - 4 scripts, one engine

| Package | id | Flags |
|---------|----|-------|
| 525_Разметка подзаголовков, чистка пустых строк | `13/subtitles-empty-lines` | - |
| 526_…, удаление жирности в заголовках | `13/subtitles-empty-lines-unbold-titles` | strip `strong` in titles |
| 527_…; удаление жирности в заголовках по запросу | `13/subtitles-empty-lines-ask-unbold-titles` | Yes/No question first |
| 528_…, удаление жирности и курсива в заголовках | `13/subtitles-empty-lines-plain-titles` | strip `strong` + `emphasis` |

The engine reproduces both passes of the original (`Recursive`: subtitle markup and empty-line
cleanup with the "first empty line / image at section start" bookkeeping; `Recursive2`: merging
"* * *" sections into the previous sibling) over the JSON model, mirroring each removal /
replacement to the editor. Differences:
- only `p` (and existing `subtitle`) lines are turned into `* * *` subtitles; a `<v>` made of
  asterisks is left alone (a subtitle between verses is invalid), the original changed any `<P>`;
- a "* * *" section is merged only when the previous section does not end with sub-sections and
  the merged content consists of blocks; otherwise it is counted under "not merged";
- the final report prints the correct "end of cite" counter (the original printed the "start of
  cite" counter twice) and lists skipped edits;
- the body's own title is cleaned like the original (it walked the body too).
Snapshots: `13/subtitles-empty-lines.xml`, `…-unbold-titles.xml`, `…-ask-unbold-titles.xml`
(answer yes), `…-ask-unbold-titles.no.xml` (answer no, identical to 525),
`…-plain-titles.xml`. Verified: 26 removals in the fixture, each traced to the legacy rule.

## 16_Поиск форматирования (T121, Tier 1) - 24 scripts, one engine

Slugs: `16/{previous,next}-{emphasis,strong,sup,sub,strikethrough,code}` and
`16/{previous,next}-paragraph-with-<mark>`; folders keep the original names (the typo in
`13_Переход на предыдующий нижний индекс` is kept in the folder and `legacy.source`, the menu
name reads «предыдущий»). Icons converted for 01/02/05/06.

Behaviour: the caret moves to the start (forward) / end (backward) of the next / previous run of
the mark; the "paragraph" variants start from the next / previous block, i.e. jump to the next
paragraph containing the mark. A run starting exactly at the caret counts as the current one and
is skipped, exactly like the original's marker walk did, so repeated runs progress. At the end /
beginning of the book the original's `confirm` ("Достигнут конец документа. Продолжить поиск с
начала документа?") is a Yes/No message box; "Ничего не найдено, поиск завершен." when there is
no run at all. A sticky status "Found: italics" / «Найдено: курсив» is added (the original had
no status). The document is never changed, so every snapshot equals the input.

Verification: `run-script.mjs` does not expose the resulting selection, so the 24 scripts were
run with a private copy of the harness that additionally prints `window.getSelection()` and the
status bar after the run (`--select n9:5:5 --answer yes` on `conv-c-16.fb2`). Results, all as
predicted from the legacy logic: next-emphasis → n12 (nested italics inside bold),
previous-emphasis → end of «вторым курсивом» (n8), next-paragraph-with-strong → n12 (the bold in
the caret's own paragraph is skipped), previous-strong / -sup / -sub / -strikethrough / -code
wrap after the question and land on the last run of the book (n36, n28, n26, n27, n26),
next-sup → n9:24, next-paragraph-with-sup → the epigraph's text-author n19, next-sub → n11:8,
next-strikethrough → n11:25, next-code → n11:40. Additional spot checks: wrap-around «no»
leaves the caret in place; a backward search from the end of a run skips that run.

## 17_Перенос примечаний в скобки (T122, Tier 2) - 3 scripts

| Package | id |
|---------|----|
| 01_Перенос примечаний в скобки | `17/notes-into-brackets` |
| 02_… (пробел перед открывающей скобкой) | `17/notes-into-brackets-with-space` |
| 03_Перенос одного примечания в скобки | `17/one-note-into-brackets` |

01/02 replace every reference (note links inside notes/comments bodies first, then every link of
the other bodies, last to first) by the note text in `[…]` (notes) or `{…}` (comments): the
note's lines joined with " // ", keeping emphasis / strong / sup / sub / strikethrough / code and
ordinary links, dropping note links, styles and images, inserted without the formatting that
surrounded the reference (the original closed/reopened the enclosing tags). 03 does it for the
note under the caret, removes its section and renumbers the remaining notes and comments
(ids `n_N`/`c_N`, titles `N`, link texts `[N]` / superscript `{N}`; a body gets a title when it has
none; nested sections in a notes body abort the renumbering with the original's message).
**API gap:** `mfbe.doc.removeNode` refuses bodies ("a body cannot be removed"), and the last
section of a body cannot be removed either, so the original's wholesale deletion of the
notes/comments bodies is impossible. The scripts try it, then remove the inlined note sections
one by one and tell the user that the rest must be deleted in the Document Tree (needed API:
removing a body, e.g. `doc.removeNode(bodyRef)` allowed when at least one body remains).
Snapshots: `17/notes-into-brackets.xml`, `17/notes-into-brackets-with-space.xml`,
`17/one-note-into-brackets.xml` (`--select n26:3:3`, caret in note 2) on `conv-c-17.fb2`;
`17/notes-into-brackets.comments.xml` and `17/one-note-into-brackets.comments.xml` on
`conv-c-17-comments.fb2`. Verified: nested note-in-note inlining, comment braces, plain links
into the notes body, broken links left alone, renumbering of ids / titles / link texts after
removing note 2, the comments body left untouched by the renumbering when already in order.

## 18_Мелочи редактирования (T123) - 9 scripts

| Package | id | Tier | Notes |
|---------|----|------|-------|
| 01_Удаление пробелов | `18/remove-spaces` | 1 | spaces + U+00A0 removed from the selection, marks kept, text re-selected |
| 02_Вставить ссылку на midi... | `18/insert-midi-link` | 3 | `links.htm`/`диалог вставки ссылки на midi.htm` → `ui.form` (file name box); selection → `<a l:href="file:NAME"><sup>…</sup></a>`; no file picker in the sandbox (typed name); `needsSelection` |
| 03_Снятие форматирования стихом, цитатой или эпиграфом | `18/unwrap-poem-cite-epigraph` | 2 | the innermost poem/cite/epigraph around the caret is dissolved; verses, text-authors, dates (and the poem title lines, which the original left as an invalid mid-section `<title>`) become `p`; a section epigraph's lines go to the start of the block area (after remaining epigraphs/image/annotation); refused with a message for body-level epigraphs / epigraphs inside poems |
| 04_Вставить пустую строку перед стихом или цитатой | `18/empty-line-before-poem-or-cite` | 2 | `empty-line` before the poem/cite at the selection start |
| 05_Вставить пустую строку за стихом, эпиграфом или цитатой | `18/empty-line-after-poem-epigraph-or-cite` | 2 | after the poem/cite/epigraph at the selection end; invalid positions (poem epigraph, body epigraph) reported |
| 06_Удаление пробелов и дефисов | `18/remove-spaces-and-hyphens` | 1 | as 01 plus `-` |
| 07_Обрамить верхние индексы скобками [] | `18/bracket-superscripts-square` | 2 | brackets inside every superscript run of the book; count reported |
| 08_Обрамить верхние индексы скобками {} | `18/bracket-superscripts-curly` | 2 | idem with braces |
| 09_Нумерацию в началах строк - надстрочным текстом | `18/line-numbers-to-superscript` | 1 | in `p`/`v`/`td`/`th` touched by the selection a leading number (plain or with emphasis/strong) followed by spaces becomes superscript, spaces collapse to the first one (a U+00A0 stays U+00A0); subtitles/text-authors skipped; `needsSelection` |

Snapshots (`conv-c-18.fb2`): `remove-spaces.xml` (n7:0:35), `insert-midi-link.xml` (n8:22:29,
`{"file":"song.mid"}`), `unwrap-poem-cite-epigraph.xml` (poem, n25), `….cite.xml` (n33),
`….epigraph.xml` (n16), `empty-line-before-poem-or-cite.xml` (n27),
`empty-line-after-poem-epigraph-or-cite.xml` (n32), `remove-spaces-and-hyphens.xml` (n7:0:60),
`bracket-superscripts-square.xml`, `bracket-superscripts-curly.xml`,
`line-numbers-to-superscript.xml` (n40:0:3). Script 09 over a multi-paragraph selection
(n39…n46, every case of the fixture) was verified with the private harness because
`run-script.mjs --select` selects inside one block only.

## 19_Обработка форматирования (T124, Tier 3) - 1 script

`Обзор и превращение элементов...` → `19/element-browser`. The three-frame HTML dialog becomes
a loop of two `ui.form`s: (1) the kind of element (titles, subtitles, emphasis, strong, sup, sub,
strikethrough); (2) a multi-select list of the elements (numbered 50-character previews like
the original list) plus the action: reformat as titles / subtitles / text / another inline
style (the targets the original offered for that kind), the three case changes of the original
context menu, or "show another kind". After an action the list is rebuilt and shown again until
Close (the modal dialog stayed open in the same way; its Undo/Redo buttons are not needed - the
whole run is one undo step). Implemented rules (see the header comment of `index.js`):
inline → inline/text by rewriting marks; subtitle → text (`p`, a one-verse `stanza` when the
subtitle stood between stanzas, `v` inside a stanza); subtitle → title with the original's
section splitting (content before the subtitle moves to the previous sibling of the same kind
or a new one; a title that would end its section moves/merges into the next sibling, or the
section keeps an `empty-line`; subtitles in cites are skipped with the original's warning);
title lines → subtitles/text with the original's three cases (whole title in place with
following epigraphs dissolved; leading selected lines to the previous sibling; unselected runs
become titles of new sections inserted in front; an emptied title is removed and the rest of
the section merged into the section created before it). Simplifications: the previous sibling is
not searched above the parent (the original climbed to an ancestor's previous section), a
section emptied by the conversion is removed instead of being left as an empty `<section/>`,
schema-rejected edits are reported in a message instead of producing invalid XML.
Snapshots (`conv-c-19.fb2`): `element-browser.titles-to-subtitles.xml`,
`element-browser.titles-to-text.xml`, `element-browser.subtitles-to-titles.xml`,
`element-browser.subtitles-to-text.xml`, `element-browser.inline.xml`, `element-browser.case.xml`
(answer sequences in the snapshot names' runs are listed in the task report; the forms are
answered with `{"kind":…}` then `{"items":[…],"action":…}` and finally `cancel`).

## 20_Инструменты отладки (T125, Tier 4) - 2 converted, 1 dropped

- `01_Показать код` → `20/show-code`: the original showed the HTML of the nearest container of
  the caret in a message box; scripts now see the JSON document model, so the JSON of the
  nearest container (section, title, poem, cite, …) is shown, shortened to 2000 characters.
- `02_Показать весь код` → `20/show-whole-code`: the `debug.htm` window becomes a `ui.form`
  with a multi-line text field holding the complete JSON (copyable).
- `03_Код в буфер` - **dropped**: it copied the HTML of the whole page to the clipboard with
  `window.clipboardData`; the sandbox has no clipboard (FR-144) and the whole-book model can be
  too large for a dialog. The Source view / Save As cover the need. Release-note entry needed.
Snapshots (`conv-c-16.fb2`, unchanged document): `20/show-code.xml` (n23), `20/show-whole-code.xml` (n26).

## 21_Поиск и замена (T124, Tier 1) - 2 scripts, one engine

- `04_Поиск ошибок текста (регекспы от …)` → folder `04_Поиск ошибок текста (набор регэкспов)`,
  id `21/text-error-search`, names "Search for text errors (regexp set)" / «Поиск ошибок текста
  (набор регэкспов)»: the original file name credits the authors of the expressions by nickname;
  the display name and folder omit them (no credits policy), `legacy.source` keeps the original
  file name. The 174 active and 13 commented-out expressions were ported verbatim (the two
  comment lines naming a contributor were removed); their descriptions stay in Russian because
  the expressions only make sense for Russian text.
- `10_Поиск по набору регэкспов (заготовка)` → `21/regexp-set-search-template`: the template with
  the original instructions translated into the header comment and the single placeholder entry
  whose description asks to edit `index.js`.

Engine (`regexp-search.js`): paragraphs are tried from the caret to the end of the book, the
earliest hit of all expressions in the first paragraph that has one is selected and its
description goes to the status bar (sticky); a collapsed caret starts one character further,
a non-collapsed selection at its end; no wrap-around; "От позиции курсора до конца документа
ничего не найдено." at the end. `addRegExp` entries run on the plain text, `tagRegExp` entries on
an HTML-like rendering of the marks (`<EM>`, `<STRONG>`, `<SUP>`, `<SUB>`, `<STRIKE>`,
`<SPAN class=code>`, `<A href=…>`, `<IMG>`) with the original macros; matches ending inside a
tag are discarded as the original did; tag conditions (`+poem -stanza`) use the ancestor types.
The original emulated look-behind by hand; the expressions are compiled with native look-behind
(the leading `(?<=…)`/`(?<!…)` groups applied to the whole rest, as the emulation did) and
without the `u` flag, like JScript. Inline images count as one character (the original mapped
`<IMG>` to `~~~`, three characters, which skewed positions after an image).
Snapshots (`conv-c-21.fb2`, unchanged document): `21/text-error-search.xml` (n7:0:0),
`21/regexp-set-search-template.xml` (n7:3:3). Verified with the private harness: successive
runs from the caret select «пего», «3-4», «рсив» (italics inside a word), the last letter of a
line without a full stop (poem lines excluded by `-poem -stanza`), «nи», the lower-case first
letter of a subtitle, « ,», then "nothing found"; the template moves the caret by one and shows
the instruction.

## 29_Режим чтения.js (T126) - dropped, API gap

The script turned the body view read-only, intercepted clicks (follow a link, Backspace returns),
arrow keys and the mouse wheel to scroll line by line, and left the mode on the next click. All
of that is editor/view behaviour: scripts run to completion in a worker and `mfbe` has no way to
toggle editability, hook input events, scroll by line or navigate to a link target. No package
is shipped (a stub would only show a message). Needed to convert faithfully: a View-level
"reading mode" (or API: `ui.setReadOnly`, event hooks, `selection.scrollBy`), best implemented
as an editor feature. Release-note entry needed.

## TreeCmd/Пример 1.js (T126, Tier 2) → `scripts/tree/example-1`, id `tree/example-1`

The original was an element descriptor for the Document Tree: `ProcessCmd()` wrapped every `<P>`
without a full stop in `<DIV class="abc">`, the tree then listed those paragraphs under
`GetTitle()` = «Пример 1». Tree commands are context-menu entries now, so the script lists the
text blocks without a "." inside the clicked node (whole book without a node) in a `ui.form`
list and selects the chosen one (`selection.selectNode`), reporting the count in the status bar.
Snapshot: `tree/example-1.xml` (`--tree-node n14 --answer '{"target":"n23"}'`, unchanged document).

## Runtime / harness observations

1. `doc.removeNode` cannot remove a body, and the schema check refuses the last section of a
   body: blocks the body deletion of 17/01, 17/02 and the section removal of 17/03 when the note
   is the only one (repro: `await mfbe.doc.removeNode((await mfbe.doc.getElementsByTagName('body'))[1])`
   → "removeNode: a body cannot be removed").
   *Status (T127):* fixed - any body but the first can be removed (the last section of a body
   still cannot); 17/01 and 17/02 now delete the bodies wholesale like the originals and their
   three snapshots were re-recorded. The fallback branch and its message stay in the scripts
   for cores that refuse the call.
2. `tests/scripts/run-script.mjs` hangs when a script fails: the host shows the modal
   `dialog-script-error` before resolving the run promise, and `answerDialogs` stops polling as
   soon as the state is no longer "running". (Private copy used here dismisses the dialog.)
   *Status (T127):* fixed - the harness dismisses the dialog, reports its text and exits 1.
3. `run-script.mjs --select` selects inside one text block only; multi-block selections (18/09)
   cannot be exercised by the committed snapshots.
   *Status (T127):* `--select-range <from>:<offset>-<to>:<offset>` added; the 18/09 run over
   n39…n46 is now the committed snapshot `18/line-numbers-to-superscript.range.xml`.
4. The harness answers a form it has no answer for with `{}` (OK with defaults); for the
   element browser that means "No element is selected" and an endless loop of forms - always
   end its answer list with `cancel`.
5. `ui.form` `list` fields return arrays also for single selection; scripts normalise.

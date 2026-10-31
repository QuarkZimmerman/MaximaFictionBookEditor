# FictionBook Editor 2.7.9 scripts — groups 21 to 99, the root script and TreeCmd (feature 007)

Part of [conversion-notes-279.md](conversion-notes-279.md), whose rules apply. For each group:
the scripts converted (new since 2.7beta1), the packages rechecked against their 2.7.9 version,
the scripts not converted with their reasons, the fixes and the open questions - the same facts
as the group's entries of `tests/scripts/audit/inventory-279.json`.

## (top level)

1 script in 2.7.9: 0 new, 0 successors of converted packages, 1 successor(s) of scripts the 2.7beta1 conversion dropped. Not yet converted or rechecked.

## 21_Поиск и замена

25 scripts in 2.7.9: 23 new, 2 successors of converted packages. Not yet converted or rechecked.

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

1 script in 2.7.9: 0 new, 1 successors of converted packages. Not yet converted or rechecked.

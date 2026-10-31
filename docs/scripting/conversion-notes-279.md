# FictionBook Editor 2.7.9 scripts — overview (feature 007)

The scripts of FictionBook Editor **2.7.9** (`sensboston/fictionbookeditor`, tag `v2.7.9`,
`files/Scripts` and `files/TreeCmd`; GPL v3, `files/copying.txt`) are brought into the editor:
the scripts new since 2.7beta1 are converted (spec US3, FR-020 to FR-026), and every package
converted earlier from 2.7beta1 is rechecked against its 2.7.9 version (US4, FR-021 to FR-023,
FR-027, FR-028). The conversion of 2.7beta1 itself is described in
[conversion-notes.md](conversion-notes.md).

This page is the index. The per-script notes are split by group:

| Notes | Groups |
|-------|--------|
| [conversion-notes-279-a.md](conversion-notes-279-a.md) | 01 to 09 |
| [conversion-notes-279-b.md](conversion-notes-279-b.md) | 10 to 19 |
| [conversion-notes-279-c.md](conversion-notes-279-c.md) | 21 to 99, the root script 29 and `TreeCmd` |

## The inventory

[`tests/scripts/audit/inventory-279.json`](../../tests/scripts/audit/inventory-279.json) is the
single record of every script's state: one entry per 2.7.9 script and per converted package
without a 2.7.9 successor (data-model §7.4 of feature 007). It is written by
`python3 tools/legacy-script-audit.py --recheck` and completed by hand during the conversion; the
equivalence suite (`tests/scripts/run-all.mjs`) and the release notes
(`tools/release-notes-scripts.py`) read it. Its statuses:

| Status | Meaning |
|--------|---------|
| `new` | new since 2.7beta1; converted when its entry names a `package` |
| `recheck` | a converted package whose 2.7.9 successor differs, not rechecked yet |
| `updated` | a converted package brought up to its 2.7.9 version |
| `unchanged` | a converted package whose 2.7.9 version has the same code |
| `kept` | our deliberate choice beats 2.7.9; the reason is in `differences` |
| `notConverted` | needs more than the script API offers; `reason` says what it would need |
| `noCounterpart` | a converted 2.7beta1 script without a 2.7.9 successor (kept, FR-027) |

The baseline of the inventory (T019), before any conversion:

| | Scripts |
|---|---|
| 2.7.9 scripts (`files/Scripts` and `TreeCmd`) | 371 |
| new since 2.7beta1 | 230 |
| successors of converted packages | 136 (24 with the same code, 112 to recheck) |
| successors of the 5 scripts the 2.7beta1 conversion dropped | 5 |
| converted packages without a successor of their own | 6 |

Changes of the successors, comments and layout ignored: 24
identical, 44 small (under 5 % of the lines), 57
moderate (under 30 %), 11 major.
[`recheck-279.json`](../../tests/scripts/audit/recheck-279.json) holds every pair;
`python3 tools/legacy-script-audit.py --diff <package>` prints one pair's diff.

### The review of the pairing (T019)

The tool pairs a 2.7beta1 script with the 2.7.9 script of the same name, else with the most
similar code (among close candidates the name's words and the position decide). The review
corrected six pairs and confirmed the scripts without a successor; its decisions are in
[`pairing-overrides-279.json`](../../tests/scripts/audit/pairing-overrides-279.json), which the
tool applies over its own pairing:

- *Разбить документ на разделы* (08) became *Разметить заголовки разделов либо подзаголовки,
  найденные по регэкспу* (13): the same dialog-driven program by Sclex, version 1.4 → 4.7,
  moved to group 13. Its package moves with it and keeps its id.
- *Поиск по набору регэкспов (заготовка)* (21) is *Поиск (без замены) по набору регэкспов
  (версия с исключениями) (заготовка)*; the search engine the 2.7.9 searches share made others
  look closer.
- *Капитализация первого слова* (01, place 06) is *Первую букву - в верхний регистр, остальные - в нижний* (place 04): byte-identical, renamed and moved. The review first paired *Предложение* with it by the name; the recheck (T073) found the identical code and corrected the pair.
- *Унификация сносок* (02) is *Перенумеровать примечания*, as *Унификация комментариев* is
  *Перенумеровать комментарии*.
- *Расстановка елочек и лапок (с позиции курсора, начиная с 1-го / 2-го уровня)* (12) are
  *Проставить елочки и лапки (от позиции курсора; как будто перед курсором 1 незакрытая
  кавычка / 2 незакрытые кавычки)*; the variants from the document's start with a level have no
  2.7.9 successor.
- No successor: *Предложение* and *Предложение_alxs* (01), *Превращение внешних ссылок в текст* (06), *Сброс
  структуры разделов* (08), and the two from-the-start level variants of group 12.

## Credits (T133)

`tools/legacy-script-audit.py --recheck` collects the author names of the 2.7.9 scripts' headers
into [`authors-279.txt`](../../tests/scripts/audit/authors-279.txt); the reviewed names are in
`CONTRIBUTORS.txt` under "Scripts of FictionBook Editor 2.7.x by:", which the About dialog shows:
Sclex, TaKir, stokber, Jurgen (jurgennt), Faiber, Алекс Савельев (Alex Saveliev), imDaniX, mkb
and Haliz (the idea of *Расширенная нумерация абзацев*). The review merged the spellings of one
person (Sclex-а, Sсlex with a Cyrillic с; jurgennt is Jurgen, Alex Saveliev Алекс Савельев),
added Faiber and TaKir, credited in the headers without the "Автор" the tool looks for, and
dropped the word fragments the tool read as names ("исходного скрипта", "добавленного кода",
"идеи", "title", "AllMeans" from a variable name, and the like). Every script keeps its own notice
(FR-029; `tests/scripts/notices.json`).

## Groups

| 2.7.9 group | Scripts | New | Successors | Successors of dropped |
|-------------|--------:|----:|-----------:|----------------------:|
| (top level) | 1 | 0 | 0 | 1 |
| 01_Регистр | 6 | 0 | 6 | 0 |
| 02_Примечания | 19 | 10 | 9 | 0 |
| 03_Комментарии | 10 | 2 | 8 | 0 |
| 04_Примечания и комментарии из скобок | 12 | 0 | 12 | 0 |
| 05_Иллюстрации | 23 | 14 | 7 | 2 |
| 06_Чистка | 27 | 12 | 15 | 0 |
| 07_Символы | 9 | 2 | 7 | 0 |
| 08_Структура разделов | 6 | 4 | 1 | 1 |
| 09_Стихи | 10 | 7 | 3 | 0 |
| 10_Статистика | 8 | 5 | 3 | 0 |
| 11_Сделать подписи к картинкам из их атрибута title | 5 | 0 | 5 | 0 |
| 12_Обработка кавычек | 15 | 2 | 13 | 0 |
| 13_Заголовки, подзаголовки, пустые строки | 19 | 14 | 5 | 0 |
| 14_Цитаты | 10 | 10 | 0 | 0 |
| 16_Поиск форматирования | 73 | 49 | 24 | 0 |
| 17_Перенос примечаний в скобки | 3 | 0 | 3 | 0 |
| 18_Мелочи редактирования | 13 | 6 | 7 | 0 |
| 19_Обработка форматирования | 27 | 25 | 2 | 0 |
| 21_Поиск и замена | 25 | 23 | 2 | 0 |
| 22_Дескрипшен | 7 | 7 | 0 | 0 |
| 30_'Числовые' скрипты | 13 | 12 | 1 | 0 |
| 31_Автоматизация | 6 | 6 | 0 | 0 |
| 32_Маркеры сносок | 9 | 9 | 0 | 0 |
| 34_Управление курсором либо выделением | 1 | 1 | 0 | 0 |
| 37_Эпиграфы | 5 | 5 | 0 | 0 |
| 40_Таблицы | 3 | 3 | 0 | 0 |
| 95_Для программистов | 3 | 0 | 2 | 1 |
| 99_Прочее | 2 | 2 | 0 | 0 |
| TreeCmd | 1 | 0 | 1 | 0 |

## Conversion and recheck rules

The rules of tasks.md (feature 007, Phase 5 and Phase 6) apply to every group:

1. **Inputs.** The 2.7.9 file of the inventory entry; its dialogs from 2.7.9 `files/HTML/`.
2. **Package.** `scripts/<group folder>/<NN>_<english-slug>/`: `script.json` (`manifestVersion`
   1, `id` = `<group NN>/<slug>` - for a moved or updated script its old id, which never
   changes - `name` and `description` in ru, en and uk, `kind`, `needsSelection`, `undoLabel`,
   `legacy {source, fbeVersion: "2.7.9", sourceVersion}`), `index.js` starting with the
   original's notice kept as written (FR-029), `icon.png` (16 x 16) where the original has an
   `.ico`.
3. **Independent programs.** Each package carries its own helpers; nothing is imported from
   another package.
4. **Texts.** Dialogs and messages through the package's own `t(ctx, ru, en)`: no Ukrainian
   dialog texts until the redesign of script languages (FR-026's time-boxed exception).
5. **FBE constructs.** `window.external` → the version-1 façade or `mfbe.*`;
   `clipboardData.setData` / `getData` → `mfbe.clipboard.writeText` / `readText`; `SaveBinary`,
   FileSystemObject → `mfbe.files.saveText` / `saveBinaries`; `window.open("HTML/…")` →
   `mfbe.ui.report`; `runScriptInFolder`, `runScript` → `mfbe.scripts.run` with the legacy path;
   `showModalDialog` / `showModelessDialog` → `mfbe.ui.form` (modeless as modal);
   `SendKeys("+{ESC}")` → `mfbe.selection.set`; `setTimeout` flashing → dropped.
6. **Forms.** A new `FormField` kind enters `contracts/script-api.md` §4 first.
7. **Tests first.** A reference book, the expected result written from reading the original, a
   suite entry; the snapshot is accepted only when it equals the expected result.
8. **Bugs.** Fixed only when the script's intent and the defect are both clear (FR-023),
   recorded in the inventory's `fixes` and here; an unclear case keeps 2.7.9's behaviour and
   goes to `openQuestions`.
9. **Not converted.** A script needing anything beyond FR-024's powers gets `notConverted`, its
   reason and what it would need.
10. **Records.** The inventory entry (`status`, `package`, `id`, `differences`, `fixes`) and the
    group's notes; the suite for the group; one commit per group.

The recheck of a converted package ports every change in behaviour of its 2.7.9 version; the id
and the folder stay (`20_debug` became `95_programmers`); Russian names follow 2.7.9 and every
package gains Ukrainian names and descriptions; `legacy` names the 2.7.9 source.

**Accepted as not converted (requester, 2026-10-31).** The four scripts that need the editor's
own page or view stay out of the bundle: 05's refresh of the pictures (*Обновить иллюстрации*),
08's section structure manager (*Управление структурой разделов и их заголовками…*), 99's Bulls
and Cows game (*Быки и коровы*) and the top-level reading mode (*Режим чтения*). Their reasons
and what each would need are in the inventory and in the group notes.

## Summary

The release notes' scripts section, written by `tools/release-notes-scripts.py` (T070), comes
here once the conversion is done.

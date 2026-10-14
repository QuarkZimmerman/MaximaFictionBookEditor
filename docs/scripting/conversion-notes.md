# Legacy script conversion — overview (T108–T127)

The 147 scripts shipped with FictionBook Editor 2.7 (`FBE/files/Scripts`, JScript over the
Internet Explorer DOM) were converted to `mfbe` packages under `scripts/<group>/<script>/`.
This page is the index: the totals, the deviations every group shares, the limits of the
scripting runtime found on the way and how to run the equivalence suite. The per-script notes
(behaviour, justified differences, snapshot of every run) are split by task range:

| Notes | Groups | Scripts |
|-------|--------|---------|
| [conversion-notes-a.md](conversion-notes-a.md) | 01 Регистр, 02 Добавление примечания, 03 Добавление комментария, 04 Примечания и комментарии из скобок, 05 Иллюстрации, 08 Структура разделов | 50 legacy → 47 converted |
| [conversion-notes-b.md](conversion-notes-b.md) | 06 Чистка, 07 Символы, 09 Стихи, 10 Статистика, 11 Заголовки картинок в подписи, 12 Обработка кавычек | 49 → 49 |
| [conversion-notes-c.md](conversion-notes-c.md) | 13 Подзаголовки, пустые строки; 16 Поиск форматирования; 17 Перенос примечаний в скобки; 18 Мелочи редактирования; 19 Обработка форматирования; 20 Инструменты отладки; 21 Поиск и замена; the root script 29; `TreeCmd` | 48 → 46 |

## Totals

- **147 legacy scripts → 142 converted packages** (19 menu groups + 1 tree command), all
  bundled (`scripts/`, installed to `share/mfbe/scripts/`; `scripts.list` reports them with
  zero issues and zero warnings).
- **5 dropped**, each with a reason in the group's notes:

  | Legacy script | Why | Notes |
  |---------------|-----|-------|
  | 05_Иллюстрации/03_Обновление иллюстраций | re-assigned `IMG.src` to make IE redraw images; nothing to do in the new editor | [a](conversion-notes-a.md) |
  | 05_Иллюстрации/04_Сохранить вложения на диск | wrote files next to the book; scripts have no file system (FR-144); the Binary Objects panel saves images | [a](conversion-notes-a.md) |
  | 08_Структура разделов/01_Управление структурой разделов… | a 90 KB drag-and-drop tree editor in HTML dialogs; `ui.form` cannot express it and the Document Tree commands cover the use case | [a](conversion-notes-a.md) |
  | 20_Инструменты отладки/03_Код в буфер | copied the page HTML to the clipboard; the sandbox has no clipboard (FR-144); Source view / Save As cover the need | [c](conversion-notes-c.md) |
  | 29_Режим чтения.js (root) | a read-only "reading mode" hooking clicks, keys and the wheel - view behaviour, not a script; needs an editor feature | [c](conversion-notes-c.md) |

- **3 converted with a reduced effect**: `05/unify-binaries`, `05/remove-all-binaries`,
  `05/remove-unused-binaries` compute and report their plan but cannot rename or delete binary
  objects (see "Open requests" below).
- **161 snapshots** in `tests/scripts/snapshots/`: 157 recorded during the conversion of
  groups 01–21, 1 of the tree command, 2 multi-block-selection runs added in T127 (09/03,
  18/09) and 1 CI smoke snapshot of a fixture package; every converted package is covered by
  at least one and all pass (`tests/scripts/run-all.sh`).

## Cross-cutting deviations

Things that differ from the originals in every group, because the document model and the
dialog system differ (details per script in the group notes):

- **Empty lines.** FBE rendered `<empty-line/>` as an empty `<P>`; the model has a distinct
  `empty-line` node. Scripts testing "is this paragraph empty" treat both an `empty-line` and a
  text block made of spaces / non-breaking spaces as empty; scripts that *create* an empty
  paragraph create `<empty-line/>`.
- **Marks instead of inline elements.** Formatting is stored as marks on text runs, so an
  `<emphasis>` element becomes a maximal run carrying the mark; two adjacent elements of the
  same kind are one run (counts, navigation and bracket insertion treat them as one). Scripts
  that edited `innerHTML` with regular expressions run on a faithful rendering of the marks in
  the legacy `<EM>`/`<STRONG>`/`&nbsp;` notation (`lib/legacy-html.js`) and parse it back.
- **Non-breaking spaces** are the real U+00A0 in the model (FBE showed a configurable glyph).
- **Modal forms.** Every HTML dialog became a `ui.form`; modeless palettes (07 Символы), lists
  that offered many actions at once (06/06, 10/02, 19) and per-character editing (01/08) are
  one modal form per step or per finding.
- **Schema checks.** Every structural edit is validated. Where an original produced invalid
  FB2 (a `<subtitle>` in an epigraph, a `<p>` after sub-sections, an empty `<section/>`, a
  `<title>` in the middle of a section) the converted script skips the edit and reports it, or
  performs the closest valid variant.
- **`comments` body.** FB2 2.1 allows a second body named `notes` only; the `comments` body
  of the 03/04/17 scripts is a FictionBook Editor convention, so those scripts (and their
  fixtures) produce documents the core loads as `legacy`, exactly as the originals did.
- **Description annotation / history** were part of the editable page in FBE; `mfbe.doc`
  node operations address bodies only, so scripts that must edit them go through
  `doc.setDescription` (06/02) or leave them alone (documented per script).
- **Notices kept.** The originals are GPL-3.0 (FictionBook Editor 2.7): every package keeps its
  original's notice comment block as written, the author and version lines of its messages and
  undo labels, and names that credit authors (`Предложение_alxs`, `Поиск ошибок текста (регекспы
  от wotti, Roxana, JonVic и др.)`); `legacy.source` names the original file exactly, and
  `tests/scripts/tools/check-notices.py` checks the notices in CI.
- **Language.** `ctx.uiLanguage` selects the original Russian texts or an English rendering.

## Runtime limits (documented, no code change)

Found during the conversion and kept as documented behaviour of API version 1:

- `doc.replaceNode` / `insertNode` / `removeNode` / `setText` / `find` / `replaceAll` and
  `getElementsByTagName` cover the bodies only: the title-info annotation and the
  document-info history are not addressable by node id — scripts use `doc.setDescription`.
- `doc.replaceAll` compiles regular expressions with the `u` flag: legacy identity escapes such
  as `\"` or `\-` outside a class are rejected (sanitise the pattern); the replacement text has
  no escape for a literal `$` (write it through `find` + `replaceNode` when needed) and `\`
  followed by another character is dropped.
- `ui.form` is modal and shows one spec at a time: no palettes, no live lists; a `list` field
  returns an array also for single selection.
- `selection.get()` never returns `null` while a book is open: with no selection in the Body
  view it reports a collapsed selection (anchor = head) at the start of the first text block;
  "nothing selected" is `text === ''` (or `anchor` equal to `head`). On an image selection it
  reports `nodes: []`, `text: '\uFFFC'` and the enclosing body (block image) or paragraph
  (inline image) as `anchor.nodeId`.
- The clipboard and the file system are intentionally unavailable (FR-144), as are view
  behaviours (read-only mode, scrolling by line, intercepting input).
- The sandbox loads modules from the script's own folder only; shared engines are copied into
  every package of a group (byte-identical copies, listed in the group notes).

## Runtime fixes made in T127

Problems the conversion found and that were fixed in the runtime (unit tests in
`ui/tests/unit/scripting/api.test.ts`):

1. A schema-invalid node given to `doc.insertNode` / `doc.replaceNode` (for example a section
   mixing paragraphs and sub-sections) is refused before anything is applied, with a
   `ScriptApiError` whose `code` is `invalidNode` and whose message names the offending path
   (`invalid node at "section/poem[2]": …`). The same parent checks now apply to nodes outside
   the mounted window (`notAllowed`), including the last section of a body.
2. Creating a body with `insertNode('after', <last body>, { type: 'body', … })` works in
   windowed mode as well (large books): body-level inserts go through the document model, the
   window stays on the body the user is looking at. Groups 02/03/04 rely on it.
3. `doc.removeNode(bodyRef)` removes any body except the first one (FB2 needs one body; the
   first is the book); the last section of a body is still protected. Scripts 17/01 and 17/02
   therefore delete the notes/comments bodies wholesale like the originals - their three
   snapshots were re-recorded (the first recordings showed the fallback that removed the
   inlined sections one by one and asked the user to delete the rest in the Document Tree).
4. The harness (`tests/scripts/run-script.mjs`) no longer hangs on a failing script: it
   dismisses the error dialog, reports its text and exits 1; `--select-range` selects across
   text blocks; `--timeout` bounds a run; the "still running" prompt takes `wait`/`cancel`.

## Open requests (need a product decision — the API allow-list is not widened by scripts)

- `doc.renameBinary(id, newId)` / `doc.removeBinary(id)` for 05/02, 05/05, 05/07 (the scripts
  feature-detect them and work fully once they exist; until then they report their plan).
- A "reading mode" as an editor feature (or `ui.setReadOnly`, input hooks,
  `selection.scrollBy`) for the dropped root script 29.
- Clipboard access for 20/03 (the sandbox rules forbid it; Source view / Save As cover it).

## Running the suite

```bash
cd ui && npm ci && npm run build && npx playwright install chromium && cd ..
tests/scripts/run-all.sh                    # every snapshot of tests/scripts/snapshots/suite.json
tests/scripts/run-all.sh --group 17 --verbose
MFBE_CORE_BIN=build/linux-core-release/bin/mfbe-core MFBE_UI_DIST=ui/dist tests/scripts/run-all.sh
```

`run-all.mjs` runs `run-script.mjs` once per snapshot (one headless Chromium and core at a
time, about three minutes for the whole suite), prints pass/fail per snapshot, a per-group
table and the totals, and exits 1 on any failure or on a converted package without a snapshot.
CI runs it in the Linux `e2e` job with the release core and the built UI. One snapshot by hand:

```bash
node tests/scripts/run-script.mjs "scripts/17_notes-to-brackets/01_notes-into-brackets" \
     tests/scripts/fixtures/books/conv-c-17.fb2 --snapshot tests/scripts/snapshots/17/notes-into-brackets.xml
```

See `tests/scripts/snapshots/README.md` for the snapshot format, the manifest and the rules
for re-recording.

# Conversion notes — groups 01, 02, 03, 04, 05, 08 (T108–T112, T115)

Legacy source: `reference/fictionbookeditor/FBE/files/Scripts/<group>/*.js` (FictionBook Editor
2.7, JScript over the IE DOM). Converted packages: `scripts/<group>/<NN_original name>/` with
`script.json`, `index.js` (ES module using only `mfbe`), an optional `icon.png` (converted from the
original `.ico`) and, where several scripts of a group share their logic, a copy of the shared
module in every folder (the sandbox allows imports only from the script's own folder).

Conventions used by these groups:

- `id` = `<NN>/<slug>`; `names.ru` = the original file name without extension; `legacy.source` =
  the original relative path.
- User-facing strings are the originals in Russian and an English rendering, chosen with
  `ctx.uiLanguage`; the originals' notices (author banners, credits, version lines) are kept as
  written (see conversion-notes.md, "Notices kept").
- Fixture books `tests/scripts/fixtures/books/conv-a-<NN>.fb2`; snapshots
  `tests/scripts/snapshots/<NN>/<slug>[.<variant>].xml` (the exact harness command of every snapshot
  is listed below). All snapshots were re-run without `--update` after recording (they match).
- "No reference capture of FBE exists" for every script here: the expected output was derived from
  the legacy code and checked by hand against the fixture (diff fixture → snapshot).

## 01 Регистр (Case) — 8/8 converted, Tier 1 (+1 Tier 3)

Behaviour of the group: all scripts act on the Body selection. The originals pasted two marker
elements around the IE text range and changed every text node between them (so inline formatting
survived); with a collapsed caret they expanded the range to the word under it
(`TextRange.expand("word")`). The port (`case-lib.js`, copied into each folder) rewrites the selected
part of every text run of the selected blocks (marks kept) and re-selects the range / restores the
caret, as the originals did. Word expansion is implemented for the scripts that had it, which is why
those have `needsSelection: false` (a caret alone must keep the menu item enabled).

| Slug | Original | Snapshot (harness arguments) | Notes |
|------|----------|------------------------------|-------|
| `01/upper-case` | 01_Верхний регистр | `upper-case.xml` (`--select n10:20:60`) | |
| `01/lower-case` | 02_Нижний регистр | `lower-case.xml` (`--select n11:5:5`, caret → word) | |
| `01/sentence-case-simple` | 03_Предложение_alxs | `sentence-case-simple.xml` (`--select n11`) | name `Предложение_alxs` as the original's (the file name credits its author) |
| `01/sentence-case` | 04_Предложение | `sentence-case.xml` (`--select n11`) | per text run: first letter upper, rest lower. A run without letters made the original `return` in the middle of the walk (markers left in the document); the port skips the run. `defaultHotkey: Ctrl+Shift+P` comes from the original's `SetHotkey()` (FBE itself had that mechanism commented out). |
| `01/capitalize-words` | 05_Капитализация выделения | `capitalize-words.xml` (`--select n12`) | letter class copied verbatim from the original; a word split by formatting stays one word. |
| `01/capitalize-first-word` | 06_Капитализация первого слова | `capitalize-first-word.xml` (`--select n12`) | |
| `01/cycle-case` | 07_Циклическое изменение регистра | `cycle-case.xml` (`--select n11`) | mixed → lower → UPPER → Sentence. The original's analysis stopped at the first text run containing an upper-case letter (`if (bigLetterFlag && bigLetterFlag)`, a typo); the port analyses the whole selection, which only differs for selections whose first upper-case run is followed by lower-case runs. |
| `01/titles-case` | 08_Регистр заголовков и подзаголовков... | `titles-case.xml` (`--answer '{}' --answer '{"operation":"capitalize"}'`) | Tier 3. The HTML dialog listed title paragraphs / subtitles and let the user flip single characters or a dragged range (context menu: Большие буквы / Маленькие буквы). `ui.form` cannot offer per-character editing, so: form 1 = the dialog's five filters, form 2 = multi-select list of the found elements (all preselected) + operation radio (UPPER, lower, Sentence case, Capitalised Words — the last two cover what users did by hand). The original only listed a title when it was the first child of its parent; the port lists body/section titles regardless (an `image` may precede a body title). |

## 02 Добавление примечания (Footnotes) — 9/9 converted, Tier 2

Behaviour of the group: eight scripts are one program with a settings block (`notes-engine.js`):
find the `notes` body (create it with the title «Примечания» when missing, add the title when
absent), refuse nested note sections, compute the number of the new note from the nearest preceding
note link (`type="note"`), renumber all note sections (`id="n_N"`, title `N`) and all links to them
(`href`, text `[N]`) leaving a gap, replace the selection by the link `[N]` and insert the section
`n_N` (title `N` + an empty paragraph, or the paragraphs typed in the prompt) before the following
note; "last" variants append without renumbering and refuse when a note link follows the caret;
"go to" variants select the new paragraph instead of showing the summary; "unify" variants only
renumber (the 08 variant first deletes note sections no link refers to, after a confirmation).
`20_Тест сносок` only validates (ids, order, duplicates, unreferenced sections) and selects the
first offending element.

| Slug | Original | Snapshot (harness arguments on `conv-a-02.fb2`) |
|------|----------|--------------------------------------------------|
| `02/add-footnote` | 01_Добавить сноску, оставшись на ее ссылке | `add-footnote.xml` (`--select n8:57:57`) |
| `02/add-footnote-with-text` | 02_Добавить сноску, введя ее текст в окошке | `add-footnote-with-text.xml` (`--select n8:57:57 --answer 'Текст <b>новой</b> сноски<br>Второй абзац &lt;с&gt; сущностями'`) |
| `02/add-footnote-go-to-note` | 03_Добавить сноску, перейти к ее разделу | `add-footnote-go-to-note.xml` (`--select n8:57:57`) |
| `02/unify-footnotes` | 04_Унификация сносок | `unify-footnotes.xml` |
| `02/add-last-footnote` | 05_Добавить последнюю сноску, оставшись на ее ссылке | `add-last-footnote.xml` (`--select n14:44:44`); `add-last-footnote.not-last.xml` (`--select n8:57:57`, refused, unchanged) |
| `02/add-last-footnote-with-text` | 06_Добавить последнюю сноску, введя ее текст в окошке | `add-last-footnote-with-text.xml` (`--select n14:44:44 --answer 'Последняя <i>сноска</i>'`) |
| `02/add-last-footnote-go-to-note` | 07_Добавить последнюю сноску, перейти к ее разделу | `add-last-footnote-go-to-note.xml` (`--select n14:44:44`) |
| `02/unify-footnotes-remove-unused` | 08_Унификация сносок (с удалением неиспользуемых разделов сносок) | `unify-footnotes-remove-unused.xml` (`--answer ok`) |
| `02/test-footnotes` | 20_Тест сносок | `test-footnotes.xml` (read-only; reports the unreferenced `n_unused`) |

Deviations: the selection must lie inside one text block (the original pasted the link over any
range; a multi-block range is refused with a message); the prompt's default text was `&nbsp;`
(FBE saved a blank note as `<empty-line/>`), here the default is empty and a blank entry yields an
empty paragraph like the no-prompt variants; the `<br>`/`<b>`/`<i>`/… mini markup and its five
validation messages are kept (`parseNoteText`); link texts replace the whole link (an inner `<sup>`
disappears, as `innerHTML = "[N]"` did); all checks run before the first change, so the
"remove the pasted link on error" clean-up of the original is unnecessary (one undo step anyway).
A notes body is only created together with the new section (a body needs at least one section).

## 03 Добавление комментария (Comments) — 8/8 converted, Tier 2

Same engine with the comment settings of the originals: body `comments` titled «Комментарии», ids
`c_N`, link text `{N}` as superscript, no `type="note"` on the link, and "is a comment link" =
href id matches `^c_`. Snapshots `tests/scripts/snapshots/03/` on `conv-a-02.fb2`:
`add-comment.xml` (`--select n8:57:57`), `add-comment-with-text.xml` (`… --answer 'Текст <em>нового</em> комментария'`),
`add-comment-go-to-comment.xml`, `unify-comments.xml`, `add-last-comment.xml` (`--select n14:44:44`),
`add-last-comment-with-text.xml` (`--answer 'Последний комментарий'`), `add-last-comment-go-to-comment.xml`,
`unify-comments-remove-unused.xml` (`--answer ok`; drops `c_unused`). Slugs: `03/add-comment`,
`03/add-comment-with-text`, `03/add-comment-go-to-comment`, `03/unify-comments`, `03/add-last-comment`,
`03/add-last-comment-with-text`, `03/add-last-comment-go-to-comment`, `03/unify-comments-remove-unused`
↔ originals 01…08 in order. Note: FB2 2.1 only allows a second body named `notes`; a `comments`
body is a FictionBook Editor convention, so these scripts (and the fixture `conv-a-02.fb2`) produce
documents the core loads as `legacy`, exactly as the originals did.

## 04 Примечания и комментарии из скобок (Notes/comments from brackets) — 12/12, Tier 2

Behaviour of the group: one program (`brackets-engine.js`) with the bracket pair and the
footnote/comment settings. Every text block of every body is scanned in document order; an opening
bracket outside a link starts a note that ends at the closing bracket — in the same block or in a
following sibling block of the same parent (the blocks in between, including poems/cites/images,
move into the note; the opening block keeps `before + link + text after the closing bracket`, the
other blocks are removed). The note text keeps its inline marks and links. The new section is
inserted before the section of the next note link (so numbering order is preserved) or appended;
at the end all note sections are renumbered (`n_N`/`c_N`, titles) with every link pointing to them
(`[N]` / superscript `{N}`). Errors keep the original messages, renumber what was done and put the
caret before the faulty bracket: a second opening bracket before the closing one, a note that does
not end inside its parent, a next-note link pointing to a missing section / outside the notes body.
Nested note sections are refused. Variants 605/606/611/612 ask the brackets (two regexes with flag
`i`, or a plain-text pair «[ ]» escaped like the original).

| Slug | Original | Snapshot (on `conv-a-04.fb2`) |
|------|----------|-------------------------------|
| `04/footnotes-from-square` | 601_Примечания из [] | `footnotes-from-square.xml`; `footnotes-from-square.errors.xml` (on `conv-a-04-errors.fb2`: first note made, stop at the double opening bracket) |
| `04/footnotes-from-curly` | 602_Примечания из {} | `footnotes-from-curly.xml` |
| `04/footnotes-from-square-bang` | 603_Примечания из [! !] | `footnotes-from-square-bang.xml` |
| `04/footnotes-from-square-tilde` | 604_Примечания из [~ ~] | `footnotes-from-square-tilde.xml` |
| `04/footnotes-from-regex-brackets` | 605_Примечания из скобок, заданных регэкспами | `footnotes-from-regex-brackets.xml` (`--answer '\{' --answer '\}'`) |
| `04/footnotes-from-text-brackets` | 606_Примечания из скобок, заданных простым текстом | `footnotes-from-text-brackets.xml` (`--answer '« »'`) |
| `04/comments-from-square` … `04/comments-from-text-brackets` | 607…612 | `comments-from-*.xml` (same arguments; the `comments` body is created) |

Deviations: inline formatting that crosses a bracket is fine in the mark model, so the original's
errors "Не все тэги, открытые внутри скобок, в них закрываются" cannot occur; the walk uses the
model's text blocks (`p`, `subtitle`, `v`, `text-author`), the originals' `P` elements; the version
banner is dropped from the final message ("Добавлено примечаний: N. Затрачено времени: …").

## 05 Иллюстрации (Illustrations) — 7 converted (3 limited by the API), 2 dropped

| Slug | Original | Tier | Snapshot (on `conv-a-05.fb2`) | Notes |
|------|----------|------|-------------------------------|-------|
| `05/check-images` | 01_Проверка иллюстраций | 2 (read-only) | `check-images.xml` | reports unused binaries (covers count as used; the src-title-info cover is honoured too) and images without binary. The original's `if(a, b)` typo meant "no binaries" was the only early exit; kept. |
| `05/unify-binaries` | 02_Унификация вложений и иллюстраций | 2 | `unify-binaries.xml` | the full renaming plan of the original (`cover.*`, `cover_src.*`, `i_001.*`, `unused_*`, `nonjpegpng_*`, `#nobin_*`) is computed and reported; **only** the `nobin_` image hrefs are applied — see API gap 1. The report format of the original is kept. |
| — | 03_Обновление иллюстраций | 4 | — | **dropped**: re-assigned `IMG.src` to force IE to redraw images; nothing to do in the new editor. |
| — | 04_Сохранить вложения на диск | 4 | — | **dropped**: wrote files next to the book (`window.external.SaveBinary`); FR-144 forbids file-system access from scripts; the Binary Objects panel saves images. |
| `05/remove-all-binaries` | 05_Удалить все вложения | 2 | `remove-all-binaries.xml` (`--answer yes`) | confirmation kept; see API gap 1 (explains instead of deleting). |
| `05/empty-lines-near-images` | 06_Пустые строки возле иллюстраций... | 2 | `empty-lines-near-images.add.xml` (`--answer ok`), `.remove.xml` (`--answer cancel`) | the sibling-walk of the original is ported over a linked list of each section's children; empty line = `<empty-line/>` or a paragraph of spaces/nbsp (FBE wrote both as `<empty-line/>`); the special cases (section with only its image; text starting with an image / with empty lines + image) are kept, including the empty line added after a lone section image in *removal* mode. |
| `05/remove-unused-binaries` | 07_Удаление неиспользуемых вложений... | 2 | `remove-unused-binaries.xml` | the "external image address" confirmation is kept; see API gap 1. |
| `05/image-captions` | 08_Разметка подписей к иллюстрациям... | 3 | `image-captions.xml` (`--answer '{}' --answer skip --answer yes`), `image-captions.all-bold.xml` (`--answer '{"strong":true,"subtitle":false,"start":"begin"}' --answer all`) | the modeless dialog becomes a form (b / i / sup / sub / subtitle, length limit, start from caret or beginning) + a question per doubtful caption with the dialog's buttons (Это подпись / Искать дальше / Все / Закрыть). Default length limit 200 (the value shown by the dialog). |
| `05/inline-image-to-block` | 09_Сделать обычный рисунок из рисунка в тексте | 2 | `inline-image-to-block.xml` (`--select n21:0:1`), `.with-text.xml` (`--select n19:25:26`, unchanged) | the selected inline image alone in its paragraph becomes a block image (href, alt kept). |

## 08 Структура разделов (Section structure) — 3 converted, 1 dropped

| Slug | Original | Tier | Snapshot (on `conv-a-08.fb2`) | Notes |
|------|----------|------|-------------------------------|-------|
| — | 01_Управление структурой разделов и их заголовками... | 4 | — | **dropped**: a 90 KB drag-and-drop tree editor (modal_dialog.htm + control_structure_frame_*.htm) for moving/renaming/deleting/wrapping sections; `ui.form` cannot express it and the Document Tree (FR-022: Move Right/Left/With Children, Merge, Delete, rename titles in the Body) covers the use case. |
| `08/split-into-sections` | 02_Разбить документ на разделы... | 3 | `split-into-sections.xml` (`--answer '{"regexp":"^глава ","before":"0","after":"1"}'`) | the dialog becomes a form (regexp, case sensitivity, lines before/after taken into the title). Sections are processed depth first; the leading part keeps the section's attributes, or — when the first title opens the section — the first new section inherits them (the original left an empty `<section>` because its `\A` regexp never matched in JScript). Sections that would end up without blocks (title only) receive an `<empty-line/>` so the result stays schema-valid; an empty regexp is refused. One run per invocation (the dialog's "Обработать" could be repeated). |
| `08/section-down` | 03_Опустить раздел на один уровень | 2 | `section-down.xml` (`--select n10:0:0`), `section-down.no-section.xml` (`--select n3:0:0`, error message, unchanged) | title/epigraph/image/annotation stay, the rest is wrapped into a nested section. A section with nothing to wrap is reported (the original produced an empty nested section). |
| `08/reset-structure` | 04_Сброс структуры разделов | 2 | `reset-structure.xml` | flattens one level of the top-level sections (header-only section keeps the id, gets an `<empty-line/>`; the promoted subsections get fresh node ids). |

## Runtime / API gaps found

1. **No binary-object mutation in `mfbe.doc`** (blocks `05/unify-binaries`, `05/remove-all-binaries`,
   `05/remove-unused-binaries`). `doc.binaries()` is metadata-only and there is no call to rename
   or remove a binary (nor to reorder them). Needed: `doc.renameBinary(id: string, newId: string):
   Promise<void>` and `doc.removeBinary(id: string): Promise<void>` (both inside the run's undo
   group; renaming should not touch image hrefs — the scripts update them). The three scripts
   feature-detect these names (`typeof mfbe.doc.removeBinary === 'function'`) and work fully once
   they exist; until then they report what they would do.
2. **A schema-invalid node passed to `doc.insertNode` / `doc.replaceNode` freezes the UI** instead
   of raising a `ScriptApiError`. Repro (on any book, e.g. `tests/scripts/fixtures/books/conv-a-08.fb2`):
   `await mfbe.doc.insertNode('after', '<any top-level section id>', { type: 'section', attrs: {},
   content: [{ type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'T' }] }] },
   { type: 'p', attrs: {}, content: [{ type: 'text', text: 'x' }] }, { type: 'section', attrs: {},
   content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'y' }] }] }] })` — a section mixing
   blocks and a subsection. `nodeFromScript` only throws for the first `report.problems` entry of
   the *top* node; here `createChecked` fails for the nested content, the unchecked fallback node is
   inserted and the page's main thread never returns (the harness hangs until its timeout; the
   same happened when the whole body holding such a section was replaced). Expected: a clear
   `ScriptApiError` ("invalid node …"). The converted scripts avoid the situation (they only move
   existing valid nodes), but a user script can trigger it.
   *Status (T127):* the node is now refused before anything is applied - `ScriptApiError` with
   `code: 'invalidNode'` and the path of the violation; the hang itself was the harness waiting
   on the error dialog (see conversion-notes.md, "Runtime fixes made in T127").
3. **Creating a body** is only possible through `doc.insertNode('after', <last body>, {type:'body'})`
   and only in whole-book mode (≤ 40 top-level sections): `mountedPos()` refuses body refs in
   windowed mode and `insertInModel()` never visits the body level, so the call silently does
   nothing on large books. Used by groups 02/03/04 when the `notes`/`comments` body is missing.
   Needed: either make `insertNode` handle bodies in `insertInModel` or add `doc.addBody(name)`.
   *Status (T127):* fixed - `insertNode('before'|'after', <body>, {type: 'body'})` inserts at
   the body level through the model in windowed mode (and keeps the window on the visible body).
4. Minor: `selection.get()` on an image node selection reports `nodes: []` and `text: "\uFFFC"`
   with the enclosing body as `anchor.nodeId` (block image) or the paragraph (inline image); the
   scripts rely on that shape (`05/inline-image-to-block`), it should be documented in
   `script-api.d.ts`. The harness `--select` cannot select an image node, so the block-image
   branch of that script is untested.

## Fixture books

- `conv-a-01.fb2` (case words, titles, subtitles in section/poem/cite, a notes body) — valid 2.1.
- `conv-a-02.fb2` (footnotes with a stale id, a section without title, an unreferenced note, a
  `comments` body with an unreferenced comment) — loads as `legacy` because of the third body (see
  group 03).
- `conv-a-04.fb2`, `conv-a-04-errors.fb2` (bracket notes of all four kinds, an existing notes
  body, a multi-paragraph note, a link inside brackets; the error book has a double opening
  bracket and an unclosed one) — valid 2.1.
- `conv-a-05.fb2` (cover, section image, images with/without binary, inline images, empty lines
  around images, nested sections with images, unused and GIF binaries) — valid 2.1 (warnings only).
- `conv-a-08.fb2` (flat text with chapter lines, nested parts/chapters) — valid 2.1.

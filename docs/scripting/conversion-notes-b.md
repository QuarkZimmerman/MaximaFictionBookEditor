# Conversion notes — groups 06, 07, 09, 10, 11, 12 (T113, T114, T116, T117, T118, T119)

Legacy sources: `reference/fictionbookeditor/FBE/files/Scripts/<group>/`. Converted packages live in
`scripts/<group>/<original folder name>/` with `legacy.source` set; ids are `<NN>/<slug>`.
Snapshots: `tests/scripts/snapshots/<NN>/<slug>.<book>.xml`, fixture books
`tests/scripts/fixtures/books/conv-b-{06,07,09,10,11,12}.fb2` and, for the inline marks of
feature 006, `marks-006.fb2`. Every snapshot below was produced with `--update`, checked
semantically against the legacy logic (see the per-script notes) and re-run without `--update`
(all 58 match: 49 on the `conv-b` books, 9 on `marks-006.fb2`). The exact harness invocations
are listed at the end.

## Shared technique: the legacy inline-HTML notation

Most clean-up scripts edited the Internet Explorer `innerHTML` of each `<P>` with regular
expressions that mention `<EM>`, `<STRONG>` and `&nbsp;`. `lib/legacy-html.js` (copied into the
packages that need it — a script may only import files from its own folder) renders a text block
of the document model in exactly that notation (`<EM>`, `<STRONG>`, `<STRIKE>`, `<SUB>`, `<SUP>`,
`<SPAN class=code>`, `<SPAN class=NAME>` for named styles, `<A class=note href="…">` for links,
`<IMG href=… alt=…>` for inline images, `&nbsp;`/`&lt;`/`&gt;`/`&amp;`) and parses the edited
string back. The legacy expressions therefore run verbatim and inline formatting survives.
Since feature 006 the notation also carries what the reader now keeps: a mark's language
(`xml:lang`, any value, `""` included) as `lang="…"` on its tag (`<EM lang="la">`,
`<SPAN class=NAME lang="la">`), repeated on the closing tag of `STRONG`, `EM`, `STRIKE`, `SUB`
and `SUP` (`</EM lang="la">`) so that the legacy expressions, written for bare tags (General
clean-up's `</EM></EM>` → `</EM>`), leave formatting with a language alone; a link's
`xlink:type` as `xlinktype="…"` after its `href` (without a colon: General clean-up's "missing
space after a colon" expression would split `xlink:type`); and inline pictures inside the tags
of their marks (`<A href="#s2"><IMG href="#pic.png"></A>`, `<STRONG><IMG …></STRONG>`), as text.
Nested marks of one kind with different attributes nest as read (two named styles,
`<EM lang="la">` around `<EM lang="de">`); a closing tag ends the innermost open mark of its
kind - with a language, the innermost one with that language. The `marks-006` snapshots prove
it for the eight packages that rewrite blocks through the notation.
`lib/interactive.js` is the common engine of the five interactive clean-up scripts 04/05/07/08/10 (highlight,
Yes/No/Cancel prompt, placeholders, decision memory). The 8 copies of `legacy-html.js` and the
5 copies of `interactive.js` are byte-identical.

A rule of ECMAScript that mattered: an optional group may not match the empty string in one
iteration (`RepeatMatcher`, min = 0), so the legacy prefix `^(.*?){0,1}` never matched "" and a
match at the very start of a paragraph lost its first character (shown to the user as
"липшиеся.Слова" for "Слипшиеся.Слова"; dictionary look-ups failed the same way). JScript had the
same rule, so the originals behaved like that too; the converted scripts use `^(.*?)` instead
(06/04 is unaffected, its prefix groups end in a non-letter).

## 06_Чистка (T113) — 16 scripts, all converted

| Slug | Original | Tier | Snapshot / answers |
|------|----------|------|--------------------|
| `general-cleanup` | 02_Генеральная уборка | 1 | no dialogs |
| `latin-to-cyrillic` | 03_Латиница в Кириллице | 1 | no dialogs |
| `surname-initials` | 04_Фамилия И. О. | 1 | `--select n25:0:0`, 4 prompts |
| `stuck-words` | 05_Слипшиеся слова | 1 | `--select n27:0:0`, 2 Yes/No + 5 prompts |
| `guided-paragraph-breaks` | 06_Управляемое исправление разрывов абзацев... | 3 (2 HTML dialogs → forms) | one form (all automatic) |
| `large-numbers` | 07_10.000.000.000 | 1 | `--select n26:0:0`, 2 prompts |
| `hyphen-vs-dash` | 08_Дефис - Тире | 1 | `--select n28:0:0`, 2 prompts |
| `missing-full-stop` | 10_Точка. | 1 | `--select n29:0:0`, 1 prompt |
| `remove-back-links` | 12_Удаление возвратов | 2 | no dialogs |
| `broken-sentences` | 14_Разрыв предложения | 2 | 3 Yes/No |
| `dot-dash-letter` | 15_Точка, тире, буква... | 3 (frameset → form per finding) | `--select n41:0:0`, 4 forms |
| `dot-dash-letter-no-ellipsis` | 16_Точка, тире, буква (без поиска многоточий) | 3 | `--select n41:0:0`, 2 forms |
| `external-links-to-text` | 17_Превращение внешних ссылок в текст | 1 | no dialogs |
| `win1252-letters` | 19_Символы win-1252 (буквы)... | 3 (frameset → form per finding) | `--select n48:0:0`, 2 forms |
| `win1252-words` | 20_Символы win-1252 (слова)... | 3 | `--select n48:0:0`, 2 forms |
| `remove-style-tags` | 21_Удаление тегов style | 2 | no dialogs |

The inline marks of feature 006 (FR-064, FR-067, FR-069): `marks-006.fb2` holds, in a `p` and in
a `td`, nested named styles (also `<style name="a" xml:lang="la">` around `<style name="b">`), a
linked and a bold picture, formatting with `xml:lang` (around whole links only), an
`<emphasis xml:lang="la">` holding an `<emphasis xml:lang="de">` and a note link with
`l:type="simple"`, beside text each package changes. The snapshots
`<slug>.marks-006.xml` of `general-cleanup`, `surname-initials` (2 prompts), `stuck-words`
(2 Yes/No + 4 prompts), `large-numbers` (2 prompts), `hyphen-vs-dash` (3 prompts),
`missing-full-stop` (4 prompts), `broken-sentences` (1 Yes/No), `remove-style-tags` and
`09/drama-speakers` show all of it back as in the book apart from the script's own change;
*Remove style tags* removes every style, nested ones and those around pictures included (each
style a run starts counts as one removed `<style>` element), while the pictures keep their link
and their bold.

Behaviour and justified differences:

- **02 Генеральная уборка** — the 79 expressions are extracted mechanically into `rules.js` in
  their order of application with the per-paragraph conditions (stanza / title) and the
  statistics counters. The rule "градус Цельсия" (re67) was dead code in the original (its
  `RegExp` was assigned to `re67_`, so `s.search(re67)` searched for `undefined`); it is not
  applied. Junk ids (`AutBody_…`) are removed. The title-info annotation and the document-info
  history, which the original processed as parts of `fbw_body`, are edited through
  `doc.setDescription` because node operations cannot address description nodes.
- **03 Латиница в Кириллице** — 76 rules run through `doc.replaceAll` (regex, case-sensitive).
  `\"` inside character classes was unescaped (`u`-mode regexes reject it). The rule "6 → б" is
  used as intended (`[^\d]`); in the original the backslash was lost in a string literal
  (`[^d]`). Single pass like the original: "Пoлe" becomes "Полe" because the e-rules run before
  the o-rules. The description annotation is not processed (`replaceAll` covers bodies only).
- **04/05/07/08/10 (interactive)** — ported on `lib/interactive.js`; the FBE `InputBox`
  (Yes / No / Cancel) is `ui.prompt({ yesNoCancel: true })`: Yes replaces by the text, No keeps
  (and remembers, where the original did), Cancel stops the script leaving the current paragraph
  untouched (the originals returned before writing it back). Placeholders are private-use
  characters instead of `col1_k†` / `♣k`, so they can never be matched by a later pattern. The
  highlighted range is computed from the original text of the paragraph. Paragraphs are
  processed from the one with the caret to the end of the book; the description annotation is
  not processed (no highlight is possible there). 05: the `sl1` instead of `sl2` typo of the
  re20 branch is corrected; "радио/теле/лево/право" hyphen exceptions kept. 08: word lists
  (1565 prefixes, 15 suffixes, 5095 hyphenated pairs, 7929 dash pairs) are in `words.js`; a
  known dash pair wins over a known hyphen part exactly as in the original; the "continue?"
  question comes every 200 handled places. 10: the 996 proper names are in `names.js`.
- **06 Управляемое исправление разрывов абзацев** — the modes dialog is one form (cite/subtitle
  switches, one `select` per break class: "Ask me" or an automatic action). The second HTML
  dialog, which listed all disputed places at once, became one form per place with the end of
  the first and the start of the second paragraph and the class's radio options. Actions 9
  (join with ":" and a space) and 10 (add ":") work in automatic mode too (the original's
  `doAction` silently ignored them). All empty lines between the two paragraphs are removed in
  both paths (the original removed all of them automatically but only the first one manually).
  A class-7 place is offered the class-1 actions, as in the legacy dialog. Chained merges are
  resolved like the original's `prevP == lastPtr` logic.
- **12 Удаление возвратов** — only links matching `^_ftnref|^_ednref` are removed (with their
  text, `HREF_TO_TEXT` switch kept). The original removed *every* link that followed a back link
  inside the same notes section because its counter was never reset — treated as a bug. The
  original's closing message referenced undefined variables and would have thrown; a plain
  count message replaces it.
- **14 Разрыв предложения** — each pair is rendered as `<P>…</P>\r\n<P>…</P>` (IE's outerHTML
  junction) so the five legacy expressions apply unchanged; `<P class=subtitle>` for non-plain
  blocks keeps the original's "no merge into subtitles" effect. Excerpts in the questions are
  plain text.
- **15/16 Точка, тире, буква** — the frameset became a form per finding (skip / swap punctuation /
  change the letter's case / go there) with the "go there after the change" checkbox; the found
  range is also selected in the Body view. 16 never treats dots as an ellipsis (as the original).
- **17/21** — straightforward mark removal; counts reported in the status bar.
- **19/20 Символы win-1252** — form per finding with the recoded proposal and an editable
  replacement. The recode table is generated from the real cp1251→cp1252 byte mapping (the
  original string literal contained unprintable control characters). 20 also finds a mixed word
  at the very start of a paragraph (the original's look-behind could not match an empty prefix).
  Footnote links and sub/superscripts are barriers, as in the original.

## 07_Символы (T114) — 7 scripts, all Tier 3

`special-symbols` (01_Спецсимволы, spez.htm, 60 symbols), `diacritics` (02_Диакритика, CE.htm,
182), `arabic` (Арабский, арабский.htm, 45), `currency` (Валюта, валюты.htm, 17), `greek`
(Греческий, греческий.htm, 50), `old-russian` (Древнерусский, древнерусский.htm, 16), `hebrew`
(Иврит, иврит.htm, 30). The symbol tables (`charStr` / `titleStr` of each `.htm`) were extracted
mechanically into `symbols.js`; the form shows a `list` of "symbol — tooltip". Difference: the
legacy dialogs were modeless palettes (several clicks); `ui.form` is modal, so one symbol per
run. The symbol is inserted at the end of the selection (selected text and its marks are kept),
reproducing `pasteHTML(range.htmlText + symbol)`. The combining acute (U+0301) is listed on a
dotted circle. Snapshots use one symbol per script (`--select` + `--answer '{"symbol":"…"}'`).

## 09_Стихи (T116) — 3 scripts, Tier 2

- `merge-adjacent-poems` (01_Слияние подряд идущих стихов, needsSelection): a poem whose first
  child is a stanza and whose first line lies in the selection is appended to the preceding
  poem when only empty lines separate them and the preceding poem ends with a stanza; the
  empty lines between them are removed. Not reproduced: the original's `clearEmpties` also
  deleted every empty line after the merged poem up to the end of the enclosing block. The
  "stanza starts inside the selection" marker logic is approximated by "its first line is a
  selected block and the selection does not start in the middle of that line". Snapshot:
  `--select n17` (single block → one merge); the multi-block chain (two merges, stop at a
  text-author) was verified with a wrapper that calls `selection.set` across blocks first.
- `drama-speakers` (02_Драма...): `HandleP` ported almost verbatim on the legacy notation
  (`prompt` → `ui.prompt`, `AskYesNo` → Yes/No message). The nbsp is kept as a character so the
  single-character comparisons of the original work.
- `merge-paragraphs` (03_Слить параграфы, needsSelection): consecutive selected `p`/`v` siblings
  are merged with a space, or without one after an unmarked trailing hyphen ("сло-" + "во" →
  "сло-во", the original kept the hyphen). The harness can only select one block, so the
  snapshot shows no change; a 3-paragraph merge was verified with a `selection.set` wrapper.

## 10_Статистика (T117) — 3 scripts

- `show-links` (01, Tier 1) and `show-all-links` (02, Tier 3: `links.htm` window → form with a
  multi-line text field): numbered internal links (`[!!!]` when the target does not start with
  `#`, `(null)` for an empty href) and external links. Verified by a wrapper that wrote the
  report into the book (7 links of the fixture listed correctly).
- `document-statistics` (03): paragraphs = rendered `<P>`s (text blocks + empty lines), text size
  = `doc.stats().characters`, cover from `description.titleInfo.coverpage`, illustrations =
  `doc.stats().images`, footnotes = `<a type="note">` runs, binaries from `doc.binaries()` with
  the legacy base64 size estimate. Verified the same way (15 paragraphs, 2 images, 2 footnotes,
  3 binaries).

## 11_Заголовки картинок в подписи (T118) — 5 scripts, Tier 2

`caption-strong`, `caption-emphasis`, `caption-subtitle`, `caption-subtitle-strong`,
`caption-subtitle-emphasis` (600–604). For every block `<image title="…">`: caption block (p or
subtitle, optional strong/emphasis) after the image, then an `empty-line` unless the next
sibling already is an empty line/paragraph, image `title` removed; the last image of a section
gets the caption only (as the original). Difference: where the schema forbids a caption (an
image before the nested sections of a section, or the body image before the title) the image
is skipped and counted in the message — the original would have produced invalid FB2 there.
Inline images are ignored (they were `<span>`s, not `<div class=image>`).

## 12_Обработка кавычек (T119) — 15 scripts

- `place-quotes` … `place-quotes-from-caret-level2` (001–006) and `place-guillemets-only` (015)
  share `quotes.js`: the neighbour analysis (`re1`–`re5`, including the `w|` quirk of `re4`
  whose `\w` had lost its backslash) and the nesting rules are ported verbatim; existing
  typographic quotes in the range are normalised first; the level must be 0 at the end of every
  section and unchanged at the end of every block entered inside the range; on an error the
  caret is placed at the problem and the message with the statistics is shown (changes made so
  far stay, as in the original — one Undo reverts them). Variants: start level 0/1/2, range =
  selection / whole book or caret → end of book; 002 keeps its `blockInitQuotesLevel = 0`
  quirk (`resetBlockLevels`). Difference: quotes inside footnote-link text are left alone (the
  original processed them with the surrounding text as neighbours, which never happens in
  practice). Snapshots: 001 and 015 on the whole book, 002/003 on selections, 004–006 from
  caret positions; the error path (unbalanced quote → caret at the end of the section) was
  verified with a modified copy of the fixture.
- `next-/previous-guillemets`, `-low-quotes`, `-straight-quotes`, `-any-quotes` (007–014) share
  `goto-quotes.js`: search after the selection end (forward) or before the selection start
  (backward), select the character, offer to continue from the other end of the book, stop at
  the original position with "Ничего не найдено". The document is not changed (snapshots equal
  the fixture); the resulting selections (including wrap-around) were verified with a wrapper
  that recorded `selection.get()`.

## Runtime / API / harness gaps noticed

1. `doc.replaceNode/setText/replaceAll/find` cannot address the title-info annotation and
   document-info history (`nodeIndex` covers `document.bodies` only, although the nodes carry
   ids). Scripts that must edit them (06/02) go through `doc.setDescription`; `replaceAll`-based
   scripts (06/03) skip them.
2. `doc.replaceAll` regex replacements have no escape for a literal `$` or `\` followed by
   another character (unknown escapes are dropped). Not needed by these scripts.
3. `buildSearchRegExp` compiles with the `u` flag: legacy patterns with identity escapes such as
   `\"` are rejected and had to be sanitised when they are passed to `replaceAll`.
4. `ui.form` cannot model a modeless palette (07) nor a dialog that lists many cases at once
   (06/06, 10/02): converted to one modal form (per case).
5. `tests/scripts/run-script.mjs --select` selects inside one text block only; scripts that
   need a multi-block selection (09/01, 09/03) were verified with a temporary wrapper package
   calling `mfbe.selection.set(anchor, head)` before the script.
   *Status (T127):* `--select-range` added; the three-paragraph merge of 09/03 is the committed
   snapshot `09/merge-paragraphs.range.conv-b-09.xml` (`--select-range n49:0-n51:5`).
6. Playwright `selectOption` in the harness fails (browser closed) for a `list` option whose
   value is a lone combining character (U+0301 of 07/01); other symbols were used.
7. `selection.get()` returns a collapsed selection at the start of the first paragraph when the
   Body view has no selection (never `null`), so "nothing selected" has to be detected through
   `text === ''`. *Status (T127):* documented as the behaviour of API version 1 (en.md / ru.md).

## Harness commands

```bash
NB=$'\xc2\xa0'   # a non-breaking space inside --answer values
G=scripts/06_Чистка; B=tests/scripts/fixtures/books/conv-b-06.fb2; S=tests/scripts/snapshots/06
node tests/scripts/run-script.mjs "$G/02_Генеральная уборка" $B --snapshot $S/general-cleanup.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/03_Латиница в Кириллице" $B --snapshot $S/latin-to-cyrillic.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/04_Фамилия И. О." $B --select n25:0:0 --answer "А.${NB}С.${NB}Пушкин" --answer "Л.${NB}Н.${NB}Толстой" --answer "" --answer "" --snapshot $S/surname-initials.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/05_Слипшиеся слова" $B --select n27:0:0 --answer no --answer no --answer "Слипшиеся. Слова" --answer "слово Слово" --answer "цифры 5" --answer "ушёл. — и" --answer "" --snapshot $S/stuck-words.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/06_Управляемое исправление разрывов абзацев..." $B --answer '{"case1":"1","case5":"8","case2":"2","case3":"3","case4":"4","case6":"1","case7":"1"}' --snapshot $S/guided-paragraph-breaks.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/07_10.000.000.000" $B --select n26:0:0 --answer "10${NB}000${NB}000" --answer "1${NB}500${NB}000" --snapshot $S/large-numbers.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/08_Дефис - Тире" $B --select n28:0:0 --answer "стоял — сказал" --answer "" --snapshot $S/hyphen-vs-dash.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/10_Точка." $B --select n29:0:0 --answer "домой. Было" --snapshot $S/missing-full-stop.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/12_Удаление возвратов" $B --snapshot $S/remove-back-links.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/14_Разрыв предложения" $B --answer yes --answer yes --answer yes --snapshot $S/broken-sentences.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/15_Точка, тире, буква..." $B --select n41:0:0 --answer '{"action":"letter"}' --answer '{"action":"punct"}' --answer '{"action":"letter"}' --answer '{"action":"skip"}' --snapshot $S/dot-dash-letter.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/16_Точка, тире, буква (без поиска многоточий)" $B --select n41:0:0 --answer '{"action":"letter"}' --answer '{"action":"letter"}' --snapshot $S/dot-dash-letter-no-ellipsis.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/17_Превращение внешних ссылок в текст" $B --snapshot $S/external-links-to-text.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/19_Символы win-1252 (буквы)..." $B --select n48:0:0 --answer '{}' --answer '{}' --snapshot $S/win1252-letters.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/20_Символы win-1252 (слова)..." $B --select n48:0:0 --answer '{}' --answer '{"replacement":"Zurich"}' --snapshot $S/win1252-words.conv-b-06.xml
node tests/scripts/run-script.mjs "$G/21_Удаление тегов style" $B --snapshot $S/remove-style-tags.conv-b-06.xml
M=tests/scripts/fixtures/books/marks-006.fb2   # feature 006: the inline marks
node tests/scripts/run-script.mjs scripts/06_cleanup/02_general-cleanup $M --snapshot $S/general-cleanup.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/04_surname-initials $M --answer "А. С. Пушкин" --answer "Л. Н. Толстой" --snapshot $S/surname-initials.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/05_stuck-words $M --answer no --answer no --answer "" --answer "Слипшиеся. Слова" --answer "" --answer "слово Слово" --snapshot $S/stuck-words.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/07_large-numbers $M --answer "1 500 000" --answer "2 500 000" --snapshot $S/large-numbers.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/08_hyphen-vs-dash $M --answer "стоял — сказал" --answer "" --answer "стоял — сказал" --snapshot $S/hyphen-vs-dash.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/10_missing-full-stop $M --answer "" --answer "домой. Было" --answer "" --answer "домой. Было" --snapshot $S/missing-full-stop.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/14_broken-sentences $M --answer yes --snapshot $S/broken-sentences.marks-006.xml
node tests/scripts/run-script.mjs scripts/06_cleanup/21_remove-style-tags $M --snapshot $S/remove-style-tags.marks-006.xml
node tests/scripts/run-script.mjs scripts/09_poems/02_drama-speakers $M --answer 10 --answer yes --snapshot tests/scripts/snapshots/09/drama-speakers.marks-006.xml
G=scripts/07_Символы; B=tests/scripts/fixtures/books/conv-b-07.fb2; S=tests/scripts/snapshots/07
node tests/scripts/run-script.mjs "$G/01_Спецсимволы" $B --select n8:8:16 --answer '{"symbol":"§"}' --snapshot $S/special-symbols.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/02_Диакритика" $B --select n9:15:16 --answer '{"symbol":"é"}' --snapshot $S/diacritics.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/Арабский" $B --select n7:38:38 --answer '{"symbol":"ب"}' --snapshot $S/arabic.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/Валюта" $B --select n7:5:5 --answer '{"symbol":"€"}' --snapshot $S/currency.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/Греческий" $B --select n8:0:0 --answer '{"symbol":"α"}' --snapshot $S/greek.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/Древнерусский" $B --select n7:0:0 --answer '{"symbol":"ѣ"}' --snapshot $S/old-russian.conv-b-07.xml
node tests/scripts/run-script.mjs "$G/Иврит" $B --select n9:0:0 --answer '{"symbol":"א"}' --snapshot $S/hebrew.conv-b-07.xml
G=scripts/09_Стихи; B=tests/scripts/fixtures/books/conv-b-09.fb2; S=tests/scripts/snapshots/09
node tests/scripts/run-script.mjs "$G/01_Слияние подряд идущих стихов" $B --select n17 --snapshot $S/merge-adjacent-poems.conv-b-09.xml
node tests/scripts/run-script.mjs "$G/02_Драма..." $B --answer 10 --answer yes --snapshot $S/drama-speakers.conv-b-09.xml
node tests/scripts/run-script.mjs "$G/03_Слить параграфы" $B --select n49 --snapshot $S/merge-paragraphs.conv-b-09.xml
G=scripts/10_Статистика; B=tests/scripts/fixtures/books/conv-b-10.fb2; S=tests/scripts/snapshots/10
node tests/scripts/run-script.mjs "$G/01_Показать все ссылки" $B --snapshot $S/show-links.conv-b-10.xml
node tests/scripts/run-script.mjs "$G/02_Показать все-все ссылки" $B --snapshot $S/show-all-links.conv-b-10.xml
node tests/scripts/run-script.mjs "$G/03_Статистика документа" $B --snapshot $S/document-statistics.conv-b-10.xml
G="scripts/11_image-captions"; B=tests/scripts/fixtures/books/conv-b-11.fb2; S=tests/scripts/snapshots/11
node tests/scripts/run-script.mjs "$G/600_Заголовок картинки в подпись (strong)" $B --snapshot $S/caption-strong.conv-b-11.xml
node tests/scripts/run-script.mjs "$G/601_Заголовок картинки в подпись (emphasis)" $B --snapshot $S/caption-emphasis.conv-b-11.xml
node tests/scripts/run-script.mjs "$G/602_Заголовок картинки в подпись (subtitle)" $B --snapshot $S/caption-subtitle.conv-b-11.xml
node tests/scripts/run-script.mjs "$G/603_Заголовок картинки в подпись (subtitle, strong)" $B --snapshot $S/caption-subtitle-strong.conv-b-11.xml
node tests/scripts/run-script.mjs "$G/604_Заголовок картинки в подпись (subtitle, emphasis)" $B --snapshot $S/caption-subtitle-emphasis.conv-b-11.xml
G="scripts/12_quotes"; B=tests/scripts/fixtures/books/conv-b-12.fb2; S=tests/scripts/snapshots/12
node tests/scripts/run-script.mjs "$G/001_Расстановка елочек и лапок" $B --snapshot $S/place-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/002_Расстановка елочек и лапок (начиная с 1-го уровня)" $B --select n24:11:91 --snapshot $S/place-quotes-level1.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/003_Расстановка елочек и лапок (начиная со 2-го уровня)" $B --select n8:12:27 --snapshot $S/place-quotes-level2.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/004_Расстановка елочек и лапок (с позиции курсора)" $B --select n13:0:0 --snapshot $S/place-quotes-from-caret.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/005_Расстановка елочек и лапок (с позиции курсора, начиная с 1-го уровня)" $B --select n24:30:30 --snapshot $S/place-quotes-from-caret-level1.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/006_Расстановка елочек и лапок (с позиции курсора, начиная со 2-го уровня)" $B --select n24:47:47 --snapshot $S/place-quotes-from-caret-level2.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/007_Переход на след. елочки" $B --select n7:0:0 --snapshot $S/next-guillemets.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/008_Переход на пред. елочки" $B --select n20:0:0 --snapshot $S/previous-guillemets.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/009_Переход на пред. лапки" $B --select n20:0:0 --snapshot $S/previous-low-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/010_Переход на след. лапки" $B --select n7:0:0 --snapshot $S/next-low-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/011_Переход на пред. прямые кавычки" $B --select n7:12:12 --snapshot $S/previous-straight-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/012_Переход на след. прямые кавычки" $B --select n7:12:12 --snapshot $S/next-straight-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/013_Переход на пред. прямые кавычки, елочки или лапки" $B --select n20:0:0 --snapshot $S/previous-any-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/014_Переход на след. прямые кавычки, елочки или лапки" $B --select n7:0:0 --snapshot $S/next-any-quotes.conv-b-12.xml
node tests/scripts/run-script.mjs "$G/015_Расстановка только елочек" $B --snapshot $S/place-guillemets-only.conv-b-12.xml
```

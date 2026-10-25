# Clipboard fixtures (feature 006, table editing)

Self-written HTML that resembles what each program puts on the clipboard as `text/html`, with
the conversion the editor's paste must give for it. Written for the project on 2026-10-26
(decision 7 of the plan: self-written fixtures, no captures by the requester and no capture
page). None of it was captured from the programs it resembles; the real output of Word, Excel,
LibreOffice and Google Docs and Sheets is checked in the requester's manual check (SC-012;
`specs/006-table-editing/quickstart.md` §16). The files are the project's own work under its
licence, GPL-3.0-only (`contracts/resource-formats.md` §18); nothing here is installed.

Read by `ui/tests/unit/editor/clipboard/foreignHtml.test.ts`, `pastedCss.test.ts` and
`sc012.test.ts`, and by the journey `ui/tests/e2e/us9-table-clipboard.spec.ts`.

## The fixtures

| File | Resembles | What it holds |
|---|---|---|
| `word-win.html` | Microsoft Word for Windows | the `xmlns:o` / `xmlns:w` root, `<!--StartFragment-->`, a `<style>` inside `<!-- -->` with `@font-face`, `@page` and `@list` at-rules and `p.MsoNormal` / `.MsoTableGrid` rules; `valign=top` on every cell; a header row of bold `td` (whether Word writes `th` or `thead` is unverified, quickstart open point 2); `colspan=2` and `rowspan=2`; cell paragraphs with `<o:p></o:p>`; a list paragraph whose `<span style='mso-list:Ignore'>` marker is removed; a VML shape with a text box (removed) and its `<img>` fallback (removed); `text-align:center` on a cell's paragraph; `<p class=MsoNormal><o:p>&nbsp;</o:p></p>` after the table, kept outside a table (C45) |
| `writer.html` | LibreOffice Writer | the generator `meta`, `<col width>` (removed), `<td valign="top">`, header cells `<p align="center"><b>…</b></p>`, a table nested in a cell (joined into the cell's text) and `<p><br/></p>` after the table (an empty paragraph: no block) |
| `calc.html` | LibreOffice Calc | `cellspacing="0" border="0"`, `<colgroup>`, `sdval` / `sdnum`, right-aligned numbers, `valign=bottom`, a bold header row, a `colspan="2" rowspan="2"` block with `align` and `valign`, and a cell note in a `<comment>` element that the rule `comment { display:none; }` hides (dropped) |
| `excel-win.html` | Microsoft Excel for Windows | `xmlns:x`, unquoted attributes, a `<style>` inside `<!-- -->` with the `td` rule (`font-weight:400`, `text-align:general`, `vertical-align:bottom`) and the classes `.xl65` (`font-weight:700; text-align:center`) and `.xl66`; `<col>` elements; a merged header `colspan=2`; a hidden row `<tr style='display:none'>` (dropped). The journey pastes it with `tests/fixtures/images/tiny.png` beside it and expects a table, not a picture (data-model §8.9) |
| `gdocs.html` | Google Docs | everything inside `<b style="font-weight:normal;" id="docs-internal-guid-…">`, which is not bold; `<colgroup>`; `vertical-align:top` on every cell; cell paragraphs with `text-align:center`; spans with `font-weight:700` and `font-style:italic`; a link to `https://example.org/…`; an external `<img src="https://…">` in a cell (dropped, never fetched, U28) |
| `gsheets.html` | Google Sheets | `<google-sheets-html-origin>`, a `<style>` with `td {…}` and `br {mso-data-placement:same-cell;}`, `data-sheets-root` and `data-sheets-value`, `colspan="2" rowspan="1"`, `text-align:center;font-weight:bold` and `vertical-align:bottom` in cell styles, a `<br>` in a cell (a space), an empty cell |
| `firefox-web.html` | a web table copied in Firefox | a `<caption>` (a paragraph directly before the table), `<thead>`, `<tbody>` and `<tfoot>` in that order, `th` cells, a `colspan="2"` header and a `rowspan="2"` cell, links, `<sup>`, `<b>`, `<i>`, `text-align:-moz-center` and `text-align:right`; `id`, `lang`, `class` and `data-*` attributes, which are never taken; an external `<img>` and a `<link rel="stylesheet" href="https://…">`, which make no request (U28) |
| `irregular-web.html` | an irregular web table | rows of different lengths, a banner row `colspan="99"` over rows of four cells (four columns after the phantom-column collapse of foreign tables, C42), an overlap (`M` over the rowspan of `J`), and the spans `"2"`, `" 3 "`, `"0"`, `"2.5"`, `"abc"`, `"-1"` and `"1000000"`; the expectation is the regular result (FR-059) |
| `mixed.html` | a web page with text and tables | a paragraph, a table, a paragraph, a second table and a paragraph: outside a table the order is kept (the spec's edge case); in a cell everything joins the cell (decision 5), which the journey checks |
| `web-source.html` | the page of the live capture | the page `us9-table-clipboard` opens in a second page of the browser context and copies from, live, in CI: a paragraph, a table with a `thead` row of `th`, a `colspan="2"`, a `rowspan="2"`, bold, italic, a link and `<sup>`, and a paragraph; self-contained (no external resource, script or web font), so the run makes no request |

## The expectations

Each fixture has `<name>.expected.json`:

```text
{ "blocks": [ {"p": {"text", "marks"?}} | {"table": {"rows": [[{"k": "td" | "th", "t", "cs"?, "rs"?, "al"?, "va"?, "m"?}]]}} ],
  "tsv": string }
```

- `blocks` is the conversion of a paste outside a table, in document order: the caption
  paragraph, the no-break-space paragraphs that are kept and the paragraphs around the tables
  included. Empty paragraphs (Writer's `<p><br/></p>`, Chromium's
  `<br class="Apple-interchange-newline">`) give no block, as today's empty-paragraph filter
  (`ui/src/editor/plugins/clipboard.ts`, `flattenToParagraphs`).
- A paragraph gives `text` (the text as today's parse of the HTML around the tables gives it,
  `parseSlice` and `flattenToParagraphs`) and `marks`, the sorted set of the mark types in it,
  only when not empty.
- A table gives its rows in order (`thead` rows, then `tbody` and direct rows, then `tfoot`
  rows); each cell gives:
  - `k`, `th` for a `th` element or any cell of a `thead` row, else `td`;
  - `t`, its text with white space collapsed and pictures dropped;
  - `cs` and `rs`, the spans, only above 1;
  - `al` and `va`, only where the converter keeps one;
  - `m`, the sorted set of the mark types in the cell (`code`, `emphasis`, `link`,
    `strikethrough`, `strong`, `sub`, `sup`), only when not empty.
- `tsv` is the editor's copy of those blocks as text (`contracts/resource-formats.md` §20):
  cells joined by `\t`, rows by `\n` with none after the last row, a merged cell's text at its
  top-left position and empty fields for its other positions, blocks by `\n\n`.
- `web-source.expected.json` gives the grid of the page's table alone, as Chromium copies it when
  the table is selected: the author CSS is inlined into the cells, the table carries
  `font-weight: 400` and `text-align: start`, and `<br class="Apple-interchange-newline">`
  follows it (seen with the Chromium of Playwright 1.64 on 2026-10-26); neither changes the
  grid, the header cells stay without a mark.

Every value was worked out by hand from `specs/006-table-editing/data-model.md` §8.5 (foreign
HTML) and §8.6 (`regularisePastedTable`), as the shared grid vectors are; in short:

- **Removed inside a table**: hidden elements (`display:none` or `visibility:hidden`, inline or
  by a rule), Word's `mso-list:Ignore` markers, `o:p` and VML shapes, and `img`, `picture`,
  `svg`, `video`, `audio`, `canvas`, `iframe`, `object`, `embed`, form controls, `script`,
  `style`, `template`, `noscript`, `colgroup` and `col`.
- **CSS** comes from the `<style>` text (comments and Office's `<!-- -->` wrappers removed,
  at-rules dropped), the matching rules in stylesheet order, then the `style` attribute; CSS wins
  over the `align` and `valign` attributes.
- **Spans** that match `^\s*\d+\s*$` and are 1 or more are kept (capped at 1000 and 65534); any
  other value counts 1.
- **Alignment**: `left`, `center`, `right` (also `-webkit-` / `-moz-` prefixed); `top` /
  `text-top`, `middle` / `center`, `bottom` / `text-bottom`; anything else (Excel's
  `text-align:general`, `start`) gives none. A cell's `al` is its own, else the uniform
  alignment of the blocks its text stands in, else its row group's, else the table's CSS
  `text-align`; its `va` is its own, else its row's, else its row group's. Values are kept as
  given, defaults included (Word's `valign=top`, Excel's and Sheets' `vertical-align:bottom`).
- **Cell content** is one inline run: `<br>` gives a space, block elements are separated by
  spaces (a nested table joins its cell's text), white space collapses; bold or italic set on
  the cell or inherited becomes a mark over the whole content (a `b` ancestor whose own style
  says `font-weight:normal` does not count, as in Google Docs); links keep their `href`.
- **Regular result** (foreign tables): rows in which no cell starts are dropped; phantom
  columns, reached only by a span that runs past every other row, are removed
  (`irregular-web.html`: the banner's `colspan="99"` becomes 4); then *Repair table*'s steps:
  an overlapping cell's colspan is reduced (`M` to 1), rowspans past the end are cut (`P`'s
  `rowspan="1000000"`, 65534 after the cap, to 1), and short rows get empty `td`s at their end.

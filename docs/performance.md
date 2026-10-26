# Performance

Budgets (SC-002, constitution section IV; release gates) and how the editor meets them. The
numbers are produced by `tests/bench/run.sh` (see `tests/bench/README.md`); re-run it and
update this page when the reader, the binary store or the Body view windowing change.

## Budgets

| Journey | Budget |
| --- | --- |
| 10 MB text-only book: File > Open until the Body view is editable | 3 s |
| 150 MB image-heavy book: File > Open until the Body view is editable | 15 s |
| 150 MB image-heavy book: peak resident memory of `mfbe-core` | 1.5 GB |
| Typing in the 10 MB book (keystroke to painted frame, median of 50) | 100 ms |
| Tree navigation in the 10 MB book (click until the Body caret moved, median of 7) | 100 ms |
| Source view of the 10 MB book: tag completion list after the last keystroke (feature 003, FR-074) | 300 ms |
| Source view of the 10 MB book: typing with and without the completion list (keystroke to painted frame, median of 11) | 100 ms |
| Body ↔ Source switch of the 10 MB book: the caret/selection mapping step (round-trip median with the mapping minus the median without it, 5 round trips each; feature 004, FR-073) and every `doc.mapPositions` call in the core | 100 ms × `MFBE_PERF_FACTOR`; 100 ms |
| Document Tree divider on the 10 MB book: every layout step of a drag (pointer move → forced layout → painted frame, 20 steps; feature 004, SC-001) | 100 ms × `MFBE_PERF_FACTOR` |
| Description import with the 10 MB book as the source: File > Import until the status bar reports the import (feature 004, FR-031 — the constitution's opening budget applied to the source file; the import's apply step and the FBD export have no budget of their own) | 3 s × `MFBE_PERF_FACTOR` |
| File > Open of the 10 MB book with a remembered position: until the Body view is editable with the caret in place (feature 004, US8) | 3 s |
| AI assistant request on the 10 MB book: the validation of the working copy in the core after every change the request makes (`doc.validate`; feature 005, FR-060 — research R5's acceptance number for a locked request, not a constitution budget) | 1 000 ms × `MFBE_PERF_FACTOR` |
| Table commands on a 300 × 10 table and on the largest real shapes, 628 × 4 and 298 × 14, in the 10 MB book (command to painted frame, median of 5 per command; feature 006, SC-005) | 100 ms × `MFBE_PERF_FACTOR` |
| Table commands on a 1000 × 20 table in the 10 MB book (every run; feature 006, SC-005) | 1 s |
| Typing in the 10 MB book after a table command (keystroke to painted frame, median of 11; feature 006) | 100 ms |

## Measurements (T150)

Development host: 4 vCPU shared VM, 8 GB RAM, Linux; **Debug** build of the core
(`linux-core-debug`, `-O0`; a release build is faster on every core-side number); headless
Chromium 1280 x 800; fixtures from `tests/fixtures/gen-large-book.py` — `large-10mb.fb2`
(10.0 MB, 201 sections x 120 paragraphs of ~1 000 characters) and `images-150mb.fb2`
(148.6 MB, 300 sections with one block image each, 200 noise PNGs + 100 baseline JPEGs).

| Metric | Before | After | Budget |
| --- | ---: | ---: | ---: |
| 10 MB: open -> editable | 927 ms | 819–897 ms | 3 000 ms |
| 10 MB: keystroke median / p95 (50 strokes) | 36 / 55 ms | 15 / 16 ms | 100 ms (median) |
| 10 MB: tree click -> caret median / max (7 clicks) | **112** / 142 ms | 35–39 / 45–54 ms | 100 ms (median) |
| 10 MB: File > Save (modified, as a job) | 2 130 ms | 1 630–1 770 ms | — |
| 10 MB: core-only `roundtrip` open / write | 174 / 285 ms | 173 / 282 ms | — |
| 150 MB: open -> editable | — | 2 136–2 214 ms | 15 000 ms |
| 150 MB: mounted previews loaded after editable (20 of 20) | — | +13–26 ms | — |
| 150 MB: peak RSS of `mfbe-core serve` (VmHWM) | — | 517–518 MB | 1 536 MB |
| 150 MB: File > Save | — | 3 079–3 197 ms | — |
| 150 MB: core-only `roundtrip` open / write / peak RSS | — | 1 946–2 131 / 2 880–2 953 ms / 528 MB | 1 536 MB |

"Before" is the state at the start of T150 (commit `90572e7`); "after" spans three runs on
2026-10-13 (`tests/bench/run.sh --json` writes `tests/bench/results/bench-<timestamp>.json`,
git-ignored; the numbers are copied here). All budgets hold with a Debug core; the only metric
that was over budget was tree navigation in the 10 MB book.

**Source view tag completion** (feature 003 User Story 8, measured 2026-10-17 by the second
journey of `ui/tests/e2e/perf-large-book.spec.ts` on the same host and Debug core, cursor in the
last section of the 10 MB book, two runs): the list appears 127–133 ms after the last keystroke
of `<sec` (budget 300 ms; 100 ms of it is CodeMirror's typing debounce, the rest the query and
the paint); keystrokes while the list filters (`tion`) and after it closed (` id="x"`) take
14.3–15.7 ms median, 15.4–16.0 ms worst (budget 100 ms). The completion source runs after the
debounce, off the keystroke path, resolves the context from the syntax tree parsed so far (at
most 50 ms of extra parsing per query) and relies on CodeMirror's synchronous filtering
(`validFor`) while a name is typed.

**Body ↔ Source caret and selection mapping** (feature 004 User Story 7, FR-073; measured
2026-10-21 by the third journey of `ui/tests/e2e/perf-large-book.spec.ts` on the same host with
the **Release** core, the caret in a mounted paragraph of the 10 MB book, the text already
serialised): a Body → Source → Body round trip takes 63–74 ms with the mapping (median 64 ms)
and 62–63 ms without it (median 63 ms) — a mapping step of **1 ms** against the budget of
100 ms × `MFBE_PERF_FACTOR`; every `doc.mapPositions` call took under 0.05 ms in the core
(budget 100 ms). The map is recorded once, while the text is serialised or parsed (one byte
loop in the writer; the parser's input position at every tag, ≈1 ms per parse of the 10 MB
book), and a request resolves two points in O(log n) plus a scan of one paragraph, so the
switch itself - the Source editor's mount - is what costs the time
(`docs/architecture.md`, "Position map").

**Document Tree divider** (feature 004 User Story 1, SC-001; measured 2026-10-21 by the `@perf`
section of `ui/tests/e2e/us1-tree-divider.spec.ts` on the same host with the Release core, the
10 MB book open in the Body view): a drag of 20 synthetic pointer moves costs **38 ms per layout
step** (median; 46 ms worst) against the budget of 100 ms × `MFBE_PERF_FACTOR`, with 6 898
spelling marks in the mounted text. Each step is one forced layout of the pane and the view
area: the drag writes the clamped width to one CSS variable per animation frame, without React
state, and the Body view re-wraps its mounted window. One finding shaped the measurement: the
spelling highlighter decorates the opened book in a single transaction — thousands of marks in
one frame — a few hundred milliseconds after the open, and a step that happened to land on that
frame would have been charged for it; the journey therefore waits for the marks to settle
before it starts dragging, and the number above is the layout step alone. Books with few marks
re-layout faster; the marks are decorations of the mounted window only.

**Description import with the 10 MB book as the source** (feature 004 User Story 4, FR-031;
measured 2026-10-21 by the `@perf` section of `ui/tests/e2e/us4-import-description.spec.ts`,
Release core): the whole file is read as Open reads it and only the description arrives;
File > Import until the status bar reports the import took **117 ms** against the opening budget
of 3 s × `MFBE_PERF_FACTOR` that applies to the source file. The import's apply step and the FBD
export have no budget of their own (requester, 2026-10-20: the FBD is a small file).

**Open with a remembered position** (feature 004 User Story 8; measured 2026-10-21 by the
fourth journey of `perf-large-book.spec.ts`, Release core): reopening the 10 MB book with a
position remembered in a paragraph three quarters into the book, the Body view is editable with
the caret in place and scrolled into view after **592 ms** against the 3 s opening budget — the
same run opened the book without a position in 677 ms, so the resolution of the structural path
against the loaded model (one walk per segment) adds nothing measurable to the open.

**AI assistant: the validity hook on the 10 MB book** (feature 005 User Story 4, FR-060 to
FR-065; measured 2026-10-23 by the one `@perf` journey of feature 005 in
`ui/tests/e2e/us4-ai-validity.spec.ts` on the same host - the 4 vCPU shared VM - with the
Release core, the 10 MB book of `tests/fixtures/gen-large-book.py` open and the loopback stand-in
answering without delay): a request of five `replace_node` changes spread over the book
validates the whole working copy after each change - `doc.validate({docId, document})`, the
10 MB model sent to the core as a job - in **65–73 ms per validation in the core** against the
acceptance number of 1 000 ms × `MFBE_PERF_FACTOR` (research R5); the hook's round trip per
change (`change.try` → `change.accepted`: the fragment parse, the pre-check, the write to the
copy, the transfer and the validation) is ≈ 340 ms, and the request end to end (Enter → done,
six exchanges) ≈ 3.6 s. The commit calls no `doc.toXml` (310 ms at 10 MB, R5 §4), which the
journey asserts from the record of the page's JSON-RPC methods. With the assistant off nothing
of the feature runs (SC-013) and the numbers above stand: the same day's run of the `@perf`
journeys on the Release core opened the 10 MB book to an editable Body view in 617 ms, typed
at ~15 ms per keystroke (median) and mapped the caret between Body and Source in 1 ms.

**Table commands (feature 006, SC-005)** (measured 2026-10-26 by
`ui/tests/e2e/perf-tables.spec.ts` on the same host - the 4 vCPU shared VM - with the Release
core, three runs: `MFBE_PERF_FACTOR` 2, 1, and within the whole `@perf` line; the SC-005 book of
`tests/fixtures/gen-large-book.py --size-mb 10 --table 300x10@1:4 --table 1000x20@3:8 --table
628x4@4:2 --table 298x14@5:4`, the 10 MB book with a 300 × 10 table in section 1, a 1000 × 20
table in section 3 and the census's largest real shapes, 628 × 4 in section 4 and 298 × 14 in
section 5; the 25 table buttons on the Commands toolbar, each command started by a click on its
button and timed to the first animation frame after the table shows the result, Undo between the
runs): the medians of five runs of the 24 commands and *Table…* (from the dialog's OK) are
**14–35 ms** on the 300 × 10 table (slowest *Delete table*, 33–35 ms, then *Merge cells*,
*Duplicate column* and the column insertions), **23–51 ms** on 628 × 4 and **27–56 ms** on
298 × 14 (slowest *Table…*, then *Move column left*, *Merge cells* and *Duplicate column*)
against 100 ms × `MFBE_PERF_FACTOR`; on the 1000 × 20 table every run of every command took
**34–132 ms** (slowest *Insert column left*, *Duplicate column*, *Merge cells* and *Select
table*, 100–132 ms) against 1 s. The pastes, each replayed from the three flavours of a copy
event: a 10 × 5 block into a cell 28–29 ms on 300 × 10, 59–63 ms on 628 × 4 (which grows by two
columns for it), 43–45 ms on 298 × 14 and at most 151 ms on 1000 × 20; each table's own copy
after a paragraph of section 2 50–53 ms, 46–51 ms, 62–65 ms and at most 317 ms for the 20,000
cells of the 1000 × 20 copy. Typing in a paragraph of section 2 after the commands on each table:
**15 ms** per keystroke (median of 11; budget 100 ms); typing in a cell of the 1000 × 20 table
with every table button on the toolbar: 65–76 ms (budget 100 ms × `MFBE_PERF_FACTOR`). Recorded,
without a budget (quickstart open point 7): a keystroke in a paragraph of section 3, in the
window that holds the 1000 × 20 table, costs 31–33 ms, 16–19 ms more than in section 2 - the
write-back of that window (research R1.9); the text form of `doc.validate` on the whole book's
text takes 272–286 ms (round trip from the journey) whether the 300 × 10 table is regular or
irregular, the difference (−5 to +14 ms) within the noise: the positions the text form reads for
`table.irregular` cost nothing measurable, far under the 1 000 ms × `MFBE_PERF_FACTOR` the
assistant's validations are held to, so the fallback of `contracts/rpc-api.md` (open point 1, a
second scratch read) is not needed. File > Open of the book until the Body view is editable took
811–963 ms (budget 3 s). In the Source view of the book, ready 1.1–1.5 s after View > Source,
*Add > Table* was available **121–226 ms** after the cursor was put between two paragraphs - the
verdict's 100 ms notification included - against 3 s × `MFBE_PERF_FACTOR`, a project number
rather than a constitution budget (research R4.8). *Repair table* from the mark's popover
(`ui/tests/e2e/us8-table-marks.spec.ts`, sc.9; quickstart §14, "Timed elsewhere") removed the
mark 5–6 ms after the click (three runs; budget 100 ms × `MFBE_PERF_FACTOR`). The journey writes
its figures to `tests/bench/results/table-commands.json`, which CI's `bench-results` artifact
carries and the release workflow prints in its job summary.

## What was changed (T150)

**Section window node budget** (`ui/src/editor/virtualization.ts`). The Body view mounts a
window of top-level sections (research D3). The window used to be a fixed 20 sections; with
the 10 MB fixture that is 2 400 long paragraphs (~2.4 MB of text) per window, and a tree click
that re-centres the window spent ~75 ms in ProseMirror's view update plus the forced layout of
the new DOM (CPU profile: `updateStateInner` 63 ms self time per move), 112 ms median end to
end. The window is now bounded by content as well: a fresh window holds at most `windowSize`
(20) sections *and* at most `WINDOW_NODE_BUDGET` (600) element nodes (paragraphs, titles,
containers; text excluded; at least one section). Ordinary books (30–60 paragraphs per
chapter) still mount 10–20 sections; the fixture mounts 4. Extension steps ("… N more
sections") and the `MAX_WINDOW_FACTOR` trim limit scale with the same fit, so the DOM stays
bounded while scrolling, and `windowAround()` re-centres the smaller window on the navigation
target (the target is always mounted). Whole-book mode additionally requires at most
`WHOLE_BOOK_NODE_BUDGET` (10 000) element nodes, so a 10 MB book with 30 huge sections is
windowed too. Weights are memoised per model object (`WeakMap`), so edits recompute only the
changed subtree. Effects: tree navigation 112 -> 37 ms, keystroke 36 -> 15 ms (smaller
contenteditable), first paint slightly faster. Unit tests: `ui/tests/unit/editor/windowBudget.test.ts`.

Not changed, measured as adequate:

- `doc.open` returns the whole model as one JSON message (about 12 MB for the 10 MB book);
  the core parses the file in ~175 ms (Debug), the UI becomes editable ~650 ms later (JSON
  transfer and parse, tree index, first window). Compression was not needed for the budget.
- The binary store spills payloads above 32 MB per document to temporary files; the 150 MB
  book keeps the core at 518 MB peak RSS (binaries are decoded from base64 while parsing and
  never travel over JSON-RPC; previews are scaled on demand and cached).
- Image previews of the first window (20 images) arrive within ~25 ms after the view is
  editable; the Body view only mounts the window's images.

## Fast mode (T154)

View > Fast Mode (F5; Settings > View) keeps the same document and window and removes the
decorations (`editor/fastMode.ts`, `.mfbe-body-view--fast` in `editor/styles.css`): no
section/epigraph/cite frames and backgrounds, titles as plain bold text, no coloured text or
table cell backgrounds, image previews collapsed to a placeholder box, no NBSP markers. It is
a paint-cost reduction for very large or image-heavy books, not a different editor; the
section window size is unchanged (the controller owns it).

## Running the benchmark

```bash
tests/bench/run.sh --json            # 10 MB + 150 MB journeys, core-only round trip
tests/bench/run.sh --skip-150 --json # what CI runs (Linux e2e job)
```

Options and the full method are in `tests/bench/README.md`. CI runs the 10 MB part on every
push; the 150 MB part is a local/nightly run (hosted runners are slow and short on memory).

## Script runs (feature 002, T054–T058)

Budget (SC-008, FR-050): every bundled non-interactive clean-up script finishes on a typical
1 MB book in under 5 s on a 2020-era laptop, and on a 10 MB book in at most 12 times its 1 MB
time.

`ui/tests/e2e/perf-scripts.spec.ts` (tag `@perf`) opens the books of
`tests/bench/gen-text-book.py` — `clean-1mb.fb2` (5,000 paragraphs in 100 sections) and
`clean-10mb.fb2` (50,000 in 1,000), generated into `tests/bench/books/` (git-ignored) when
missing — and runs each script through `window.__mfbeTest.scripts.run` on the unchanged book
(one Undo after every run), timed in the page from the start of the run to its end; the final
report message is answered at once.

- Every change (`.github/workflows/ci.yml`, apart from the journeys, one worker): each 10 MB
  time at most 12 times its 1 MB time, each 1 MB time under 5 s × `MFBE_PERF_FACTOR`.
- Release (`.github/workflows/release.yml`): the same run; the times go to the job summary and
  the `script-benchmark` artifact (`MFBE_PERF_RESULTS=<file>` writes them as JSON).
- The 5-second budget itself is confirmed on the reference laptop in the requester's release
  smoke test.
- `MFBE_PERF_FACTOR` (default 2) allows for the hosted CI runners against a 2020-era laptop:
  the runners are 2–3 times slower than the development host (`ui/playwright.config.ts`).

```bash
cd ui && MFBE_CORE_BIN=<mfbe-core> npx playwright test --grep @perf --workers=1
```

Measured: the four 06 clean-ups below, place quotes and guillemets (12/001, 12/015) and the
non-asking subtitle and empty-line clean-ups (13/525, 13/526, 13/528). Not measured: the 06
scripts that ask about every place they change (04, 05, 06, 07, 08, 10, 14, 15, 16, 19, 20),
13/527 (asks first), 06/12 (works on a notes body, which the generated books do not have),
the other place-quotes variants (12/002–006: the 12/001 engine started at another level or at
the caret) and 12/007–014, which only move the selection.

Development host (4 vCPU VM shared with other jobs, Debug core, headless Chromium), four runs
on 2026-10-15, milliseconds:

| Script | 1 MB before | 1 MB after | 10 MB after | 10 MB / 1 MB |
| --- | ---: | ---: | ---: | ---: |
| 06/general-cleanup | 8 473 | 564–1 184 | 3 848–5 188 | 3.4–6.8 |
| 06/latin-to-cyrillic | 282 | 287–487 | 1 588–1 862 | 3.4–6.1 |
| 06/external-links-to-text | 88 | 101–160 | 690–971 | 5.1–6.8 |
| 06/remove-style-tags | 103 | 100–172 | 742–875 | 4.8–7.8 |
| 12/place-quotes | 3 219 | 84–155 | 492–686 | 4.2–7.3 |
| 12/place-guillemets-only | 3 136 | 86–145 | 502–613 | 3.7–6.8 |
| 13/subtitles-empty-lines | 32 | 32–55 | 101–120 | 2.0–3.8 |
| 13/subtitles-empty-lines-unbold-titles | 24 | 32–81 | 98–158 | 1.4–4.4 |
| 13/subtitles-empty-lines-plain-titles | 27 | 44–76 | 112–140 | 1.5–3.2 |

"Before" is release 0.0.1's run model (commit `d5581a8`, one run); its 10 MB times were not
taken: every change cost time in proportion to the whole book. During the 10 MB runs of
06/general-cleanup, 12/place-quotes and 06/latin-to-cyrillic no frame of the window took longer
than 40 ms.

What changed: a run reads and writes a working copy of the document
(`ui/src/scripting/workingCopy.ts`) whose node index is kept current by every write and whose
writes copy only the nodes on the way to the change; before the script's dialogs and
selection calls the working copy is shown in the editor without an undo step; at the end the
document is replaced in one editor transaction and the run is one undo entry holding the
documents before and after it (`recordSnapshot` in `ui/src/model/undo.ts`). Before, every
write was an editor transaction (decorations, the window converted back to JSON, the store
updated and the window re-rendered) or a model step walking the whole book, and the node index
was rebuilt after each write.

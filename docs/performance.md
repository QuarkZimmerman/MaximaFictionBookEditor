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

Development host (4 vCPU VM shared with other jobs, Debug core, headless Chromium), three runs
on 2026-10-15, milliseconds:

| Script | 1 MB before | 1 MB after | 10 MB after | 10 MB / 1 MB |
| --- | ---: | ---: | ---: | ---: |
| 06/general-cleanup | 8 473 | 564–1 184 | 3 848–5 188 | 3.4–6.8 |
| 06/latin-to-cyrillic | 282 | 299–487 | 1 588–1 862 | 3.4–5.3 |
| 06/external-links-to-text | 88 | 104–160 | 705–971 | 5.1–6.8 |
| 06/remove-style-tags | 103 | 102–172 | 742–875 | 4.8–7.3 |
| 12/place-quotes | 3 219 | 84–155 | 610–686 | 4.2–7.3 |
| 12/place-guillemets-only | 3 136 | 86–145 | 531–613 | 3.7–6.8 |
| 13/subtitles-empty-lines | 32 | 32–55 | 108–120 | 2.0–3.8 |
| 13/subtitles-empty-lines-unbold-titles | 24 | 36–81 | 111–158 | 1.4–4.4 |
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

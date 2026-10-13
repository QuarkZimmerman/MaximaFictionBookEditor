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

# Performance benchmarks (T150)

Release gates from the constitution (section IV) and SC-002:

| Journey | Budget |
| --- | --- |
| 10 MB text-only book: File > Open until the Body view is editable | < 3 s |
| 150 MB image-heavy book: File > Open until the Body view is editable | < 15 s |
| 150 MB image-heavy book: peak resident memory of `mfbe-core` | < 1.5 GB |
| Typing in the 10 MB book: keystroke latency (median of 50) | < 100 ms |
| Tree navigation in the 10 MB book: click until the Body caret moved (median of 7) | < 100 ms |
| Save of both books, preview loading, core-only round trip | recorded, no budget |

## Running

```bash
# once: build the core and the UI, install Playwright's Chromium
cmake --build --preset linux-core-release
(cd ui && npm ci && npm run build && npx playwright install chromium)

tests/bench/run.sh --json             # both books; results in tests/bench/results/
tests/bench/run.sh --skip-150 --json  # the 10 MB part only (what CI runs)
```

Options: `--core PATH` (default `MFBE_CORE_BIN` or `build/linux-core-{release,debug}/bin/mfbe-core`),
`--ui-dist DIR`, `--work-dir DIR` (default `build/bench`), `--keystrokes N`, `--headed`.

The runner (`bench.mjs`, plain Node + Playwright, no test framework):

1. generates the fixtures into the work directory when missing — `large-10mb.fb2` with
   `tests/fixtures/gen-large-book.py --size-mb 10` and `images-150mb.fb2` with
   `--size-mb 150 --images 300` (300 sections with one block image each; 200 noise PNGs and
   100 baseline JPEGs written by the pure-Python encoders of the generator, no Pillow needed;
   deterministic for a seed) — `gen-image-book.py` is a wrapper with these defaults;
2. runs the core-only micro benchmark `mfbe-core roundtrip <book> --out <dir> --json` for both
   books (open / write / total times, peak RSS of the CLI process);
3. starts `mfbe-core serve --test-hooks` serving `ui/dist`, opens the application in headless
   Chromium and drives the real menus: File > Open (`test.enqueueDialog` answers the native
   dialog), 50 keystrokes in a mounted paragraph, seven tree clicks to far-away sections,
   File > Save, then the same for the 150 MB book. Timings are taken in the page
   (`performance.now()` plus `requestAnimationFrame` so a value includes the paint);
4. samples `test.metrics` after every phase and reads the core's `VmHWM` from `/proc` for the
   peak;
5. prints the table, writes `results/bench-<timestamp>.json` with `--json` and exits 1 when a
   budget is exceeded (2 when the benchmark could not run).

Binary spill files and the error log go to `<work-dir>/tmp` and `<work-dir>/data` (`TMPDIR` is
pointed there: a tmpfs `/tmp` would count against RAM). Nothing under the work directory or
`results/` is committed.

## CI

`.github/workflows/ci.yml` runs `tests/bench/run.sh --skip-150 --json` in the Linux e2e job
(10 MB journeys only: hosted runners are slow and have little memory). The 150 MB part is a
local / nightly run on a developer machine; record the numbers in `docs/performance.md` when
the reader, the binary store or the Body view windowing change.

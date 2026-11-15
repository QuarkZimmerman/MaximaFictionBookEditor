# Corpus tooling

`sample.py` picks a deterministic, seeded sample of books from the local library
`/book_disk/books/` (layout `<range>/<sub-range>/<id>/<id>.fb2`, hundreds of
thousands of books, mixed encodings, some invalid files, some `.fbd`
descriptors). It only reads the library and writes `sample-<seed>-<count>.txt`
here (git-ignored).

`run.sh` (added with the round-trip task) opens, saves and validates every
sampled book with `mfbe-core roundtrip` and prints the summary used as the
release gate: opened / round-tripped / validated / invalid-with-message /
crashed (must be 0) / image binaries not JPEG or PNG after save (must be 0).

## Strata (feature 006, SC-004)

The gate's list `sample-1-50.txt` holds no table, so the table editing feature
adds two strata. Both lists stay local and git-ignored (`.gitignore`:
`tests/corpus/sample-*.txt`) and are made again with the recipes below.

`sample.py` has two modes for them besides the whole-library mode:

- **Draw mode** (`--containing TEXT`, `--matching REGEX`, or both): book ids
  drawn from 1 to `--max-id` (default 652500) by `random.Random(--seed)` in a
  fixed order. Each path is built from the id as the library lays it out
  (`<range of 250,000>/<range of 500>/<id, 8 digits>/<id>.fb2`, each range
  `%08d-%08d`), with no directory listing - the NFS mount is slow - and ids
  without a file are skipped. `--threads` reader threads (default 8) read each
  candidate once. A book is kept when its bytes hold TEXT, in an
  ASCII-compatible encoding or in UTF-16 LE or BE, and when its text, decoded
  by its BOM or XML declaration, matches REGEX. The first `--count` matches in
  draw order are written sorted to `--out`, the same list whatever the number
  of threads.
- **Ids mode** (`--ids ID [ID ...]`): writes the paths of the given ids to
  `--out`; a missing one is reported, and the exit code is then 1.

Both modes need `--out`.

### The table stratum

Books that contain a table, UTF-16 books included:

```bash
python3 tests/corpus/sample.py --containing "<table" --count 300 --seed 6 --out tests/corpus/sample-tables-6-300.txt
tests/corpus/run.sh tests/corpus/sample-tables-6-300.txt --core build/linux-core-release/bin/mfbe-core
```

The first command reads about 33,000 books (53 GB): about 8 minutes with 8
threads. `run.sh` takes one list (`run.sh:4`), so the release-time gate runs it
on this list explicitly; the corpus CTest (`tests/core/corpus_roundtrip_test.cpp`)
reads every `sample-*.txt` in this folder, this list included.

### The inline stratum

`sample-inline-marks.txt`: the census's example books for the inline content
of feature 006 (FR-067 to FR-069) and for carriage returns (FR-065), by id,
plus five books with pictures in links and five with pictures in formatting,
drawn with seed 6:

```bash
python3 tests/corpus/sample.py --out /tmp/inline-ids.txt --ids \
    584109 585763 444039 497780 412140 \
    254742 15506 306806 542288 12218 \
    492007 332731 504320 \
    423778 \
    37354 \
    16659 26022 36254 42983 47019 61602 66863 230365 233217 239142 239423 259784 320758 \
    325075 364200 377000 378174 383978 437714 446498 457051 474228 478936 496284 571202 608549 \
    22657 29089 29716 37538 51264 52004 96703 99319 212492
python3 tests/corpus/sample.py --matching '<a\b[^>]*>\s*<image\b|<image\b[^>]*/>\s*</a>' \
    --count 5 --seed 6 --out /tmp/inline-image-in-link.txt
python3 tests/corpus/sample.py --matching '<(strong|emphasis|strikethrough|sub|sup|code|style)\b[^>]*>\s*<image\b' \
    --count 5 --seed 6 --out /tmp/inline-image-in-mark.txt
sort -u /tmp/inline-ids.txt /tmp/inline-image-in-link.txt /tmp/inline-image-in-mark.txt \
    > tests/corpus/sample-inline-marks.txt
tests/corpus/run.sh tests/corpus/sample-inline-marks.txt --core build/linux-core-release/bin/mfbe-core
```

The ids, from `specs/006-table-editing/contracts/document-model.md` (Tests to
write, the corpus gate), each listed once: style inside a link 584109, 585763,
444039, 497780, 412140; link inside a style 254742, 15506, 306806, 542288,
12218; nested styles 492007, 332731, 504320 (and 306806, 542288); a language on
formatting 423778; a name over part of a link 412140, 37354; the 30 valid files
that the 0.0.5 writer saves as invalid, 16659 to 608549 above and 12218, 15506,
254742, 306806. From `specs/006-table-editing/research.md` (R8.13): carriage
returns written as `&#13;` (FR-065), 22657 to 212492 above, the census's nine
table books whose `title-info` annotations release 0.0.5 changed on save and
which the table stratum, drawn in another order, does not hold.

## Guard G10: saves without a Description edit (feature 011)

`baselines/sample-1-50.sha256` holds the SHA-256 of every book of `sample-1-50.txt` saved without
any edit, recorded with the 0.0.8 writer (hashes only; the books stay local). A save fills in the
document details, so both runs use `roundtrip --fixed-details` (set by the two options below):

```bash
tests/corpus/run.sh tests/corpus/sample-1-50.txt --check-hashes tests/corpus/baselines/sample-1-50.sha256
```

The report's line "saves as recorded (G10)" must read all of them; any book saved differently fails
the run. `--save-hashes FILE` records such a file; a baseline is recorded again only when a feature
means to change how untouched books are written, never to make the check pass.

## The EPUB runs (feature 012, before every rc tag)

Both runs go through the editor itself, the journey `ui/tests/e2e/corpus-epub.spec.ts` against the real
core and the built interface, so build `ui/dist` first (`npm run build` in `ui/`). They use the release
core when it is built, else the debug one (`--core` chooses).

- `--epub-export` exports every FB2 book of the sample to EPUB and checks each file with EPUBCheck
  (`tools/ci/epubcheck.sh`, the pinned release; Java 11 or newer): any failed export and any fatal
  error, error or warning fails the run (SC-022).
- `--epub-import LIST` imports the EPUB books of LIST, each within a time limit, and validates each new
  book's bodies: a failed or hung import and any invalid body fail the run. A book the core refuses -
  DRM, or not a readable EPUB - is listed with its message and is no fault.

The EPUB sample comes from the library's EPUB books, drawn like the strata (`--ext epub`: ids up to
654000, a file's existence decides, its content is not read):

```bash
tests/corpus/sample.py --ext epub --count 100 --seed 1 --out tests/corpus/sample-epub-100.txt
tests/corpus/run.sh tests/corpus/sample-1-50.txt --epub-export --epub-import tests/corpus/sample-epub-100.txt
```

`epub-export.py` and `epub-import.py` also run on their own (`LIST [--out DIR] [--core PATH]`); each
writes `report.txt` and `report.json` in its folder, by default `tests/corpus/out/epub-export` and
`tests/corpus/out/epub-import`.

## The PDF run (feature 014, DP-16)

`--pdf-export` exports every FB2 book of the sample to PDF in A5 through the editor itself (the journey
`ui/tests/e2e/corpus-pdf.spec.ts`, printed through the journeys' print seam; build `ui/dist` first), then
checks each file twice:

- veraPDF against the PDF/A-2U profile (`tools/ci/verapdf.sh`, the pinned release; Java 11 or newer);
- pdf.js reads the text back against the book's own (`tests/pdf/text-compare.mjs`): every block, in
  order, each word whole.

A failed export, a book still running after five minutes (a hang), a file veraPDF fails or a text that
does not read back fails the run.

```bash
tests/corpus/run.sh tests/corpus/sample-1-50.txt --pdf-export
```

`pdf-export.py` also runs on its own (`LIST [--out DIR] [--core PATH]`), writing `report.txt` and
`report.json` in its folder, by default `tests/corpus/out/pdf-export`.

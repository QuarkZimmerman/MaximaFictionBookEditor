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
of feature 006 (FR-067 to FR-069), by id, plus five books with pictures in
links and five with pictures in formatting, drawn with seed 6:

```bash
python3 tests/corpus/sample.py --out /tmp/inline-ids.txt --ids \
    584109 585763 444039 497780 412140 \
    254742 15506 306806 542288 12218 \
    492007 332731 504320 \
    423778 \
    37354 \
    16659 26022 36254 42983 47019 61602 66863 230365 233217 239142 239423 259784 320758 \
    325075 364200 377000 378174 383978 437714 446498 457051 474228 478936 496284 571202 608549
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
254742, 306806.

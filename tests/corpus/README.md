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

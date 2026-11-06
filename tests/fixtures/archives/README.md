# ZIP archive fixtures (feature 009)

Small archives for the tests of books in ZIP archives (spec User Story 2, research DP-21),
written by `make-archive-fixtures.py` and committed. Regenerate them only when one must change:

```bash
python3 tests/fixtures/archives/make-archive-fixtures.py   # needs the zstd command
```

The output is the same byte for byte on every run. The big archives (the expanding bomb, the
70,000-entry ZIP64 archive, the 1,000-book archive) are built by the tests at run time.

| File | What it holds |
|------|---------------|
| `single.fb2.zip` | one book (`book.fb2`, from `books/modern-utf8.fb2`) |
| `many-200.zip` | 200 books in 10 folders, plus `cover.jpg` and `readme.txt` |
| `book-and-fbd.zip` | a book and a descriptor |
| `same-name-two-folders.zip` | `a/book.fb2` and `b/book.fb2` |
| `nested.zip` | `outer.fb2` and `inner.zip` (whose book is not listed) |
| `no-book.zip` | `readme.txt` only |
| `dotdot-names.zip`, `absolute-names.zip` | `../evil.fb2`, `/abs/evil.fb2` (shown, never used as paths) |
| `12345.zip` | `War and Peace.fb2`: the book's name differs from the archive's |
| `names-cp866.zip`, `names-cp1251.zip` | two Cyrillic names in those code pages, no UTF-8 flag |
| `names-cp862.zip`, `names-cp1255.zip` | two Hebrew names in those code pages, no UTF-8 flag |
| `names-cp437.zip` | two Western names in CP437, no UTF-8 flag |
| `names-utf8-flag.zip`, `names-utf8-noflag.zip` | the Cyrillic names in UTF-8, with and without the flag |
| `encrypted.zip` | an entry with the encryption flag (refused) |
| `method-unknown.zip` | an undefined compression method (refused) |
| `truncated.zip`, `crc-bad.zip` | damaged archives (refused) |
| `method-deflate64.zip`, `method-bzip2.zip`, `method-lzma.zip`, `method-xz.zip`, `method-zstd.zip` | one book in each of these methods |
| `sample.rar`, `sample.7z`, `sample.gz` | other archive kinds: "only ZIP archives are supported" |

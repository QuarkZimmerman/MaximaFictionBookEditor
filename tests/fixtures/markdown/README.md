# Markdown import fixtures (feature 010, US8)

Reference files for the Markdown import (`contracts/markdown-mapping.md` of the feature's
specification): each `.md` file shows rows of the mapping, and the unit tests of
`ui/tests/unit/features/markdown/` check what the converter makes of them.

| File | Shows |
|---|---|
| `structure.md` | front matter, the opening level-1 heading as the book title, text before the first section, heading ids, styles, links to headings, a footnote, lists, a task, a table |
| `special-chars.md` | the safe set kept; emoji (modifiers, flags, keycaps, joined), GitHub codes, symbols, mathematics as pictures; private use dropped |
| `pictures.md` (+ `pictures/`) | block and inline pictures, a `data:` picture, a web picture, a missing file, a file that is not a picture |
| `hostile.md` | script and style tags, a 60-deep quote, 30 list levels, a missing link target, a `javascript:` link, an iframe, 500 asterisks |
| `russian-*.md` | one Russian text in UTF-8, windows-1251, KOI8-R, CP866 and UTF-16 with a byte-order mark: the core's text judge (`tests/core/test_import_markdown.cpp`) |

Each `<name>.expected.txt` is the golden file of `ui/tests/unit/features/markdown/goldens.test.ts`:
the converted bodies, then the description, pictures, characters, summary and counts. After an
intended change, regenerate them with `npx vitest run tests/unit/features/markdown/goldens.test.ts -u`
in `ui/` and review the difference.


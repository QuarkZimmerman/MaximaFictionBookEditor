# Bundled resources

Data files installed next to the executables (`share/mfbe/resources`, see
`CMakeLists.txt`). Every file here is either a byte-exact copy of an upstream
file or generated from one by a script in `tools/`; nothing is hand-edited.
Text files are UTF-8 without BOM with LF line endings, except where a file is
deliberately kept byte-exact (noted below).

Upstream sources:

* **FBE** - the original FictionBook Editor 2.7 sources (local reference
  checkout: `/root/maxfbeditor/reference/fictionbookeditor/FBE`).
* **fb2** - the FictionBook 2.1 schema repository (BSD 2-clause; see
  `schema/SOURCE.txt`). Local reference checkout: `/root/maxfbeditor/reference/fb2`.
* **LibreOffice dictionaries** - <https://github.com/LibreOffice/dictionaries>,
  commit `67032ee957631908098a72edf48dc81cac27e369`.

| Path | Source | Licence | Regeneration |
|---|---|---|---|
| `schema/FictionBook.xsd`, `FictionBookGenres.xsd`, `FictionBookLang.xsd`, `FictionBookLinks.xsd`, `FictionNotes.xsd` | fb2 repository, byte-exact copies (FictionNotes.xsd keeps its upstream CRLF endings) | BSD 2-clause (`schema/LICENSE.md`, also embedded in FictionBook.xsd) | `cp` from the fb2 checkout, see `schema/SOURCE.txt` (commit + sha256 list) |
| `schema/LICENSE.md` | fb2 repository `LICENSE.md` | - | same |
| `schema/SOURCE.txt` | written for this project | - | update commit hash and checksums when the schema is refreshed |
| `genres/names.en.txt` | FBE `genres.txt` (English genre names, 16 categories, 140 lines, 127 distinct codes) | GPL-3.0-only (original editor) | `python3 tools/resources-import/import_genres.py` |
| `genres/names.ru.txt` | FBE `genres.rus.txt` (Russian names; structure and membership taken from `genres.txt`) | GPL-3.0-only (original editor) | same |
| `genres/categories.tsv` | derived from both genre lists: `key<TAB>title_en<TAB>title_ru` | GPL-3.0-only (original editor) | same |
| `genres/missing-names.txt` | codes of `schema/FictionBookGenres.xsd` (186) that neither FBE list names (65) | - | same |
| `symbols.ini` | FBE `symbols.ini` (windows-1251) converted to UTF-8, header added | GPL-3.0-only (original editor) | `python3 tools/resources-import/import_symbols.py` |
| `blank.fb2` | FBE `blank.fb2` (windows-1251) converted to UTF-8; only the XML declaration's encoding differs | GPL-3.0-only (original editor) | hand-maintained template; check with `python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse(sys.argv[1])" resources/blank.fb2` |
| `icons/` | FBE `res/*.bmp`, `res/*.ico` converted to PNG and split by the `TOOLBAR` button order of FBE `FBE.rc`; `.ico` originals copied | GPL-3.0-only (original editor) | `python3 tools/resources-import/import_icons.py` (ImageMagick 7); mapping in `icons/README.md` |
| `dictionaries/en_US.aff`, `en_US.dic`, `en_US.txt` | LibreOffice `en/en_US.aff`, `en/en_US.dic`, `en/README_en_US.txt`, byte-exact | SCOWL permissive licence + Ispell BSD / WordNet / public-domain parts, see `en_US.txt` | `curl` of the pinned raw URLs in `dictionaries/SOURCES.txt` |
| `dictionaries/ru_RU.aff`, `ru_RU.dic`, `ru_RU.txt` | LibreOffice `ru_RU/ru_RU.aff`, `ru_RU/ru_RU.dic`, `ru_RU/README_ru_RU.txt`, byte-exact | BSD-style, see `ru_RU.txt` | same |
| `dictionaries/SOURCES.txt` | written for this project | - | update SHA, sizes and checksums on refresh |
| `tools/import_genres.py`, `tools/import_symbols.py`, `tools/import_icons.py` | written for this project (Python 3, ImageMagick 7) | project licence | - |
| `CMakeLists.txt` | project | project licence | installs this directory (`README.md` and `CMakeLists.txt` excluded) |

## Formats

* `genres/names.*.txt`: `category<TAB>code<TAB>name`, `#` comments; category
  and genre order follow the original lists; a code may appear under several
  categories (cross-listing), possibly with a category-specific name.
* `genres/categories.tsv`: `key<TAB>title_en<TAB>title_ru` with a header row;
  keys are the code prefix of the category's first genre (`sf`, `det`, `prose`,
  `love`, `adv`, `child`, `poetry`, `antique`, `sci`, `comp`, `ref`, `nonf`,
  `religion`, `humor`, `home`) plus `economics` for "Economy, Business".
* `symbols.ini`: `[symbols]` section, `symN = <decimal code point>`,
  `symN_9 = <English label>`, `symN_25 = <Russian label>` (9/25 are the Windows
  LANG_ENGLISH / LANG_RUSSIAN ids of the original).
* `blank.fb2`: the template of new documents, the original's field for field
  (blank wherever the original is blank); the document id, version, program used
  and date are filled in by the core on every load. A user's `blank.fb2` in the
  Settings template folder, `<Data>` or the portable folder replaces it for new
  documents. The shell finds the resources folder by this file name.

## Known upstream discrepancies (kept or normalised by the scripts)

* `genres.txt`: `geo_guides,` has a stray comma (stripped); `accounting` is
  separated by a TAB instead of a space; "Misk" is normalised to "Misc" in
  seven names. Six named codes are not in the 2.1 schema: `adv_indian`,
  `det_maniac`, `economics_ref`, `prose_contemporary`, `sci_psychology`,
  `sf_epic` (kept in the name lists, they appear in real-world files).
* `genres.rus.txt`: `real_estate` / `paper_work` Russian names contained a
  leaked English word (corrected); genre order differs from `genres.txt` in
  "Prose" and "Poetry, Dramaturgy" (`genres.txt` order kept); every code of
  `genres.txt` has a Russian name (no English fallback was needed).
* `symbols.ini`: `sym2` (8226 = U+2022 BULLET) is labelled "Quotation mark",
  `sym1_9` misspells "acute" - kept verbatim.
* `Toolbar.bmp` has 33 cells but `IDR_MAINFRAME` defines 31 buttons; the two
  spare cells are kept as `icons/toolbar24/unused-cell-3[12].png`.
* FBE uses `FBE2.ico` as `IDR_MAINFRAME` (application icon) and `FBE.ico` as
  `IDI_OLDICON`; the `app/mfbe-*.png` set is rendered from `FBE.ico` as
  specified by the task, both `.ico` files are kept.

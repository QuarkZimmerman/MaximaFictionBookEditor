# Hunspell dictionary fixtures (feature 003, User Story 4)

Test dictionaries for "More spelling dictionaries from a folder" (spec 003, User Story 4,
FR-031 to FR-033). The Catch2 tests and the Playwright journeys copy the `.aff`/`.dic` files
of this folder into the editor's dictionaries folder (per-user, portable or chosen) and check
what the core accepts, rejects and ignores. Every tag is a language tag, so the registry can
match a book's language to it (exact tag first, then language: `de` and `de-AT` -> `de_DE`).
The word lists are tiny and hand-made (no third-party material, no licence notice needed).

| File | Purpose |
|------|---------|
| `de_DE.aff` + `de_DE.dic` | Usable German pair: `SET UTF-8`, a `TRY` line with umlauts and sharp s, no affix rules; five words (Haus, Straße, Bücher, schön, Mädchen). Must be listed with origin "user folder" and spell-check a German book: `Hauss` -> `Haus`, `Büchr` -> `Bücher`. |
| `cs_CZ.aff` | Broken pair: the `.aff` has no `cs_CZ.dic` partner. Must be reported as unusable (partner missing) and never listed as a dictionary. |
| `pl_PL.aff` + `pl_PL.dic` | Usable Polish pair in a legacy 8-bit encoding: `SET ISO8859-2`, both files are ISO-8859-2 bytes, not UTF-8; five words with Polish letters (książka, łódź, źdźbło, żółw, ćma). Proves that words are converted to and from the dictionary's encoding: all five accepted, `ksiażka` -> `książka`, `zółw` -> `żółw`. |
| `xx_XX.aff` + `xx_XX.dic` | Unsupported encoding: `SET X-UNKNOWN`, two ASCII words. Must be reported as unusable (unsupported encoding); before feature 003 the core loaded it with a UTF-8 fallback and the warning `spell.dictionaryEncoding`. |
| `ru_RU.aff` + `ru_RU.dic` | Shadowing pair with the tag of the bundled Russian dictionary: `SET UTF-8`, one word (`фикстура`) that the bundled dictionary does not know. Must be ignored and reported as shadowed: the bundled `ru_RU` stays in effect, so `книга` is accepted and `фикстура` stays flagged. |
| `gen-dictionaries.py` | Regenerates every file above byte-exactly (`python3 gen-dictionaries.py`). Edit the tables in the script, not the ISO-8859-2 files: a UTF-8 editor would silently re-encode them. |

## Encodings

| File | Bytes on disk | `SET` line |
|------|---------------|------------|
| `de_DE.aff`, `de_DE.dic` | UTF-8 (no BOM) | `SET UTF-8` |
| `cs_CZ.aff` | UTF-8 (no BOM) | `SET UTF-8` |
| `pl_PL.aff`, `pl_PL.dic` | ISO-8859-2 (Latin-2), one byte per letter: `ą` = B1, `ć` = E6, `ę` = EA, `ł` = B3, `ń` = F1, `ó` = F3, `ś` = B6, `ź` = BC, `ż` = BF | `SET ISO8859-2` (Hunspell's spelling; the core maps it to `iso-8859-2`) |
| `xx_XX.aff`, `xx_XX.dic` | ASCII | `SET X-UNKNOWN` (no converter in the core) |
| `ru_RU.aff`, `ru_RU.dic` | UTF-8 (no BOM) | `SET UTF-8` |

All files use LF line endings; the first line of each `.dic` is its exact word count. The
ISO-8859-2 pair deliberately breaks the repository's `charset = utf-8` editor setting. To
inspect it: `iconv -f ISO-8859-2 -t UTF-8 pl_PL.dic` (and `iconv -f UTF-8 -t UTF-8 pl_PL.dic`
fails, proving the bytes are not UTF-8).

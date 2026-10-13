# Script equivalence snapshots

Reference outputs of script runs, produced by `tests/scripts/run-script.mjs` and compared on
every run of the equivalence suite (`tests/scripts/run-all.mjs`, T108–T127). One file per
`<script> × <book> × <answers>`.

```text
snapshots/
├── suite.json                     the manifest: every snapshot with its package, book and
│                                  harness arguments (what run-all.mjs executes)
├── fixtures/                      the test packages of tests/scripts/fixtures (CI smoke)
│   └── append.modern-utf8.xml     04_Model/01_Append on tests/fixtures/books/modern-utf8.fb2
├── 01/                            group 01_Регистр (T108): <slug>[.<variant>].xml
├── 02/                            group 02_Добавление примечания (T109)
├── …                              (06–12 keep the book in the name: <slug>.conv-b-NN.xml)
├── 21/                            group 21_Поиск и замена (T124)
└── tree/                          tree commands (T126)
```

A snapshot `NN/<slug>[.<variant>].xml` belongs to the package whose manifest id is `NN/<slug>`
(`tree/<slug>` for tree commands); the variant names the answer / selection / book of the run
(`.no`, `.errors`, `.comments`, `.range` …). `docs/scripting/conversion-notes-{a,b,c}.md`
explain, per script, what each snapshot shows and why it differs from the original editor.

## Format

The stored text is the FB2 produced by `doc.toXml` after the run, normalised by
`normaliseXml()` in `run-script.mjs`: CRLF → LF, trailing whitespace removed, the volatile
`document-info` fields (`program-used`, `date`, `id`) and binary payloads replaced by `…`.
Everything else (element order, 1-tab indentation, inline markup) is exactly what the editor
would write, so a snapshot diff is a document diff.

## Running the suite

```bash
cd ui && npm run build && cd ..                   # the harness drives the built UI
tests/scripts/run-all.sh                          # all snapshots of suite.json, one Chromium at a time
tests/scripts/run-all.sh --group 17 --verbose     # one group, with the harness log of every run
MFBE_CORE_BIN=build/linux-core-release/bin/mfbe-core MFBE_UI_DIST=ui/dist tests/scripts/run-all.sh
```

`run-all.mjs` prints pass/fail per snapshot, a per-group table and the totals (converted
packages, snapshots, passed, failed, packages without a snapshot, dropped legacy scripts) and
exits 1 when a snapshot fails or a package of `scripts/` has no snapshot. CI runs it in the
Linux `e2e` job (`.github/workflows/ci.yml`).

## Creating and checking a snapshot

```bash
node tests/scripts/run-script.mjs scripts/01_case/01_Верхний\ регистр \
     tests/scripts/fixtures/books/conv-a-01.fb2 --select n10:20:60 \
     --snapshot tests/scripts/snapshots/01/upper-case.xml                   # creates it
node tests/scripts/run-script.mjs ... --snapshot <same file>                  # verifies (exit 1 on diff)
node tests/scripts/run-script.mjs ... --snapshot <same file> --update         # accepts a new result
```

Dialog answers are given in order with `--answer` (button id for message boxes, text for
prompts, a JSON object for forms, `cancel` to cancel; `wait`/`cancel` for the "still running"
prompt). The selection before the run is `--select <nodeId>[:from[:to]]` (one text block, a
caret with `from == to`) or `--select-range <fromNodeId>:<offset>-<toNodeId>:<offset>` for a
range spanning several blocks. Tree commands take `--tree-node <id>`. A failing script makes
the harness exit 1 with the text of the editor's error dialog; `--timeout <ms>` bounds a run.

Then add the run to `suite.json` (`{ "snapshot", "script", "book", "args" }`, paths relative to
the repository root). `tests/scripts/tools/extract-suite.mjs` generated the initial manifest
from the conversion notes and documents where every argument came from; after adding entries
by hand it is not needed again.

Re-record a snapshot (`--update`) only when the change is intended - a runtime fix or a
reviewed behaviour change of the script - and say so in the conversion notes. Re-recorded so
far: `17/notes-into-brackets*.xml` (three files) after `doc.removeNode` learned to remove
notes/comments bodies, which lets scripts 17/01 and 17/02 delete the bodies wholesale as the
originals did (the first recordings showed the one-section-at-a-time fallback).

## Reference outputs of the original editor

Where the requester captured the output of the original FictionBook Editor for a script, the
file is stored next to the converted snapshot as `<name>.fbe.xml` (normalised the same way)
and `docs/scripting/conversion-notes.md` documents every justified difference between
`<name>.fbe.xml` and `<name>.xml` (for example whitespace the IE engine normalised, or
features the new editor validates stricter). When no capture exists, the expected output is
reconstructed from the script's logic and reviewed in the conversion task.

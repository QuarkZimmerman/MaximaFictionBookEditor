# Maxima Fiction Book Editor — guidance for AI agents and contributors

Read first: `.specify/memory/constitution.md` (workspace `~/maxfbeditor`, version 3.1.1) — six
principles (specification first with the original as reference, headless testability, native
core behind a versioned contract, round-trip safety, fenced scripting, GPL-3.0 licensing /
fully offline with exactly two exceptions - the version check and the AI assistant the user
turns on, feature 005). The design artifacts live in `~/maxfbeditor/specs/<feature>/` (spec,
plan, research, data-model, `contracts/` = the JSON-RPC, document-model, script API, resource
formats and CLI contracts; feature 001 holds the base contracts, later features their additive
changes).
Original FictionBook Editor sources: `~/maxfbeditor/reference/` — a reference and source of
examples where a specification points to it or leaves a behaviour open; since 2026-10-17 the
editor no longer needs to match the original (requester decision, constitution 3.0.0).

## Layout

| Path | Owner | Notes |
|------|-------|-------|
| `core/` | C++20 library `mfbe_core` + `mfbe-core` executable | no UI, no CEF; talks JSON-RPC over loopback |
| `core/src/net/` | the AI assistant's outbound HTTP client (libcurl) | the core's only outbound path (feature 005); transport policy never relaxed (no redirects, verification on, TLS 1.2+, `http`/`https`, env proxies with loopback direct); a service failure is a result (`AiOutcome`), never an `RpcError` |
| `app/` | CEF shell `mfbe` | thin: window, dialogs, launch args |
| `ui/` | TypeScript/React/Vite | ProseMirror body editor, CodeMirror source view |
| `ui/src/ai/` | the AI assistant (feature 005) | chunk rule: `index.ts`, `address.ts`, `testHooks.ts`, `agreements.ts` are static (main bundle); **everything else** in the folder, plus the MCP SDK and zod, is the lazy `ai-assistant` chunk (`ui/vite.config.ts` folder rule, `tests/unit/ai/chunk.test.ts`) - never import a chunk module statically from outside the folder; the settings page `ui/src/dialogs/settings/AiPage.tsx` stays outside |
| `ui/src/editor/table/` | the table engine (feature 006) | the grid (`grid.ts`), the block of cells, the plans - pure functions of a table - and their commit (`commitTableEdit`: one transaction that replaces only the changed rows, one undo step); imports from `ui/src/model/` and `ui/src/editor/` only, so the Body view, the description fields, the paste router and the assistant share the plans; `testing/fuzz.ts` is reached by the test hooks through a dynamic import only - never import it statically |
| `ui/src/features/tables/` | the table commands (feature 006) | the command table, the edit target of the Body view and the description fields, the Table dialog, the context-menu section, the irregular-table marks and their popover, the link-target question, the Source view's *Add → Table*, the test hooks |
| `scripts/` | bundled user scripts | installed into the package — never put tooling here |
| `tools/` | developer tooling | never shipped |
| `resources/` | schema, genres, dictionaries, symbols, templates, messages, the AI service list `ai-services.json`, `certs/` (the Mozilla CA bundle + notice, Linux packages only) | installed |
| `tests/` | Catch2 tests, fixtures, corpus tooling, benchmarks | |
| `packaging/` | WiX / AppImage / deb-rpm / macOS | |

## Build and test (Linux host)

```bash
export VCPKG_ROOT=~/maxfbeditor/vcpkg
cmake --preset linux-core-debug && cmake --build --preset linux-core-debug   # core + tests, no CEF (the first configure also builds OpenSSL and curl, ~1 min)
ctest --preset linux-core-debug                                               # Catch2; the TLS case (test_tls_ca.cpp) needs OpenSSL - linked by tests/core/CMakeLists.txt on Linux/macOS, skipped on Windows (Schannel)
ctest --preset linux-core-debug -L corpus                                     # corpus round trip (slow)
python3 tests/corpus/sample.py --containing "<table" --count 300 --seed 6 --out tests/corpus/sample-tables-6-300.txt   # the table stratum (feature 006; about 8 minutes); the inline stratum's recipe in tests/corpus/README.md; both lists local and git-ignored
tests/corpus/run.sh <list> --core build/linux-core-release/bin/mfbe-core      # the corpus gate over one list (sample-1-50.txt, sample-tables-6-300.txt, sample-inline-marks.txt) - run before an rc tag
cmake --preset linux-app-debug && cmake --build --preset linux-app-debug     # + CEF shell (downloads CEF once)
tools/ci/shell-tests-xkb.sh ctest --preset linux-app-debug -L shell          # shell unit tests on an Xvfb with two XKB groups (keyboard layout)
python3 tests/fixtures/books/make-fixtures.py                                 # regenerates the committed book fixtures (only when one must change)
cd ui && npm ci && npm run typecheck && npm run lint && npm test && npm run build
cd ui && MFBE_FUZZ_SEED=<n> npx vitest run tests/unit/editor/table/fuzz.test.ts   # one seed of the table fuzz (SC-003) instead of the five seeds and the regression seeds
cd ui && npx playwright test --grep-invert @perf                              # e2e, headless, starts mfbe-core AND the AI stand-in (tests/e2e/fixtures/ai-standin.mjs) itself - no journey contacts a real service; the AI journeys need the real core (MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core), else they skip
cd ui && npx playwright test --grep @platform                                 # the journeys the Windows/macOS legs run too (feature 005: us1-ai-settings and us8-ai-own-key; feature 006: test 7 of us3-table-images-layout and the context-menu part of table-command-access - no locale-gen, LC_ALL, chmod or /tmp assumptions in them)
cd ui && MFBE_CORE_BIN=../build/linux-core-release/bin/mfbe-core npx playwright test --grep @perf --workers=1  # timed journeys on the Release core, perf-tables (the table commands, SC-005) among them
cd ui && MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core MFBE_E2E_TABLE_SHOTS=1 npx playwright test us3-table-images-layout  # pictures in table cells: test 7 attaches its contact sheets (evidence, never compared; CI's Linux leg sets the variable)
node ui/tests/e2e/fixtures/ai-standin.mjs --port 8787                         # the AI service stand-in by hand (loopback only; scenarios over POST /__standin/scenario, record under /__standin/requests)
tools/shell-smoke.sh                                                          # CEF shell under Xvfb + CDP (MFBE_SMOKE_CLOSE=1, MFBE_SMOKE_RESTART=1, MFBE_SMOKE_SAVE_AS=1 variants; MFBE_SMOKE_ABOUT=1 checks that About shows the version label and build id of `mfbe --version`; with MFBE_SMOKE_REAL_UI=1 and MFBE_SMOKE_OPEN_FILE the table-layout mode MFBE_SMOKE_TABLE_LAYOUT=1 on tests/fixtures/books/tables-images.fb2 and the table-marks mode MFBE_SMOKE_TABLE_MARKS=1 on tests/fixtures/books/tables.fb2)
tools/format.sh [--check]
python3 tools/path-conversion-check.py && python3 tools/path-portability-check.py  # explicit path/text conversions; file names that survive Windows/macOS checkouts
python3 tools/fb2-schema-elements.py --check                                  # Source-view completion table current with resources/schema
node tools/i18n-check.mjs --languages en,ru,uk --strict-identical --accelerators   # catalogue parity (CI runs it this strict)
node tools/i18n-literals.mjs                                                  # no user-visible literal outside the catalogues
python3 tools/licence-check.py --check                                        # THIRD-PARTY-NOTICES.md current; also rejects prose that pairs the X11-family three-letter licence name with "licence" (README, AGENTS, docs/**, packaging/**, i18n)
python3 tools/version-check.py --self-test && python3 tools/version-check.py --check   # the version files agree with the label of CMakeLists.txt (CI's lint job runs both); --tag <tag> prints a release tag's forms, --tag "" the untagged ones
python3 tools/resources-import/draw_table_icons.py --check                    # the 25 table icon pairs equal the drawing - by hand, CI does not run it
python3 tools/refresh-cacert.py                                               # CA bundle refresh: downloads cacert.pem + digest from curl.se, rewrites resources/certs/ (then licence-check); network - by hand only
node tools/ai-services-check.mjs                                              # RELEASE DAY ONLY: contacts the real bundled services (resources/ai-services.json) - never run by CI or a test; its table goes into docs/releases/<version>.md
```

Run the core headless for manual/MCP testing:
`build/linux-core-debug/bin/mfbe-core serve --test-hooks --data-dir /tmp/mfbe --ui ui/dist`
→ prints `{"port":…,"token":…}`; open `http://127.0.0.1:<port>/?token=<token>`.

## Conventions

- C++: C++20, `.clang-format` (4 spaces, 100 cols), headers in `core/include/mfbe/`, sources in
  `core/src/<area>/`; errors through `mfbe::log` (errors-only log, never book text).
- Paths and text: convert only with `platform::path_from_utf8` / `utf8_from_path` /
  `utf8_error_message` (`mfbe/utf8_paths.hpp`) - Windows converts implicit ones through the
  legacy code page; `tools/path-conversion-check.py` rejects them (`// path-text: <reason>`
  marks a deliberate one).
- Stored data: only in the folders of `platform::Dirs` (core) and `userDirs()` (shell) - the
  per-user folders for an installed copy, never its program folder; everything in the `user`
  folder of a portable copy, so the copy moves with its folder (constitution, data locations;
  resource-formats contract §1, §1a). The AI assistant stores exactly three things there and
  nothing else (resource-formats §F): the user's service list `<Data>/ai-services.json`, the
  `ai` settings keys in `settings.json` (the custom key included - masked on the page, never
  logged) and the scripts it writes under `<Data>/scripts/90_assistant/`; conversations are
  never written to disk.
- TS: strict, 2 spaces, Prettier; every interactive element has a stable `data-testid`;
  all user-visible strings go through i18n (`en.json`/`ru.json`/`uk.json` must stay in parity,
  and the feature catalogues `<feature>.<lang>.json`; `tools/i18n-check.mjs --languages`
  checks any set of languages, `en,ru,uk` by default).
- Network (constitution VI, 3.1.1): exactly two things use it - the version check (shell) and
  the AI assistant's requests, which the **core** sends through `net::HttpClient`
  (`core/src/net/`); the UI never contacts a service, nothing is sent at start-up or on the
  editor's initiative, a service failure is a result (`AiOutcome`), never an `RpcError`, and
  the log takes `ai.<kind>` with `{method, targetKind, host, status?}` only - never an
  instruction, a conversation, book text, a key or a service's words. No test or tool run by
  CI contacts a real service: journeys use the loopback stand-in
  `ui/tests/e2e/fixtures/ai-standin.mjs` (`test.setAiResolve` gives it a hosted name,
  `test.setAiTimeouts` the time-out case), Catch2 the in-process servers of `tests/core/`;
  `tools/ai-services-check.mjs` is the one exception, run by hand on the release day.
- Contract first: change `specs/.../contracts/*` before changing RPC handlers or the UI client
  (feature 005 adds `ai-catalogue.md` for the tools, resources and prompts of
  `ui/src/ai/catalogue.ts` and `ai-service-protocol.md` for the wire handling of
  `ui/src/ai/protocol.ts` and the core client). Feature 006's table grid
  (`specs/006-table-editing/contracts/document-model.md` §4) is normative for
  `ui/src/editor/table/grid.ts` and `core/src/model/table_grid.cpp`; a change to it and the
  matching change to `tests/fixtures/tables/grid-vectors.json`, which pins both, land in one
  commit.
- Tests first for each user story (Playwright journey + Catch2 where the core is involved).
- Commit messages: imperative, explain why; never commit secrets. Commit at natural
  checkpoints (a completed task or user story, a finished Spec Kit phase).
- Definition of done (requester, 2026-10-19, hard rule): nothing is done, finished or released
  while any test or any GitHub workflow run on the commit has failed or is still running -
  every workflow (CI, Release, Docs build replay), every operating system of its matrix; a
  failing test is fixed, never dismissed as "not a gate" or "flaky". Check all runs of the
  commit before reporting (`gh run list --commit <sha>` or the Actions API with `head_sha=`);
  tag a release only on a commit whose runs are all green and call it released only when the
  Release workflow and all other runs on the tagged commit have passed. The requester tests
  fixes from the CI run's `packages-*` artifacts (or a `-rc` pre-release tag) before the final
  tag - never from a release published for that purpose.
- No scope beyond the specifications without the requester's approval (a request in a feature
  description is that approval); the original editor is a reference, not a target to match.
- Licence: GPL-3.0-only (the original editor's); keep the original's notices
  (`CONTRIBUTORS.txt`, the scripts' author notices, checked by
  `tests/scripts/tools/check-notices.py`); a new dependency must pass `tools/licence-check.py`
  (then commit the regenerated `THIRD-PARTY-NOTICES.md`); run-time data the editor only reads
  (dictionaries, the CA bundle) is an aggregate with its notice next to the file and a
  `resources/README.md` row; in prose write "curl licence" and never put the X11-family
  three-letter licence name next to the word "licence" - the check fails CI on it.

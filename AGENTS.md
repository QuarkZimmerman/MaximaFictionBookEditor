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
| `app/` | CEF shell `mfbe` | thin: window, dialogs, launch args |
| `ui/` | TypeScript/React/Vite | ProseMirror body editor, CodeMirror source view |
| `scripts/` | bundled user scripts | installed into the package — never put tooling here |
| `tools/` | developer tooling | never shipped |
| `resources/` | schema, genres, dictionaries, symbols, templates, messages | installed |
| `tests/` | Catch2 tests, fixtures, corpus tooling, benchmarks | |
| `packaging/` | WiX / AppImage / deb-rpm / macOS | |

## Build and test (Linux host)

```bash
export VCPKG_ROOT=~/maxfbeditor/vcpkg
cmake --preset linux-core-debug && cmake --build --preset linux-core-debug   # core + tests, no CEF
ctest --preset linux-core-debug                                               # Catch2
ctest --preset linux-core-debug -L corpus                                     # corpus round trip (slow)
cmake --preset linux-app-debug && cmake --build --preset linux-app-debug     # + CEF shell (downloads CEF once)
tools/ci/shell-tests-xkb.sh ctest --preset linux-app-debug -L shell          # shell unit tests on an Xvfb with two XKB groups (keyboard layout)
python3 tests/fixtures/books/make-fixtures.py                                 # regenerates the committed book fixtures (only when one must change)
cd ui && npm ci && npm run typecheck && npm run lint && npm test && npm run build
cd ui && npx playwright test --grep-invert @perf                              # e2e, headless, starts mfbe-core itself
cd ui && MFBE_CORE_BIN=../build/linux-core-release/bin/mfbe-core npx playwright test --grep @perf --workers=1  # timed journeys on the Release core
tools/shell-smoke.sh                                                          # CEF shell under Xvfb + CDP (MFBE_SMOKE_CLOSE=1, MFBE_SMOKE_RESTART=1, MFBE_SMOKE_SAVE_AS=1 variants)
tools/format.sh [--check]
python3 tools/path-conversion-check.py && python3 tools/path-portability-check.py  # explicit path/text conversions; file names that survive Windows/macOS checkouts
python3 tools/fb2-schema-elements.py --check                                  # Source-view completion table current with resources/schema
node tools/i18n-check.mjs --languages en,ru,uk --strict-identical --accelerators   # catalogue parity (CI runs it this strict)
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
  resource-formats contract §1, §1a).
- TS: strict, 2 spaces, Prettier; every interactive element has a stable `data-testid`;
  all user-visible strings go through i18n (`en.json`/`ru.json`/`uk.json` must stay in parity,
  and the feature catalogues `<feature>.<lang>.json`; `tools/i18n-check.mjs --languages`
  checks any set of languages, `en,ru,uk` by default).
- Contract first: change `specs/.../contracts/*` before changing RPC handlers or the UI client.
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
  `tests/scripts/tools/check-notices.py`); a new dependency must pass `tools/licence-check.py`.

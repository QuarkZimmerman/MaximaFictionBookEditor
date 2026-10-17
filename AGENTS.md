# Maxima Fiction Book Editor — guidance for AI agents and contributors

Read first: `.specify/memory/constitution.md` (workspace `~/maxfbeditor`, version 3.0.0) — six
principles (specification first with the original as reference, headless testability, native
core behind a versioned contract, round-trip safety, fenced scripting, GPL-3.0 licensing /
offline). The design artifacts live in `~/maxfbeditor/specs/<feature>/` (spec, plan, research,
data-model, `contracts/` = the JSON-RPC, document-model, script API, resource formats and CLI
contracts; feature 001 holds the base contracts, later features their additive changes).
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
cd ui && npm ci && npm run typecheck && npm run lint && npm test && npm run build
cd ui && npx playwright test                                                  # e2e, headless, starts mfbe-core itself
tools/shell-smoke.sh                                                          # CEF shell under Xvfb + CDP
tools/format.sh [--check]
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
  all user-visible strings go through i18n (`en.json`/`ru.json` must stay in parity).
- Contract first: change `specs/.../contracts/*` before changing RPC handlers or the UI client.
- Tests first for each user story (Playwright journey + Catch2 where the core is involved).
- Commit messages: imperative, explain why; never commit secrets. Commit at natural
  checkpoints (a completed task or user story, a finished Spec Kit phase).
- No scope beyond the specifications without the requester's approval (a request in a feature
  description is that approval); the original editor is a reference, not a target to match.
- Licence: GPL-3.0-only (the original editor's); keep the original's notices
  (`CONTRIBUTORS.txt`, the scripts' author notices, checked by
  `tests/scripts/tools/check-notices.py`); a new dependency must pass `tools/licence-check.py`.

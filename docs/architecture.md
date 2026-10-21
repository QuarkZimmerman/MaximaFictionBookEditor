# Architecture

How Maxima Fiction Book Editor is put together: the three build units, the loopback link
between them, who owns which data, how a book flows through open / edit / save / validate,
how images and scripts are handled, where the contracts live, how the product is installed,
and the security review of the whole. The design decisions themselves (D1-D13) and their
rationale are recorded in `specs/001-maxima-fb2-editor/research.md` of the planning workspace;
this document describes what was built.

## 1. Overview

```
+------------------------------------------------------------------------------------+
|  mfbe (desktop shell, app/)                                                        |
|  Chromium Embedded Framework window, native file dialogs, clipboard image bridge, |
|  OS "open with" / single instance, Linux sandbox probe, navigation guard          |
|                                                                                    |
|   +------------------------------+   loopback only   +---------------------------+ |
|   |  mfbe-ui (ui/dist, in CEF)   | <===============> |  mfbe-core (core/, in     | |
|   |  React chrome, ProseMirror   |  HTTP + WebSocket |  process): files, XML,    | |
|   |  Body view, CodeMirror       |  JSON-RPC 2.0     |  validation, binaries,    | |
|   |  Source view, dialogs,       |  127.0.0.1:<port> |  spell, Words, settings,  | |
|   |  script sandbox (Worker)     |  token + Origin   |  resources, errors log    | |
|   +------------------------------+                   +---------------------------+ |
+------------------------------------------------------------------------------------+
```

Three parts, one product:

| Unit | Folder | Builds | Role |
|------|--------|--------|------|
| core | `core/` | static library `mfbe_core`, executable `mfbe-core` | Everything that touches files or needs native code: FB2 parsing and serialisation (libxml2), XSD validation, encodings, the binary (image) store and conversions, Hunspell spell checking, the Words engine, settings / recent files / exclusions / hotkeys, the layered resource lookup (genres, scripts, dictionaries), the errors-only log, and the loopback HTTP + WebSocket server exposing all of it as JSON-RPC. No UI, no Chromium. |
| ui | `ui/` | web bundle `ui/dist` (Vite) | The whole user interface: menus, toolbars, bars, status bar, Description form, Body editor (ProseMirror, section-windowed), Source editor (CodeMirror, with FB2 tag completion), Document Tree, every dialog, the Find/Replace/Spelling/Words tools, settings pages, i18n (EN/RU/UK), the user-script host and sandbox. It talks to the core only through the JSON-RPC contract and runs unchanged in the packaged shell, in a developer's browser and under Playwright. |
| app | `app/` | executable `mfbe` (+ CEF helper processes) | A thin desktop shell: starts the core in-process, opens one CEF window on the core's URL, provides native file dialogs, the clipboard image reader, "open folder" actions, OS file associations and the single-instance hand-over, and probes the Linux sandbox. It never interprets book data. |

The headless `mfbe-core serve` executable runs the same server without the shell; that is how
the Playwright journeys and the developer workflow drive the real core on a host without a
display (Constitution II).

## 2. Process model and the loopback link

* `mfbe` starts the core on a thread of its own process (`app/src/core_host.cpp`). The core
  binds `127.0.0.1` on an OS-assigned port, generates a 128-bit random session token and
  hands back `http://127.0.0.1:<port>/?token=<token>`; the shell loads that URL into the CEF
  browser. Chromium's renderer and GPU helpers are separate OS processes managed by CEF.
* The UI opens one WebSocket to `/rpc` for JSON-RPC 2.0 requests, responses and server
  notifications (`doc.changedOnDisk`, `job.progress`, `settings.changed`, `app.openPaths`,
  `resources.changed`, `app.closeRequested`). Long operations (open, save, validate, Words
  analysis of big books) return a `jobId` and report progress; the UI never blocks.
* HTTP serves the UI bundle (`GET /`, assets), binaries by id (`/binary/{docId}/{id}` and
  scaled `/preview`), raw uploads (`POST /binary/{docId}` for paste and drag-and-drop), script
  package files (`/scripts/{scriptId}/{file}`) and `/health`.
* Nothing else is network: no telemetry and no outbound connection of its own (FR-125,
  Constitution VI) - except the check for a new version (feature 002, decision D15): on Help >
  Check for new version, and at start-up when the schedule `other.versionCheck` is due
  (feature 003 US5: at every start, once a day / week / month - the default - or never; the UI
  decides from `session.lastVersionCheck`, the time of the last answered check, once the
  window is usable, `ui/src/features/help/schedule.ts`), the shell sends one
  `GET .../releases/latest` to GitHub with CEF's network stack (Accept and User-Agent headers
  only, no cookies or credentials, 15-second limit; `app/src/release_request.*`,
  `dialog_provider.cpp`) and the core relays the answer as `app.latestRelease`. The automatic
  check announces only a newer release, after any open dialog and never over a script run or a
  file dialog; "latest" and a failed request are silent, and a failure records nothing. The
  page and user scripts keep the engine-level network block; the release page and About links
  open in the system browser.

Files: `core/src/server/http_server.cpp` (auth, static files, CSP), `ws_rpc.cpp` (WebSocket
endpoint), `rpc_router.cpp` (dispatcher, jobs), `handlers/*.cpp` (one file per contract
section), `core_server.cpp` (wiring); `ui/src/rpc/client.ts` (typed client).

## 3. Who owns what

| Data | Owner | Notes |
|------|-------|-------|
| The live document while editing | UI | ProseMirror documents for the Body view and the rich Description fields, a form model for the rest of the Description, the Source text. Keystrokes never cross the link. The multi-view undo coordinator (`ui/src/model/undo.ts`) lives here too (FR-034). |
| Files on disk, encodings, the authoritative XML | core | `doc.open` parses FB2 into the JSON document model; `doc.save` serialises the UI's model to FB2 2.1, validates, converts images and writes atomically; `doc.toXml` / `doc.fromXml` move text between the Source view and the model. |
| Binary objects (images) | core | Decoded from base64 while parsing, kept in a per-document `BinaryStore`, never sent as base64 to the UI; the UI receives metadata (`BinaryMeta`) and fetches bytes or scaled previews over HTTP by id. |
| Validation | core | XSD validation against the bundled FB2 2.1 schema set plus consistency checks (dangling links, missing or unreferenced binaries, image formats, unknown genres) with line/column mapped back to node ids. |
| Spell checking, Words analysis | core | Hunspell with the bundled en_US / ru_RU / uk_UA dictionaries, the `.aff`/`.dic` pairs of the dictionary folders (`spell.dictionaryReport` tells which are in effect and which files were rejected and why) and the user's custom dictionary; word frequency and replacement engine. |
| Settings, recent files, remembered positions, hotkeys, exclusions | core | Per-user JSON files; the UI edits them through `settings.*` / `hotkeys.*` and receives `settings.changed`. The remembered positions of "Restore position" (`positions.json`, feature 004) are a record of their own, see *Restore position* below. |
| Genres, scripts, dictionaries | core | Layered lookup (settings folder -> per-user folder -> portable folder -> bundled), additive, no admin rights (FR-127). |
| Diagnostics | core | Errors-only rolling log (`logs/mfbe-errors.log`); the UI and the shell report their failures through `log.error`. |

## 4. Data flow

**Open.** `file.open` asks the shell for a path (`dialog.openFile`), then calls `doc.open`.
The core detects the encoding (BOM, declaration, decoded sample), parses with the hardened
libxml2 context, decodes `<binary>` payloads straight into the store from SAX chunks (so a
120 MB book costs about file size plus decoded images, not three times the base64), maps the
DOM to the JSON model (unknown elements and attributes become `raw-xml` nodes and are kept
verbatim), computes the schema hint and returns `{document, warnings}`. A not-well-formed file
yields `doc.parseError` with line and column; the UI then calls `doc.openSource` and opens
the Source view only (FR-021). The UI loads the model into its stores and starts the
external-change watcher (`doc.watch`).

**Edit.** All editing is local to the UI: ProseMirror transactions in the Body view, form
changes in the Description view, CodeMirror edits in the Source view. Switching views commits
an undo boundary; switching from Source parses the text with `doc.fromXml`, which re-issues
node ids and returns a remap table so carets and undo entries survive. The Document Tree,
Links bar, Table bar and status bar derive from the same live model.

**Position map (Body ↔ Source, feature 004).** The caret and the selection travel between the
two views through a map the core records while it serialises (`doc.toXml({positions: true})`)
or parses (`doc.fromXml({positions: true})`) the Source text: for every node with an id under
the bodies, the annotations and the history, the byte offsets of its start tag, its content
and its end plus the UTF-16 offset of the start tag (the conversion between the core's bytes
and the editors' UTF-16 units stays local to one element). The map lives in the document
session with the text it describes under a `serial`; `doc.mapPositions({serial, toSource,
toModel})` resolves model points (`{nodeId, offset}` as ProseMirror counts: UTF-16 units plus
one per inline atom, marks nothing) and source offsets both ways with one inline scanner that
mirrors the reader's content rules (an entity is its one character, a mark tag nothing, an
inline image one unit), and answers 1005 for any other serial. The UI never parses XML
(Constitution III): `sync.ts` records the Body selection on a direct switch, maps it once the
text is loaded, and on the way back commits pending edits with `positions: true` so the
offsets refer to the very text parsed; a point without a Body place (the prolog, the
description, a binary) goes to the document's start. `doc.toXml` also makes the received
document the session snapshot, so the remap of the next parse follows the model the text was
made from.

**Restore position (feature 004).** "Restore position" remembers the Body view's last caret
of a file by its place in document order, not by a session's node id: `doc.position({docId,
position})` carries `{path, offset}` - a structural path under one of the three roots the Body
view shows (`body[n]`, `title-info/annotation[1]`, `document-info/history[1]`) and a model
offset inside that text block - and the core keeps it in the document session and, when the
session has a file and `other.restorePosition` is on, in `positions.json` beside `recent.json`
(`core/src/settings/positions.cpp`): the 100 most recently remembered files, newest first,
written atomically on every change, paths compared as the platform compares file names
(`platform::same_file_path` - letter case ignored on Windows and macOS, exact on Linux), a
record of its own that the ten-entry Recent Files list and Clear Recent Files never touch. The
core gates every record and every answer on the setting, so the UI's start-up race with
`settings.get` can neither record nor restore when the option is off. The UI remembers on
every leaving route (`FileFeature.leaveDocument`: New, Open, Recent Files, a forwarded file,
the changed-on-disk reload, every save, Exit, the window's close request and the restart) the
Body controller's caret whatever the active view, unless the Body view was never shown for the
document; on every opening route it asks `doc.position`, resolves the path against the model it
shows (`ui/src/editor/structuralPath.ts`, `resolvePosition`: a paragraph that no longer exists
falls back to the one now at that place, clamped, silently) and places the caret without
switching the view - scrolled into view at once in the Body view, on mount when another view
is active. The changed-on-disk reload carries the in-session caret over directly. `doc.caret`
of release 0.0.3 stays as a deprecated alias (the 1.x caret shape converted through the
session snapshot) until the next major; `recent.json` no longer carries a caret, and a legacy
one is converted once when its file is next opened.

**Spelling scope (feature 004).** The editor's own checker - the core's Hunspell behind
`spell.*` - covers the Body view's one document and nothing else: the ProseMirror plugin
(`ui/src/editor/plugins/spellcheck.ts`) is installed in the Body editor alone, so the
annotation and history blocks at its top are checked like the book text, and the Spelling
dialog (`ui/src/features/spell/dialogController.ts`) walks the annotation, the history and the
bodies in that order, from whichever view it is started - the command and the highlighting
toggle keep their release 0.0.3 availability in every view. No field of the Description view
is ever checked (the source title info's annotation, edited there only, included), nor a
dialog, bar or the Source view. The browser engine's own checker - the one mechanism that
marked those fields, with whatever dictionaries the system has - is kept off on both sides:
the page sets `spellcheck="false"` on the app root (`ui/src/app/App.tsx`; the HTML state is
inherited by every descendant) and explicitly on the two ProseMirror roots (the Body editor,
the Description view's rich fields), and the shell sets the Chromium preference
`browser.enable_spellchecking = false` through the global request context's preference
manager when the browser context is initialised, before any window (`app/src/mfbe_app.cpp`;
CEF 150 has no command-line switch for it; the preference persists in the profile but is set
at every start). A refused preference is a warning in the errors-only log; test-hook builds
print `shelltest: spellcheck engine=off` (or `engine=error <text>`), which `tools/shell-smoke.sh`
asserts, and the `@platform` journey `us9-spelling-scope.spec.ts` reads the marks and the
attributes on every e2e leg.

**Keyboard layout on open (feature 004).** "Switch keyboard layout when a document is opened"
(Settings > Other, the Open File group; `other.switchKeyboardLayout`, `other.keyboardLayoutId`,
`other.keyboardLayoutName`) is the third shell-owned capability behind a core provider
interface, after the dialogs and the clipboard: the core declares
`mfbe::KeyboardLayoutProvider` (`core/include/mfbe/keyboard_layout_provider.hpp`, `list` /
`activate` with callbacks) and serves it as `system.keyboardLayouts` and
`system.activateKeyboardLayout` (`core/src/server/handlers/system_handlers.cpp`; results, never
errors - `noShell` / `unsupported` without a provider, `notInstalled` for an id the system no
longer lists, `refused` with the system's code written to the errors-only log as
`keyboard.switchRefused`). The shell's bridge (`app/src/keyboard_layout_bridge.cpp`) posts each
call to the CEF UI thread with the main window's native handle and answers from there; the
platform work is plain C++ in `mfbe_shell_logic` (`app/src/keyboard_layout*.cpp|.mm`) so
`tests/shell` runs it on each CI job: Windows lists `GetKeyboardLayoutList`, identifies a layout
by its KLID derived from the HKL without activating anything (special layouts through the
registry's `Layout Id`), names it by the language's localised display name plus the layout's own
name when it is not the plain one, and switches with `WM_INPUTLANGCHANGEREQUEST` to the
top-level window (`ActivateKeyboardLayout` as the fallback), verified with `GetKeyboardLayout` -
never `LoadKeyboardLayout`; macOS lists the enabled, select-capable keyboard input sources and
selects with `TISSelectInputSource` (best effort: `noErr` without a change is `activated: false`
without a reason); Linux reports a Wayland session (`XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, also
under XWayland) as `supported: false, reason: "wayland"` - the Settings page shows the option
disabled with the note, requester decision D2 - and under X11 lists the XKB groups of the core
keyboard on a `Display` of its own and locks the group by name with `XkbLockGroup` (the group
name, never the index, is the stored id). The UI makes exactly one request per document opened
(`FileFeature.documentOpened`, at the end of `loadDocument()` and of `openSourceOnly()`: the
start-up document, File > New, Open, Recent Files, a forwarded file, the restart's reopen, the
changed-on-disk reload, a malformed file in the Source view), fire-and-forget, never from the
Settings dialog; a start-up open that precedes the `settings.get` answer waits for the settings
to arrive. `--test-hooks` installs a recording stand-in (`test.setKeyboardLayouts`,
`test.keyboardLayoutRequests`) for the headless journey `us11-keyboard-layout.spec.ts`; the
platform switch itself is covered by `tests/shell/test_keyboard_layout.cpp` - on Linux under
Xvfb with two groups (`tools/ci/shell-tests-xkb.sh`).

**Save.** `doc.save` receives the current JSON model (binaries by reference), converts
non-JPEG/PNG images according to the paste-format setting, validates, and - unless the user
confirmed "save anyway" after validation errors - writes the FB2 2.1 text in the chosen
encoding through a temporary file that replaces the target only when fully written (FR-003).
The response carries the final path, encoding, the list of converted binaries and the
validation report.

**Validate.** `doc.validate` accepts either the model or Source text; the report lists
severity, line, column, element path and message per issue. The Validation panel jumps to
issues; `edit.gotoWrongTag` uses the same locations in the Source view.

**Images.** From a file: `binary.add({path})` (read, sniffed, id made unique). From the
clipboard or a drop: the UI posts the bytes to `POST /binary/{docId}` (never through
JSON-RPC, Constitution III); the shell's clipboard bridge serves `binary.addFromClipboard`
when the UI cannot read the image itself. The Body view shows `<img src="/binary/.../preview?w=">`
so huge pictures arrive scaled; "Save image as..." is `binary.export`. On save every binary
is JPEG or PNG (FR-110); undecodable binaries are preserved and reported (FR-111).

**Scripts.** `scripts.list` returns the catalogue of the layered script folders; the Scripts
menu and toolbar are built from it. Running a script: the host (`ui/src/scripting/host.ts`)
asks `scripts.source` for the entry URL, creates a dedicated Web Worker from an inline module,
hands it one end of a private `MessageChannel`, and the worker bootstrap scrubs the global
scope and defines the frozen `mfbe` object before `import()`-ing the entry module from
`/scripts/{id}/index.js`. Every `mfbe.*` call is a message to the host, validated against the
allow-list and applied to the run's working copy of the document (`ui/src/scripting/api-impl.ts`,
`workingCopy.ts`); the working copy is shown in the editor before the script's dialogs and
selection calls and replaces the document in one transaction at the end, as one undo entry.
During the run a banner above the document (`ui/src/scripting/ScriptRunBanner.tsx`, in every
view, independent of the status bar) shows the script's name, the elapsed time, the reported
progress, a busy sign and Cancel, the status bar keeps its run line, and the document is under
a quiet lock (feature 003 FR-011): the Body and Source editors are read-only and the
Description fields refuse input without being greyed, so the script's highlights stay visible,
and each command of the registry declares whether it is `blocked` (everything that changes the
document, switches the view, opens or saves a file, Settings, other scripts) or `allowed`
(Find, Copy, Help, About, Exit) while a script runs (`duringScriptRun` in
`ui/src/app/commands.ts`). The host records the run's duration; a run longer than 5 s ends with
a short notice in the work area (`ui/src/app/TransientNotice.tsx`) that hides by itself and
never takes the focus. Cancel terminates the worker and restores the document, and uncaught
errors become "Script error: <message> at line L, column C" with the document left as it was.

**Restart.** "Restart now?" after a language change (feature 003 US3) really restarts the
editor. The UI runs the usual save prompt and calls `app.restart({reopen: path})` (no `reopen`
for a never-saved document); the core relays it to the shell (`CoreServerOptions::on_restart`,
`app/src/shell_runner.cpp`), which starts the same program again - `$APPIMAGE` when the
AppImage runtime set it, else its own executable - with its own start-up options except FILE,
`--new` and `--lang` (the one-run override; the new language setting is the reason for the
restart), plus `--wait-for-exit <own pid>`, `--window-geometry <x,y,w,h[,max]>` of the main
window and the document as FILE (`app/src/relaunch.cpp`: `posix_spawn` in a session of its
own with every inherited file closed, `CreateProcessW` on Windows), records the window
placement and then quits as after `app.quit`. The new instance waits up to 30 s for the old
process to end *before* `CefInitialize`, so Chromium's single-instance lock is free and nothing
is relayed to the dying instance, and opens its window at the placement it was given. The
placement - the normal bounds plus the maximised state, as the original editor's saved
`WINDOWPLACEMENT` - is the shell's (`app/src/window_placement.cpp`, `window.cpp`): it is
tracked from the window's bounds changes, written to `settings.session.windowGeometry` at
quit and before a restart through the core's in-process accessors `CoreServer::set_setting`
/ `setting` (not JSON-RPC), applied at window creation (`--window-geometry` wins, then the
setting, then centred 1200x800) and always clamped to the work area of its display. Without
a shell (browser/dev mode) `app.restart` answers 1070 `app.restartUnavailable` and the page
reloads itself with `?open=<path>` added to its query; a spawn failure answers 1071
`app.restartFailed {reason}` and the editor stays open. `tools/shell-smoke.sh` with
`MFBE_SMOKE_RESTART=1` exercises the real restart under Xvfb (normal and maximised window,
the Body caret back in its paragraph in the new instance - feature 004 US8 - and, with a
test-hook shell, the failure path with `MFBE_SMOKE_RESTART_FAIL=1`); the CI `app` job runs it
on the release shell, which prints no argument lists, so the restart is judged by what the new
instance shows.

**Closing the window.** The window never closes behind the UI's back (feature 003 FR-017).
A close request the user can still cancel - the title-bar button, Alt+F4, a system shutdown,
Cmd+Q - reaches the shell in `MainWindowDelegate::CanClose` (`app/src/window.cpp`; CEF's Chrome
style never calls `CefLifeSpanHandler::DoClose`, and `CefBrowserHost::IsReadyToBeClosed()` tells
such a request from a close already under way) and is deferred by `MfbeClient::OfferCloseToUi`,
driven by the state machine `app/src/close_handshake.cpp`: it asks the core to emit the
notification `app.closeRequested`, and the UI runs exactly the Exit flow
(`FileFeature.handleCloseRequested`) - "Cancel the running script?" while a script runs (Yes
cancels the run and restores the document), then "Save changes to X?" whose Cancel keeps the
editor open with nothing lost - and ends it with `app.quit({force: true})`, on which the shell
closes for real. A further close request asks again at once (the UI ignores it while its prompt
is up; after a Cancel it is the next prompt); a request that arrives while a prompt of New/Open,
Settings or a native file dialog is open is ignored, as a native window refuses to close behind
its modal dialog, until the user has finished that dialog and closes again. The shell closes on
its own only when no page is connected to answer: the notification could not be delivered, or no
client is connected when the 10 s timeout (`CloseHandshake::kAnswerTimeout`) passes - a
connected UI keeps the window however long the user takes over the prompt, so a window whose
interface is gone can be closed but a prompt can never be skipped. `test.requestClose` emits the
same notification headless so the journeys cover the UI's part; `tools/shell-smoke.sh` with
`MFBE_SMOKE_CLOSE=1` sends the window manager's close request to the real shell under Xvfb
(openbox, xdotool) and reads the Body caret it remembered from `positions.json` afterwards
(feature 004 US8), and `tools/ci/windows-russian-journey.ps1` posts WM_CLOSE to the Windows
window - the title-bar button's path end to end; `tests/shell/test_close_handshake.cpp` drives
the state machine.

## 5. Contracts

The core/UI boundary is a documented, versioned contract (Constitution III); the source of
truth is `specs/001-maxima-fb2-editor/contracts/` in the planning workspace, with the
additive changes of later features in `specs/<feature>/contracts/` (feature 003: `app.restart`,
`app.closeRequested`, `doc.formatDate`, `spell.dictionaryReport`, the new settings keys and
test hooks - API minor 2 - and the installer's public property; feature 004 - API minor 3 -
among others `doc.position`, with `doc.caret` and `RecentFile.caret` deprecated for the next
major):

| Contract | Mirrors in this repository |
|----------|----------------------------|
| `rpc-api.md` (methods, notifications, HTTP endpoints, errors; version 1, minor 3) | `ui/src/rpc/types.ts` (`RPC_API_VERSION`), `core/src/server/handlers/*.cpp`, `core/include/mfbe/version.hpp.in` (`kApiVersion`) |
| `document-model.d.ts` (JSON document model) | `ui/src/model/document.ts` (verbatim copy with a header), `core/include/mfbe/document.hpp` + `json_codec.hpp` |
| `script-api.d.ts` (the complete `mfbe` allow-list) | `docs/scripting/mfbe.d.ts` (copy shipped with the editor), `ui/src/scripting/types.ts` (`API_METHODS`), `ui/src/scripting/sandbox.ts` |
| `script-manifest.md` (package layout, `script.json`, sandbox rules) | `core/src/resources/scripts.cpp`, `ui/src/scripting/sandbox*.ts` |
| `resource-formats.md` (per-user folders, layered lookup, file formats) | `core/src/resources/`, `core/src/settings/`, `core/src/platform/` |
| `cli.md` (`mfbe` and `mfbe-core` command lines) | `app/src/command_line.cpp`, `core/main.cpp` |

Rule: change the contract first, then both sides in the same change. Additive changes bump
the minor version; breaking changes bump the major and the UI checks `app.info().apiVersion`
when it connects.

## 6. Build units and install layout

CMake presets (`CMakePresets.json`) build the core with its tests (`*-core-*`) or the whole
application including the CEF download (`*-app-*`); vcpkg supplies every native dependency
from the pinned baseline in `vcpkg.json`; the UI is built by npm (standalone or from CMake with
`MFBE_BUILD_UI=ON`). `cmake/InstallLayout.cmake` defines one install tree for all platforms:

| Linux (FHS) | Windows (flat) | macOS (bundle) | Content |
|---|---|---|---|
| `bin/mfbe-core`, `bin/mfbe` -> `lib/mfbe/mfbe` | `bin\mfbe.exe`, `bin\mfbe-core.exe` | `mfbe.app/Contents/MacOS/mfbe`, `bin/mfbe-core` | executables |
| `lib/mfbe/` (libcef, `*.pak`, `icudtl.dat`, `locales/`, `chrome-sandbox`) | `bin\` (libcef.dll, resources, locales) | `Contents/Frameworks/` (CEF framework, helper apps) | Chromium Embedded Framework |
| `share/mfbe/ui/` | `share\mfbe\ui\` | `Contents/Resources/ui/` | UI bundle |
| `share/mfbe/resources/` | `share\mfbe\resources\` | `Contents/Resources/resources/` | schema, genres, dictionaries (with their licence texts), symbols, blank template, messages, icons |
| `share/mfbe/scripts/` | `share\mfbe\scripts\` | `Contents/Resources/scripts/` | bundled user scripts (read-only layer) |
| `share/doc/mfbe/` | `share\doc\mfbe\` | `Contents/Resources/` | `LICENSE` (GNU GPL version 3) with the original's `gpl-3.0.ru.txt` and `gpl-3.0.ua.txt`, the original's `CONTRIBUTORS.txt`, `THIRD-PARTY-NOTICES.md`, `licenses/` (third-party licence texts) |
| `share/applications`, `share/mime/packages`, `share/icons` | MSI ProgIds `.fb2` / `.fbd` | `Info.plist` document types | file associations |

Per-user data (settings, recent files, custom dictionary, exclusions, hotkeys, user genres,
user scripts, user dictionaries, the errors-only log, the CEF profile) lives in the platform's
user folders, or all of it in the `user` folder of a portable copy (`mfbe/portable.hpp`), see
`docs/installing.md`. Packages: AppImage (static runtime), `.deb`, `.rpm`, WiX MSI, portable
ZIP, `.dmg` (`packaging/`), all produced by `.github/workflows/release.yml`.

Third-party components and their licences are inventoried by `tools/licence-check.py`
(`THIRD-PARTY-NOTICES.md`); run-time data files the editor only reads and never combines into
the program, such as spelling dictionaries, are aggregates (GPLv3 section 5) listed in their own
section of the notices and ship with their own notice next to the file - the Ukrainian
dictionary of dict_uk under the MPL 1.1 (`resources/dictionaries/uk_UA.txt`, decision D16); the
parity of menus, toolbars and dialogs with the original editor is tracked in
`docs/parity-matrix.md` (`tools/parity-check.mjs`). Fast mode (`View > Fast
Mode`, F5, FR-025 "MAY") is kept, as in the original: a reduced-fidelity rendering of the Body
view (`ui/src/editor/fastMode.ts`, CSS only - frames, colours, image previews and
non-breaking-space markers are dropped while the document and every command behave as in
normal mode), persisted in `settings.view.fastMode`.

## 7. Security review

### 7.1 Threat model

Assets: the user's manuscripts (confidentiality and integrity of every book the editor
touches), the rest of the user's files, and the user's machine.

| Threat | Who / what | Entry point |
|--------|------------|-------------|
| Malicious FB2 file | a book downloaded from anywhere; crafted XML (external entities, DTDs, entity bombs, absurd nesting or sizes), crafted images, hostile link targets | `doc.open`, `doc.fromXml`, `doc.validate`, `binary.add`, the Body view rendering the content |
| Malicious user script | a script package copied into the user's scripts folder; it runs JavaScript inside the editor | the Scripts menu / toolbar / hotkey, `GET /scripts/...` |
| Other local processes | software running under the same user that finds the loopback port; a web page in another browser trying to reach `127.0.0.1` (CSRF, DNS rebinding) | the HTTP endpoints and the WebSocket upgrade |
| The editor itself | leaking book text or personal data through diagnostics, phoning home | the errors-only log, outbound network |

Out of scope: an attacker who already runs code as the same user (they can read the files
directly), physical access, and vulnerabilities inside Chromium itself beyond keeping to the
LTC channel and its security updates (`cmake/CefVersion.cmake`).

### 7.2 Controls in place

Loopback server (`core/src/server/http_server.cpp`, `ws_rpc.cpp`, `core_server.cpp`):

* Binds `127.0.0.1` only, OS-assigned port (`LoopbackServer::listen`); never a public
  interface.
* Per-launch 128-bit random token (`random_token_hex`, `std::random_device`). Every HTTP
  request and the WebSocket handshake must present it (`?token=`, `X-MFBE-Token` header or the
  `mfbe_token` cookie that the HTML response sets with `Path=/; SameSite=Strict; HttpOnly`);
  comparison is constant-time; missing or wrong -> `401`
  (`LoopbackServer::authorize`, `check_auth`). The shell passes the token to the page URL only;
  `Referrer-Policy: no-referrer` keeps it out of any referrer.
* `Origin` check before the token: a present `Origin` that is not
  `http://127.0.0.1:<port>` or `http://localhost:<port>` -> `403`, including `null`, other
  ports, other schemes. This blocks browser-based cross-site requests and WebSocket hijacking
  even if a token leaked into another browser profile.
* Content-Security-Policy of the UI page (`csp_header`):
  `default-src 'self'; connect-src 'self' ws://127.0.0.1:<port> http://127.0.0.1:<port>;
  img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:;
  script-src 'self'` - no remote scripts, no `eval`, no connections anywhere but the core.
  `X-Content-Type-Options: nosniff` on every response, `Cache-Control: no-store` on the page.
* Static files: only `GET`/`HEAD`; the path is URL-decoded once, rejected when it contains
  `..` segments, backslashes or NUL, canonicalised and required to stay inside the UI
  bundle directory (symlinks pointing outside resolve outside and are refused)
  (`resolve_static`). Script files: the same rules relative to the script's own package folder
  (`scripts::resolve_package_file`, `is_safe_relative_file`: no absolute paths, drive letters,
  `.`/`..`/empty segments).
* Uploads: `POST /binary/{docId}` requires a known document and stops reading at 256 MB with
  `413 Payload Too Large` (`kMaxUploadBytes`); `binary.add` and the clipboard path apply the
  same cap. WebSocket frames are capped at 512 MB (`kMaxPayloadBytes`, big Document JSONs) and
  binary frames are ignored - binary payloads never travel inside JSON-RPC.
* No batch requests, strict JSON-RPC parsing (`-32700` / `-32600` answers), unknown methods
  `-32601`; test-only methods (`test.*`) exist only in builds with `MFBE_TEST_HOOKS` and only
  when `--test-hooks` is given.

XML hardening (`core/src/xml/xml_security.cpp`, used by the reader and the validator):

* `XML_PARSE_NO_XXE | XML_PARSE_NONET | XML_PARSE_NO_SYS_CATALOG`, no `DTDLOAD`/`DTDVALID`,
  plus a resource loader that refuses every external resource: external entities, external
  DTD subsets and network DTD locations are never fetched; an external entity reference is
  dropped from the text (verified: a `file://` or `http://` reference yields an empty string,
  never the target's content).
* `XML_PARSE_NOENT` off and `xmlCtxtSetMaxAmplification(5)`: internal entities expand, entity
  bombs stop with "Maximum entity amplification factor exceeded" as an ordinary parse error.
* `XML_PARSE_HUGE` off: libxml2's limits apply - 10 MB per text node, 256 nesting levels,
  50 KB names - and are reported as parse errors instead of exhausting memory or the stack;
  `<binary>` payloads bypass the text limit because they are decoded from SAX chunks.
  Inputs above 512 MB are refused before parsing (`kMaxDocumentBytes`); error messages are
  collected as structured records (at most 200) and never printed.
* The FB2 writer escapes text and attribute values (`escape_text`, `escape_attribute`), so
  content entered in the UI cannot break the XML structure.
* Images are decoded with the bundled libjpeg-turbo / libpng / libwebp / libtiff / giflib /
  stb only after a content sniff; undecodable data stays an opaque binary. Links with `href`
  outside the document are reported by validation (`image.externalHref`) and never fetched by
  the core; the Body view renders only `/binary/...` previews of the document's own images.

Script sandbox (`ui/src/scripting/sandbox.worker.ts`, `sandbox.ts`, `host.ts`, `api-impl.ts`;
contract `script-manifest.md` §3):

* One dedicated Web Worker per run, created from an inline (blob) module so it inherits the
  page CSP: `script-src 'self'` lets it `import()` only same-origin modules (the core's
  `/scripts/...` files), `connect-src` keeps the network away, `data:`/`blob:` imports are
  blocked.
* Before the entry module is imported the bootstrap deletes `fetch`, `XMLHttpRequest`,
  `WebSocket`, `EventSource`, `importScripts`, `Worker`, `SharedWorker`, `indexedDB`,
  `caches`, `navigator`, `BroadcastChannel`, `MessageChannel`, `MessagePort`,
  `OffscreenCanvas`, `WebTransport`, `RTCPeerConnection`, `Notification`,
  `performance.memory` and the worker's own `postMessage` / `onmessage` / `onmessageerror` /
  `close` from the global object and its prototype chain, then pins them as non-writable `undefined`
  (`scrubGlobals`, `BLOCKED_GLOBALS`). `setTimeout`, `clearTimeout`, `queueMicrotask`,
  `console` (routed to the host) and the JavaScript built-ins remain.
* The only link to the editor is one end of a `MessageChannel` held in a closure; the
  frozen `mfbe` object turns every member into a message. The host answers exactly the
  `API_METHODS` allow-list (`ui/tests/unit/security/sandbox-surface.test.ts` compares it with
  the contract declaration file member by member) and rejects anything else with "unknown API
  method". Scripts never see the editor's DOM, the RPC client, the token or file paths.
* One undo entry per run (the document before and after it); cancellation terminates the
  worker and restores the document; after 30 s without activity the run bar says so; document
  snapshots over 64 MB are refused.

Desktop shell (`app/src/`):

* Navigation guard (`MfbeClient::OnBeforeBrowse`, `OnOpenURLFromTab`, `OnBeforePopup`):
  only `about:`, `data:`, devtools and the core's own origin may load in the window; every
  other URL (links in books, `window.open`, `target=_blank`) is cancelled and handed to the
  OS browser through `openExternalUrl`, which accepts `http://`, `https://` and `mailto:`
  only (no `file://`, no custom schemes). Blocked navigations are logged.
* Chromium command-line arguments are not taken from the process command line
  (`command_line_args_disabled`); the shell owns `argv` (`contracts/cli.md`). Remote
  debugging and DevTools exist only when `--remote-debugging-port` is given (or in debug
  builds).
* Linux sandbox probe (`sandbox_check.cpp`): the Chromium sandbox stays on when unprivileged
  user namespaces work or the root-owned 4755 `chrome-sandbox` helper is present (the
  `.deb`/`.rpm` install it); only otherwise (typically the AppImage on Ubuntu 24.04+) the shell
  falls back to `--no-sandbox` and writes a warning to the errors-only log
  (`shell.sandboxDisabled`) and to stderr. The content rendered without the sandbox is the
  local UI only; no remote pages are ever loaded.
* The CEF profile is the per-user data folder, a portable copy's `user` folder, or a temporary
  folder in `--url` developer mode; nothing is shared with other browsers.
* Permission requests: the editor's own page may use the clipboard (Edit > Paste and the
  right-click menus read it); every other request is refused without a browser prompt
  (`app/src/permission_policy.cpp`).

Diagnostics and privacy (`core/src/log/error_log.cpp`, FR-131):

* Only `error` and `warning` entries reach `logs/mfbe-errors.log` (5 x 1 MB rolling);
  entries carry message, code, source, version, platform, stack and a small context (document
  id, node id, paths, reasons) - never book text, never the session token; callers must not
  pass content (header comment of `mfbe/log.hpp`; pinned by `tests/core/test_security.cpp`).
* Nothing is transmitted anywhere; "Open log folder" in About shows the user the file.

### 7.3 Tests that pin the controls

* `tests/core/test_security.cpp` (Catch2, `[security]`): external entities / parameter
  entities / external and network DTDs are never loaded; entity amplification, 300 nesting
  levels and 11 MB text nodes are refused as parse errors while an 11 MB binary payload is
  accepted; every HTTP entry point and the WebSocket handshake answer `401` without the token
  and `403` for foreign origins (`null`, other ports, other schemes), accept the token from
  query, header and cookie; the CSP, cookie flags and `nosniff` headers; plain, URL-encoded,
  backslash and symlink traversal against the UI bundle and script packages (`404`, no secret
  bytes); a 256 MB + 1 upload gets `413` and the server keeps working; the errors-only log
  never receives book text or the token.
* `tests/core/test_rpc_server.cpp`, `test_scripts.cpp`, `test_fb2_reader.cpp`: the same
  controls from the feature side (static bundle, `/scripts` endpoint, hostile entity document).
* `ui/tests/unit/security/sandbox-surface.test.ts`: the `mfbe` surface, the host's method
  table and the globals exposed by the bootstrap equal the contract declaration file
  (`docs/scripting/mfbe.d.ts`, parsed with the TypeScript compiler API); the scrub list covers
  script-manifest.md §3; `scrubGlobals` removes and pins every blocked name on a realistic
  worker scope.
* `ui/tests/unit/scripting/*.test.ts`, `ui/tests/e2e/us12-scripts.spec.ts` ("the sandbox hides
  every host capability except mfbe", Cancel restores the document).

### 7.4 Residual risks and known limitations

* The token is the only barrier for a same-user process that discovers the port. A
  process running as the user can already read the user's files, so this is accepted (same
  model as other local-server desktop applications).
* The `Host` header is not checked. DNS-rebinding pages still fail the `Origin` check and
  have no token; a check of `Host` against `127.0.0.1:<port>` would be a cheap additional
  layer (see the checklist).
* Everyone holding the token can call every RPC method, including `doc.open`, `doc.save`,
  `binary.add` and `binary.export` with arbitrary paths - the UI is trusted exactly like the
  user. Scripts never hold the token; the host mediates every call.
* A script can `import()` modules of another script package or of the UI bundle (same
  origin); this grants no capability beyond the `mfbe` allow-list and no network, but it is
  wider than the wording "only files inside the script's own folder" of script-manifest.md §1.
  Per-run restriction would need a per-run path token in the loader.
* A hostile file's unresolvable external entity references are dropped from the text, so
  such a file does not round-trip byte-for-byte (it is not a valid book either).
* Without the Chromium sandbox (AppImage on systems that restrict user namespaces) a
  renderer compromise would run as the user; the renderer only ever shows the editor's own
  UI. Installing the `.deb`/`.rpm` restores the SUID helper.
* `style-src 'unsafe-inline'` is required by the editors' inline styles; scripts cannot
  inject styles into the page (no DOM access), so this does not widen the sandbox.
* The errors-only log contains file paths, which may include the user's name in a home
  directory path; the log stays on the machine.

### 7.5 Checklist for future changes

* New HTTP endpoint or RPC method: goes through `check_auth` (token + Origin); never returns
  file contents outside the UI bundle, the script package or the document's binary store;
  caps request sizes; adds a case to `tests/core/test_security.cpp`.
* New file-path parameter: only from the UI (never from scripts); document it in
  `rpc-api.md`.
* Any libxml2 option change in `xml_security.cpp`: keep `NO_XXE`, `NONET`, no `DTDLOAD`,
  `HUGE` off, the refusing resource loader and the amplification limit; re-run `[security]`.
* Widening the script API: contract change (`script-api.d.ts` -> `docs/scripting/mfbe.d.ts`
  -> `types.ts` -> `api-impl.ts`) with a version bump and the requester's approval
  (Constitution V); `sandbox-surface.test.ts` fails until all four agree.
* New worker global or Web API in Chromium that reaches the network or storage: add it to
  `BLOCKED_GLOBALS` and to script-manifest.md §3.
* New shell navigation or URL handling: route through `IsAllowedUrl` / `openExternalUrl`;
  never add `file://` or custom schemes to the allowed external set.
* Logging: `log::error` / `log::warning` take codes, paths and reasons - never a text
  fragment of the book or a user's word list.
* Dependencies: run `python3 tools/licence-check.py` and commit the regenerated notices;
  licences that may not be part of a GPL-3.0 work (the editor is GPL-3.0-only) and unknown
  licences fail CI; a multi-licensed component is recorded under a compatible option.

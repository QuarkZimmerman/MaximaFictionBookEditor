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
| ui | `ui/` | web bundle `ui/dist` (Vite) | The whole user interface: menus, toolbars, bars, status bar, Description form, Body editor (ProseMirror, section-windowed), Source editor (CodeMirror), Document Tree, every dialog, the Find/Replace/Spelling/Words tools, settings pages, i18n (EN/RU), the user-script host and sandbox. It talks to the core only through the JSON-RPC contract and runs unchanged in the packaged shell, in a developer's browser and under Playwright. |
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
  `resources.changed`). Long operations (open, save, validate, Words analysis of big books)
  return a `jobId` and report progress; the UI never blocks.
* HTTP serves the UI bundle (`GET /`, assets), binaries by id (`/binary/{docId}/{id}` and
  scaled `/preview`), raw uploads (`POST /binary/{docId}` for paste and drag-and-drop), script
  package files (`/scripts/{scriptId}/{file}`) and `/health`.
* Nothing else is network: the editor has no outbound connections, no telemetry, no update
  checks (FR-125, Constitution VI).

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
| Spell checking, Words analysis | core | Hunspell with the bundled en_US / ru_RU dictionaries and the user's custom dictionary; word frequency and replacement engine. |
| Settings, recent files, hotkeys, exclusions | core | Per-user JSON files; the UI edits them through `settings.*` / `hotkeys.*` and receives `settings.changed`. |
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
During the run the document is locked and the status bar shows the progress and Cancel;
Cancel terminates the worker and restores the document, and uncaught errors become "Script
error: <message> at line L, column C" with the document left as it was.

## 5. Contracts

The core/UI boundary is a documented, versioned contract (Constitution III); the source of
truth is `specs/001-maxima-fb2-editor/contracts/` in the planning workspace:

| Contract | Mirrors in this repository |
|----------|----------------------------|
| `rpc-api.md` (methods, notifications, HTTP endpoints, errors; version 1) | `ui/src/rpc/types.ts` (`RPC_API_VERSION`), `core/src/server/handlers/*.cpp`, `core/include/mfbe/version.hpp.in` (`kApiVersion`) |
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
user scripts, the errors-only log, the CEF profile) lives in the platform's user folders, see
`docs/installing.md`. Packages: AppImage (static runtime), `.deb`, `.rpm`, WiX MSI, `.dmg`
(`packaging/`), all produced by `.github/workflows/release.yml`.

Third-party components and their licences are inventoried by `tools/licence-check.py`
(`THIRD-PARTY-NOTICES.md`); the parity of menus, toolbars and dialogs with the original editor
is tracked in `docs/parity-matrix.md` (`tools/parity-check.mjs`). Fast mode (`View > Fast
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
* The CEF profile is the per-user data folder (or a temporary folder in `--url` developer
  mode); nothing is shared with other browsers.

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

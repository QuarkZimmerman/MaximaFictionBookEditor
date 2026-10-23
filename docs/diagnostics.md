# Diagnostics log

The editor keeps one errors-only log (FR-131): every failure — a failed open or save, a
validation-engine or resource problem, a script error, an unexpected exception — is appended
with its code, a short message, context identifiers, the editor version and the platform.
Normal operations are never logged, the log never leaves the machine, and it never contains
book text or personal data. The About dialog's **Open log folder** button opens the folder.

## Location

| Platform | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Maxima Fiction Book Editor\logs\` |
| Linux | `$XDG_STATE_HOME/maxfbeditor/logs/` (default `~/.local/state/maxfbeditor/logs/`) |
| macOS | `~/Library/Logs/Maxima Fiction Book Editor/` |
| portable copy (a `user` folder next to the program) | `user/logs/` |
| `mfbe-core serve --data-dir DIR` (tests) | `DIR/logs/` |

The file is `mfbe-errors.log`; it rotates at 1 MB and keeps five files (`mfbe-errors.1.log`
… `.4.log`), so the log is bounded to about 5 MB. `app.info` reports the folder as `logDir`.

## Format

One JSON object per line:

```json
{"ts":"2026-10-13T04:40:22.857Z","level":"error","source":"core","code":"rpc.doc.ioError",
 "message":"doc.ioError","context":{"version":"0.0.5","platform":"linux","docId":"d3",
 "method":"doc.save","path":"/books/novel.fb2","reason":"cannot create temp file: Not a directory",
 "rpcCode":"1002"}}
```

| Field | Meaning |
| --- | --- |
| `ts` | UTC time with milliseconds |
| `level` | `error` or `warning` (nothing else reaches the file) |
| `source` | `core` (the headless core), `shell` (the CEF application), `ui` (the interface), `script` (a user script) |
| `code` | stable, machine-readable code (catalogue below) |
| `message` | short English message written by the program, never user content |
| `context` | always `version` and `platform`; `docId` / `nodeId` when a document is involved; further scalar identifiers listed below |
| `stack` | JavaScript stack of UI and script errors (file names and line numbers of the bundle or the script) |

Each field is capped at 4000 characters; values copied from RPC error data at 300.

## What is never logged

- Book text: titles, paragraphs, annotations, binary payloads, search terms, words sent to
  the spell checker or the Words tool (error data keys such as `word` or `text` are dropped
  before an entry is written; only `path`, `reason`, `line`, `column`, `field`, `id`, `lang`,
  `tag`, `docId`, `jobId`, `scriptId`, `nodeId`, `format`, `encoding` are copied).
- The session token, the page URL (it carries the token) or request query strings.
- Normal outcomes: cancellations, the "malformed XML" feedback while editing in the Source
  view (`doc.fromXml`, `doc.validate`, `doc.toXml` parse errors), validation issues of a
  book, `needsConfirmation` answers, missing images reported in the Body view.
- Successful operations, timings, settings values, file names of successfully opened books.

`tests/core/test_log_coverage.cpp` and `ui/tests/e2e/diagnostics.spec.ts` assert these
rules (one entry per failure, context present, fixture text absent, token absent).

## How failures reach the log

- **Core, RPC level** — every error the core returns to the interface is logged once by the
  JSON-RPC router as `rpc.<error name>` with the method, the `docId` / `path` parameters of
  the request, the job id for background jobs and the scalar identifiers of the error data.
  `error`: `internalError`, `doc.ioError`, `doc.parseError`; `warning`: protocol misuse and
  unavailable resources (`invalidParams`, `methodNotFound`, `doc.notFound`, `binary.notFound`,
  `spell.dictionaryUnavailable`, `script.*`, `settings.invalid`, `dialog.unavailable`).
- **Core, subsystems** — failures that do not surface as an RPC error are logged where they
  happen (per-user files, resources, binaries, HTTP, start-up); codes below.
- **Shell** — the CEF application logs with `source: shell` through the core
  (`sandbox.*`, start-up and native dialog problems).
- **Interface** — through the `log.error` RPC: failed commands (`command.<id>`), client-side
  open/save failures (timeout, lost connection), image uploads, uncaught exceptions and
  unhandled promise rejections (`ui.unhandledError`, `ui.unhandledRejection`, rate limited to
  20 per minute), script errors (`script.error` with `scriptId`, `line`, `column`).

## Code catalogue

| Code | Level | Context | When |
| --- | --- | --- | --- |
| `rpc.doc.ioError` | error | method, docId, path, reason, jobId | a file could not be read or written (open, save, export, import, binary.add) |
| `rpc.doc.parseError` | error | method, path, line, column, message | `doc.open` of a file that is not well-formed XML |
| `rpc.internalError` | error | method, docId | unexpected exception turned into an RPC error |
| `rpc.doc.notFound`, `rpc.binary.notFound` | warning | method, docId / id | stale document or binary id |
| `rpc.invalidParams`, `rpc.invalidRequest`, `rpc.parseError`, `rpc.methodNotFound` | warning | method, field | protocol misuse between interface and core |
| `rpc.spell.dictionaryUnavailable` | warning | method, lang, reason | no dictionary for the requested language |
| `rpc.script.notFound`, `rpc.script.invalidManifest` | warning | method, scriptId | script packages |
| `rpc.settings.invalid` | warning | method, field | rejected settings patch |
| `rpc.dialog.unavailable` | warning | method, reason | no shell attached for a native dialog / folder |
| `rpc.handlerCrashed`, `job.crashed` | error | method, jobId, what | C++ exception escaped a handler or a job |
| `server.startFailed`, `server.testHooksUnavailable` | error / warning | reason | start-up |
| `http.unauthorized`, `http.forbidden`, `http.staticReadFailed` | warning | path, status | rejected or failed HTTP/WebSocket requests (never the token) |
| `settings.unreadable`, `settings.writeFailed`, `settings.invalidValue` | error / warning | path, reason, key | `settings.json` |
| `hotkeys.unreadable`, `hotkeys.invalid`, `hotkeys.invalidEntries`, `hotkeys.writeFailed` | error / warning | path, reason, skipped | `hotkeys.json` |
| `recent.unreadable`, `recent.invalid`, `recent.writeFailed` | error / warning | path, reason | `recent.json` |
| `exclusions.unreadable`, `exclusions.invalidLines`, `exclusions.writeFailed` | error / warning | path, reason, skipped | `exclusions.txt` |
| `spell.customDictionaryLine`, `spell.customDictionarySaveFailed`, `spell.dictionaryEncoding` | warning / error | path, tag, encoding | `custom.dic`, Hunspell dictionaries |
| `genres.parseError`, `genres.duplicate`, `resources.conflict`, `resources.symbolsUnavailable`, `resources.languagesUnavailable` | warning | path, line, layer | layered resources |
| `scripts.invalidManifest`, `scripts.conflict`, `scripts.readFailed` | warning | path, scriptId, reason | script packages |
| `validation.schemaMissing`, `validation.schemaInvalid` | error | path, reason | `FictionBook.xsd` cannot be loaded (validation engine failure) |
| `binary.spillDirFailed`, `binary.spillFailed`, `binary.spillReadFailed` | warning / error | id, size, reason | temporary files of large binaries |
| `image.convertFailed`, `image.previewFailed` | warning | docId, id, reason | undecodable or oversized images |
| `io.createDirFailed`, `process.spawnFailed` | warning | path / program, reason | per-user folders, opening a folder with the OS |
| `ai.<kind>` - `ai.offline`, `ai.timeout`, `ai.tls`, `ai.http`, `ai.format` | warning | method (`ai.complete` / `ai.models` / `ai.test`), targetKind (`free` / `custom`), host, status (HTTP answers only) | an AI request failed (feature 005, FR-100): one entry per failed outcome and nothing else - never for a success, a cancel, a limit wait (429, 402, 503 with `Retry-After`) or a redirect; never the instruction, the conversation, the book's text, the key, the model or the service's words (a service failure is a result, not an RPC error) |
| `ai.caBundleMissing` | warning | path | `SSL_CERT_FILE` / `CURL_CA_BUNDLE` names no readable file (once per path and process); the next source of the CA order is used |
| `aiServices.<reason>` - `invalidJson`, `badVersion`, `missingField`, `badField`, `duplicateId`, ... | warning | path, index, field | an entry or file of the AI service list (`ai-services.json`, bundled or the user's) was skipped; the same issue is shown on the settings page |
| `command.<commandId>` | error | commandId, docId | a menu/toolbar/hotkey command threw |
| `file.openFailed`, `file.saveFailed` | error | path, docId | client-side open/save failure (timeout, lost connection) |
| `images.upload` | error | docId | image upload from the clipboard / drag-and-drop failed |
| `ui.unhandledError`, `ui.unhandledRejection` | error | docId, view | uncaught interface exception / rejection |
| `script.error` | error | scriptId, line, column | a user script threw (`Script error: … at line L, column C`) |
| `ai.internal` | error | requestId, the exception's `name` | an unexpected exception inside the AI assistant's request loop (`source: ui`; the request ends as failed; never the message or the stack) |

Shell codes (`source: shell`) are documented in `docs/installing.md` (sandbox fallback) and
emitted by `app/src/*`.

## Reading the log

The file is plain UTF-8 JSON lines, so `jq` works:

```bash
jq -c 'select(.level=="error") | [.ts,.code,.context.method,.context.path]' \
  ~/.local/state/maxfbeditor/logs/mfbe-errors.log
```

When reporting a problem, attach the log file: it contains no text of your books.

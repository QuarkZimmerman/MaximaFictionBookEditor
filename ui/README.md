# Maxima Fiction Book Editor - UI

TypeScript + React single-page application bundled with Vite. In production the bundle in
`dist/` is served by the native core (`mfbe-core serve`) on `http://127.0.0.1:<port>/?token=...`
and talks to it over JSON-RPC (WebSocket `/rpc`) plus a few HTTP endpoints (`/binary`,
`/scripts`, `/health`).

Requires Node 24 (the project toolchain version) and npm 11.

## Commands

| Command                | What it does                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm ci`               | Install the locked dependencies (`npm install` to update the lock file) |
| `npm run dev`          | Vite dev server with hot reload on `http://127.0.0.1:5173/`             |
| `npm run build`        | Type-check, then build the production bundle into `dist/`               |
| `npm run preview`      | Serve `dist/` locally (no core behind it)                               |
| `npm test`             | Unit tests (Vitest, jsdom) - `tests/unit/**/*.test.{ts,tsx}`            |
| `npm run test:watch`   | Unit tests in watch mode                                                |
| `npm run test:e2e`     | End-to-end tests (Playwright, headless Chromium) - `tests/e2e/`         |
| `npm run typecheck`    | `tsc --noEmit` for the app (`tsconfig.json`) and tooling configs        |
| `npm run lint`         | ESLint (flat config, `eslint.config.js`)                                |
| `npm run format`       | Prettier, rewrite files                                                 |
| `npm run format:check` | Prettier, verify only (used in CI)                                      |

End-to-end tests need the browser once per machine: `npx playwright install chromium`
(no `--with-deps`; the required system libraries are already part of the development image).

## Developing against a running core

```bash
# terminal 1: core with the built bundle (prints {"port": ..., "token": ...})
build/linux-core-debug/bin/mfbe-core serve --test-hooks --data-dir /tmp/mfbe-data --ui ui/dist

# terminal 2: UI dev server proxying API traffic to that core
cd ui && MFBE_CORE=http://127.0.0.1:41237 MFBE_TOKEN=<token> npm run dev
```

Environment variables read by the tooling:

| Variable              | Used by                          | Meaning                                                                                                                                |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `MFBE_CORE`           | `vite.config.ts`                 | Origin of the core the dev server proxies `/rpc` (WebSocket), `/binary`, `/scripts` and `/health` to. Default `http://127.0.0.1:41237` |
| `MFBE_TOKEN`          | `vite.config.ts`                 | Core session token, compiled into the bundle as `__MFBE_TOKEN__` (empty when unset)                                                    |
| `VITE_MFBE_CORE`      | `src/rpc/client.ts`              | Dev override of the core origin for the in-page RPC client (otherwise the page's own origin is used)                                   |
| `MFBE_CORE_BIN`       | `tests/e2e/fixtures/core.ts`     | Path to `mfbe-core`; when set every Playwright worker starts its own core (`serve --test-hooks --data-dir <tmp> --ui <dist>`)          |
| `MFBE_UI_DIST`        | `tests/e2e/fixtures/core.ts`     | UI bundle directory passed to `mfbe-core --ui` (default `ui/dist`)                                                                     |
| `MFBE_RESOURCES`      | `tests/e2e/fixtures/core.ts`     | Optional `--resources` directory for the test core                                                                                     |
| `MFBE_CORE_LOG_LEVEL` | `tests/e2e/fixtures/core.ts`     | Optional `--log-level` for the test core                                                                                               |
| `MFBE_UI_URL`         | `playwright.config.ts`           | `baseURL` of an already running UI, e.g. `http://127.0.0.1:41237/?token=...` or `http://127.0.0.1:5173/`                               |
| `MFBE_PREVIEW_PORT`   | `playwright.config.ts`           | Port of the `vite preview` server used in core-less e2e mode (default 4173)                                                            |
| `MFBE_PERF_FACTOR`    | the `@perf` journeys             | Allowance for the hosted CI runners on the budgets those journeys check (default 2; `docs/performance.md`)                             |
| `MFBE_PERF_RESULTS`   | `tests/e2e/perf-scripts.spec.ts` | File the script benchmark writes its measured times to (JSON)                                                                          |

Compile-time constants (declared in `src/vite-env.d.ts`): `__MFBE_TOKEN__` and
`__MFBE_UI_VERSION__` (the `version` from `package.json`).

The in-page RPC client (`src/rpc/client.ts`) connects to `ws(s)://<page host>/rpc?token=<token>`
with the token taken from the page URL (`?token=`) first and `__MFBE_TOKEN__` second. It
reconnects with exponential backoff (0.5 s to 10 s) and reports `connecting` / `connected` /
`disconnected` to the status bar ("Ready" / "Not connected").

## End-to-end tests

`npm run test:e2e` runs the Playwright journeys in one of three modes (see
`tests/e2e/fixtures/core.ts`):

1. **Core mode** - `MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core npm run test:e2e`.
   Each worker starts its own `mfbe-core serve --test-hooks --data-dir <tmp> --ui dist`, reads
   the ready line `{"port","token","pid"}` and exposes `core.rpc(method, params)`,
   `core.enqueueDialog(method, result)` and `core.openApp(page)` to the specs. Build the bundle
   first (`npm run build`).
2. **Running UI** - `MFBE_UI_URL=http://127.0.0.1:41237/?token=... npm run test:e2e`.
3. **Core-less mode** (default, no binary needed) - `vite preview` serves `dist/` on
   `127.0.0.1:4173`; the bundle is built when `dist/` is missing. The status bar shows
   "Not connected"; specs that need the core call `test.skip(!core.hasCore, ...)`. The
   `[vite] ws proxy error ... ECONNREFUSED 127.0.0.1:41237` lines in the output are the UI's
   WebSocket reconnect attempts reaching the absent core - expected in this mode.

Specs import `test`/`expect` from `./fixtures/core` instead of `@playwright/test`.

Three Playwright projects run: `chromium` (the interface in the system's language),
`chromium-ru` and `chromium-uk`, the main journeys again with the Russian and the Ukrainian
interface (`?lang=ru` / `?lang=uk`, option `uiLang`). Journeys assert the interface's texts
through `fixtures/i18n.ts`, which reads them from the catalogues in the language the page
shows, never as English literals; `us1-ukrainian.spec.ts` additionally fails on any visible
text that is not a Ukrainian catalogue value.

### AI journeys and the stand-in service (feature 005)

The ten AI journeys (`us1-ai-settings`, `us2-ai-popup`, `us3-ai-panel`, `us3-ai-tools`,
`us4-ai-validity`, `us5-ai-source`, `us6-ai-scripts`, `us7-ai-privacy`, `us8-ai-own-key`,
`us9-ai-disabled`) never contact a real AI service (FR-102) - not in CI, not on a developer's
machine. They run against `tests/e2e/fixtures/ai-standin.mjs`, a dependency-free Node stand-in
for an OpenAI-compatible service that the fixtures start themselves: `npx playwright test`
starts `mfbe-core` **and** the stand-in, nothing is configured by hand. The rules:

- **One stand-in per worker, or one of a test's own.** The worker fixture `standin` (from
  `./fixtures/core`) spawns `node ai-standin.mjs --port 0` on `127.0.0.1` only and reads its
  ready line `{"port","url"}`; a test that needs a stand-in of its own (a second service, a
  hosted name of its own) calls `startStandin()` and stops it in its teardown. Every journey
  calls `standin.reset()` first - the worker's stand-in is shared by its tests. For a manual
  session: `node tests/e2e/fixtures/ai-standin.mjs --port 8787` prints
  `{"port":8787,"url":"http://127.0.0.1:8787"}`; point a user list file or the custom address
  at `http://127.0.0.1:8787/v1`.
- **Scenarios are queued, never improvised.** `POST <base>/chat/completions` answers with the
  next item of the queue and an **empty queue is HTTP 500** (`stand-in: no scenario queued`) -
  a journey that forgot to queue an answer fails loudly instead of passing on a default. The
  vocabulary is the one list of ai-catalogue §9.1 (`standin.scenario()` / `scenarios()`):
  `{text}` (200, `finish_reason: "stop"`), `{toolCalls: [{name, arguments, id?}], content?}`
  (200, `finish_reason: "tool_calls"`; `arguments` an object or the JSON string a real service
  sends), `{status: 429 | 402 | 503, retryAfter?, body?}` (a limit),
  `{status, body, contentType?}` (any other HTTP answer), `{delayMs}`, `{overflow: true}`
  (one 400 `context_length_exceeded`, then the next item), `{finishReason: "length", text}`
  (a cut answer), the modes `{keyRequired: "<key>"}` (401 `missing_api_key` /
  `invalid_api_key` unless `Authorization: Bearer <key>`) and `{models: [...] | {...}}` for
  `GET <base>/models`; every item accepts `headers` (the `ratelimit-*` headers, `Location`)
  and `delayMs`.
  `standin.requests()` returns what the service received - method, path, headers with
  `authorization: "present" | "absent"` only (a key never lands in the record), body size and
  the parsed body - and is how a journey asserts the request the core built (`model`,
  `stream: false`, no `max_tokens`, no base64).
- **`recordOutside(context)` on every AI journey.** It routes every browser request to a host
  other than `127.0.0.1` into an aborting handler and records its URL; the journey asserts
  that the list stays empty at the end - the page itself never contacts anything. The core's
  own requests do not pass through the browser: `core.aiRequests()` (the `test.aiRequests`
  hook - method, target kind, host, outcome, status, never a body or a key) and the stand-in's
  record cover them.
- **Hosted names through `test.setAiResolve`, never a real host.** The stand-in is loopback;
  a journey that needs a _hosted_ service (the first-use notice, the agreement per host, the
  bundled entries) gives it one with `core.setAiResolve(['ai.standin.test:<port>:127.0.0.1'])`
  (libcurl's `host:port:address` form, cleared with `[]`) on a core started with
  `no_proxy=ai.standin.test` - `test.use({ coreEnv: { no_proxy: 'ai.standin.test' } })` for a
  core of its own, or `startCoreWith(..., { env })` - so that a runner's proxy never sees the
  name. The bundled entries are tested only after a user list file
  (`tests/fixtures/ai-services/user-override.json`) redirected them to the stand-in; terms
  links are asserted by `href` and never clicked.
- **The time-out case through `test.setAiTimeouts`.** `core.setAiTimeouts(connectMs, totalMs)`
  shortens the core's 20 s / 120 s for one case (a `{delayMs}` item longer than `totalMs`) and
  is restored to the defaults afterwards; no journey waits two minutes for real.
- **Every assertion through the UI or the hooks**, and the document checked afterwards: the
  working copy, the one undo step and the discard on cancel are the story's claims. Interface
  texts come from the catalogues (`fixtures/i18n.ts`); `chromium-ru` / `chromium-uk` run
  `us1-ai-settings` and `us7-ai-privacy` as well.

The vitest `tests/unit/ai/standin.test.ts` drives the stand-in in-process (`serveStandin()`,
`standinClient()`); `fake-core.mjs` answers the `ai.*` family with canned results for UI-only
runs and knows no scenarios.

The script benchmark `perf-scripts.spec.ts` is tagged `@perf`, as are the timing journeys of
`perf-large-book.spec.ts`, `us1-tree-divider.spec.ts` (the divider's layout step),
`us4-import-description.spec.ts` (the 10 MB book as an import source) and feature 005's one
`@perf` test in `us4-ai-validity.spec.ts` (a request with five change tools on the 10 MB book
against a zero-delay stand-in: each per-change validation of the hook under 1 000 ms × the
factor, the end-to-end time recorded as an annotation): CI runs the journeys with
`--grep-invert @perf` and the timed ones alone with `--grep @perf --workers=1` against the
Release core; `MFBE_PERF_FACTOR` (default 2) widens the budgets they check - the script
benchmark's 1 MB budget (5 s × the factor), the Body ↔ Source mapping step and the divider
layout step (100 ms × the factor), the import source's opening budget (3 s × the factor), the
validity hook's per-change budget (1 s × the factor) - for the hosted runners
(`docs/performance.md`).

A journey tagged `@platform` (feature 004: the proposed and typed file names, the spelling
scope; feature 005: `us1-ai-settings.spec.ts` and `us8-ai-own-key.spec.ts`, the whole files -
the UI → core → libcurl → loopback stand-in path once per operating system, since the HTTP
backends differ) runs on the Windows and macOS e2e legs of CI as well, against the
hooks-enabled `mfbe-core` built for that system (`npx playwright test --grep @platform`). Such
a journey must hold on all three systems: no `locale-gen`, `LC_ALL` or `chmod`, no `/tmp` or
other Linux path assumptions (use `os.tmpdir()` and `path.join`; the stand-in and a second
core are started through the fixtures, which do), file names compared after `normalize('NFC')`
where macOS may answer a decomposed spelling, and nothing the Linux leg installs through
`apt-get`. The Linux leg still runs the whole suite.

A dependency-free stand-in core, `tests/e2e/fixtures/fake-core.mjs` (+ `fake-doc.mjs`), serves
the bundle and answers `app.*`, `settings.*`, `hotkeys.*`, `dialog.*` (from the `test.enqueueDialog`
queue), `test.injectFault` and the whole `doc.*` family (a small XML parser, FB2 <-> model
conversion, encodings, atomic save with fault points, validation of the required fields, recent
files, carets, external-change polling, `GET /binary/...`). It exists to develop and debug the UI
before/without a C++ build - `MFBE_CORE_BIN=tests/e2e/fixtures/fake-core.mjs npm run test:e2e` -
and is never shipped. The US1 journey `us1-open-save.spec.ts` passes against both cores.

## Internationalisation

All user-visible strings live in the base catalogues `src/i18n/en.json`, `ru.json` and
`uk.json` plus the feature catalogues `<feature>.<lang>.json` next to them (`about`,
`description`, `fileDialogs`, `images`, `scripts`, `settings`, `spell`, `theme`, `transfer`,
`tree`, `words`), deep-merged at load (i18next JSON v4; plural forms `_one/_few/_many/_other`;
`{{name}}` placeholders; `&` marks the menu/button accelerator, `&&` is a literal ampersand).
Keys are grouped by area: `menu.*` (labels exactly as the original `IDR_MAINFRAME` menu),
`cmd.<commandId>.{tooltip,description}`, `dialog.*`, `msg.*`, `status.*`, `hotkeys.*`. Missing
keys print a warning in development, throw in unit tests and fall back to the key in production.

The Ukrainian catalogues (release 0.0.3) reuse the original editor's own Ukrainian wording
wherever it had the string - its resource scripts and `ukr.xsl`, paired with the Russian text
by resource id in `tools/resources-import/ukr-glossary.tsv` - and translate the rest from the
Russian text (the original's register), with the English consulted where the meaning was in
doubt; obvious typos of the original were corrected, access-key collisions resolved.

`node ../tools/i18n-check.mjs` (no dependencies; `--languages en,ru,uk` by default) fails when
a key is missing in a language, when placeholders differ, or when a plural family lacks a form
required by `Intl.PluralRules` for that language; values identical to the English are warnings
unless listed in `src/i18n/identical-allowlist.json` (`--strict-identical` makes them errors);
`--accelerators` reports an access key used twice within one menu or dialog.

## Layout

```text
ui/
  index.html              entry page (no CSP meta: the core sends the security headers)
  public/icons/           toolbar PNGs copied from resources/icons (see public/icons/README.md)
  src/main.tsx            React bootstrap: i18n init, services, RpcClient, <App>
  src/ai/                 the AI assistant (feature 005). Static, in the main bundle: index.ts
                          (the feature registrar: the commands ai.toggle / ai.ask / ai.cancel,
                          the Disabled rule, the one import() of the chunk), address.ts,
                          agreements.ts, testHooks.ts. Everything else is the lazy `ai-assistant`
                          chunk (the folder rule of vite.config.ts; tests/unit/ai/chunk.test.ts
                          checks the build): chunk.ts (the chunk's entry), assistant.ts (the
                          request loop), catalogue.ts (+ tools/: the MCP server and client over an
                          in-memory transport), protocol.ts (the wire format, error and wait
                          ladders), hook.ts (the validity hook), context.ts, split.ts, reply.ts,
                          source.ts (the Source text path), session.ts, activity.ts, summaries.ts,
                          target.ts, proposal.ts(x), notice.tsx, regexRunner.ts + regex.worker.ts,
                          AiPanel.tsx, AskPopup.tsx, ai.css. The settings page lives in
                          src/dialogs/settings/AiPage.tsx (main bundle).
  src/app/                shell: App.tsx, MenuBar.tsx (+ menus.ts model), Toolbars.tsx
                          (+ toolbars.ts), StatusBar.tsx, ViewSwitcher.tsx, layout.css (CSS
                          variables for fonts/colours), commands.ts (registry + built-in
                          commands, each with its duringScriptRun policy), hotkeys.ts (chord
                          grammar, defaults, HotkeyMap), services.ts / AppContext.tsx (service
                          wiring + hooks), TransientNotice.tsx (+ transientNotices.ts: the
                          short self-hiding notice of the work area, e.g. "finished in N s")
  src/dialogs/            Dialog.tsx (frame, focus trap, DialogHost), DialogService.ts (modal
                          stack), MessageBox.tsx, InputDialog.tsx, SaveChangesPrompt.tsx,
                          EncodingDialog.tsx (+ encodings.ts), ValidationPanel.tsx (+ validation.ts:
                          issue messages, save-anyway prompt, go-to-issue), show.ts (showMessage /
                          showInput / showSaveChangesPrompt / showEncodingDialog / createDialogs),
                          types.ts
  src/editor/             schema.ts (ProseMirror schema of the FB2 body), fromModel.ts / toModel.ts
                          (lossless model <-> editor conversion), virtualization.ts (section
                          windowing), plugins/nbsp.ts (NBSP marker), styles.css (the original
                          main.css look)
  src/features/file/      fileCommands.ts (New/Open/Save/Save As/Validate/Exit and the window-close
                          quit flow of app.closeRequested, notifications, start-up parameters),
                          recent.ts (Recent Files, caret restore)
  src/features/help/      versionCheck.ts (Help > Check for new version, the prompt),
                          schedule.ts (when a start-up check is due: other.versionCheck and
                          session.lastVersionCheck)
  src/scripting/          host.ts (one run at a time, working copy, cancel, duration; a run nested
                          in an AI request), runSession.ts (the run lock `store.runLock`, elapsed
                          ticks, one undo entry at the commit, restore on cancel - shared by script
                          runs and AI requests), api-impl.ts (the mfbe allow-list), workingCopy.ts
                          (copy-on-write document, checkpoint / rollback), sandbox*.ts,
                          ScriptRunBanner.tsx (banner above the document, per kind of the lock:
                          name or service · model, elapsed time, progress or current operation,
                          busy sign, Cancel), RunBar.tsx (the status-bar line), ScriptsMenu.tsx /
                          ScriptsToolbar.tsx
  src/i18n/               index.ts (i18next setup, parseAccelerator), en.json, ru.json,
                          uk.json, <feature>.<lang>.json, identical-allowlist.json
  src/model/              document.ts (copy of contracts/document-model.d.ts), store.ts
                          (AppState + useAppState), undo.ts (UndoCoordinator), caret.ts
                          (per-view caret providers)
  src/rpc/                client.ts (JSON-RPC over WebSocket), types.ts (RpcMethods,
                          RpcNotifications, Settings, HotkeyBinding, ...)
  src/views/              body/ (BodyView + bodyEditor.ts controller, imageViews.ts), source/
                          (SourceView + sourceEditor.ts controller, sourceSession.ts: text, parse
                          rules, view commands; completion.ts + fb2Elements.json: FB2 tag
                          completion, the table generated by tools/fb2-schema-elements.py),
                          description/ (read-only summary until US3), tree/ placeholder (US5)
  src/vite-env.d.ts       Vite client types + compile-time constants
  tests/unit/             Vitest unit tests (+ setup.ts with jest-dom matchers)
  tests/e2e/              Playwright end-to-end tests (fixtures/core.ts starts mfbe-core and the
                          AI stand-in fixtures/ai-standin.mjs; fixtures/ai-proposals/ holds the
                          script packages the US6 journey has the stand-in propose)
  vite.config.ts          build, dev server, proxy, defines, `@` -> `src/` alias, the
                          `ai-assistant` chunk rule (isAiAssistantModule)
  vitest.config.ts        merges vite.config.ts; jsdom, globals, v8 coverage
  playwright.config.ts    Chromium only, headless, list + HTML reporter, 60 s timeout
  tsconfig.json           browser code: src/ + tests/unit/ (strict, ES2022, bundler resolution)
  tsconfig.node.json      Node code: the three config files + tests/e2e/
  eslint.config.js        typescript-eslint, react-hooks, react-refresh, prettier compat
```

## Toolchain notes

- **TypeScript is pinned to `~6.0.3`, not `latest` (7.0.x).** TypeScript 7.0 is the new native
  (Go) compiler. Of the tools that take TypeScript as a peer dependency, `typescript-eslint`
  8.71.2 (and its `@typescript-eslint/typescript-estree` parser) declares
  `typescript: ">=4.8.4 <6.1.0"`, so 7.0 is not supported yet. Vite 8.3.4 and Vitest 5.0.4 have no
  TypeScript peer dependency (they transpile with esbuild/oxc and only need `tsc` for type
  checking), and `react-i18next` 17 accepts `^5 || ^6 || ^7`. The newest release satisfying every
  range (`npm view typescript versions --json`) is 6.0.3, hence `~6.0.3` (TypeScript minors are not
  semver-compatible, so no caret). Re-check `npm view typescript-eslint peerDependencies` before
  moving to 7.x. `tsc --noEmit` passes on 6.0.3 with the configuration in this folder without any
  `ignoreDeprecations` setting.
- **ESLint 10.** `eslint@latest` is 10.x; every plugin in use (`typescript-eslint` 8.71,
  `eslint-plugin-react-hooks` 7.1, `eslint-plugin-react-refresh` 0.5, `eslint-config-prettier` 10)
  declares `^10` in its peer range, and flat config is the only format. ESLint 10 no longer
  depends on `@eslint/js`, so it is listed as an explicit dev dependency.
- **`@types/node` follows the Node line we run (24.x)**, not the registry `latest` (26.x), so the
  type definitions match the runtime used by CI and by the CMake build.
- **jsdom 30.1.2 declares `engines.node: ^22.22.2 || ^24.15.0 || >=26`.** `npm install` prints an
  `EBADENGINE` warning on Node 24.14.1; the unit tests run fine on it. Use Node >= 24.15 to avoid
  the warning.
- Vite 8 warns when a config file imports another config without a file extension; therefore
  `vitest.config.ts` imports `./vite.config.ts` and `tsconfig.node.json` enables
  `allowImportingTsExtensions`.

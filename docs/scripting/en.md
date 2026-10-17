# Writing scripts for Maxima Fiction Book Editor

Scripts automate repetitive editing: case conversion, footnotes from bracketed text, image
captions, quote processing, clean-up, statistics. They are written in plain **JavaScript
(ES2023 modules)** and run inside the editor on every platform exactly the same way. This
guide covers the script package format, every capability of the `mfbe` interface with a
runnable example, the sandbox rules and how to port scripts written for the original
FictionBook Editor. The Russian version is [ru.md](ru.md); TypeScript typings for editors
with code completion are in [mfbe.d.ts](mfbe.d.ts); the examples live in [examples/](examples/).

## 1. Where scripts live

The editor looks for scripts in several folders and merges what it finds (nothing in a
lower layer is ever hidden or replaced):

1. the folder chosen in **Tools > Settings > Other > Scripts folder** (optional),
2. your personal scripts folder (`Scripts > Open scripts folder` opens it):
   - Windows: `%APPDATA%\Maxima Fiction Book Editor\scripts\`
   - Linux: `~/.local/share/maxfbeditor/scripts/`
   - macOS: `~/Library/Application Support/Maxima Fiction Book Editor/scripts/`
   - a portable copy: `user/scripts/` next to the program,
3. a portable folder next to the program that the editor cannot write to (`user/scripts/`),
4. the scripts bundled with the editor (read-only, inside the installation).

Inside a scripts folder every **group** is a sub-folder and every **script** is a sub-folder
of a group. The `NN_` prefix orders groups and scripts and is removed from the displayed name:

```text
scripts/
├── 01_Регистр/                      → sub-menu "Регистр" (order 1)
│   ├── group.json                   optional: {"names": {"en": "Case", "ru": "Регистр"}}
│   ├── 01_К верхнему регистру/      → one script = one folder
│   │   ├── script.json              the manifest (required)
│   │   ├── index.js                 the entry module (required unless "entry" says otherwise)
│   │   └── icon.png                 16 px icon for the Scripts toolbar (optional, PNG/ICO/SVG)
│   └── 02_К нижнему регистру/
├── 06_Чистка/
└── tree/                            → "tree" scripts (Document Tree context menu)
    └── Пример 1/
```

Use **Scripts > Reload scripts** after adding or editing a package (the list is also refreshed
when the editor starts and when the folder changes). A folder without `script.json` or with
an invalid manifest is skipped and reported in the error log and in **Settings > Other**.

### Customising a bundled script

The bundled scripts cannot be edited in place. Copy the script's folder into your personal
scripts folder, give it a **new `id`** in `script.json` (a copy with the same id is ignored,
the bundled one wins) and change `name` so you can tell the two apart. Your copy appears next
to the original; it may live in a group of the same name, in which case both end up in the
same sub-menu.

## 2. The manifest (`script.json`)

```json
{
  "manifestVersion": 1,
  "id": "fbe.case.upper",
  "name": { "en": "To upper case", "ru": "К верхнему регистру" },
  "description": { "en": "Converts the selected text to upper case" },
  "kind": "menu",
  "entry": "index.js",
  "icon": "icon.png",
  "defaultHotkey": "Ctrl+Alt+U",
  "needsSelection": true,
  "undoLabel": { "en": "Upper case", "ru": "Верхний регистр" },
  "legacy": { "source": "01_Регистр/01_Верхний регистр.js", "fbeVersion": "2.7" }
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `manifestVersion` | yes | always `1` |
| `id` | no | unique id (reverse-DNS style recommended); defaults to `<group folder>/<script folder>`; duplicates across folders are reported and the first one (bundled first) wins |
| `name` | yes | display names by language; `en` is required, `ru` optional |
| `description` | no | tooltip / status-bar text by language |
| `kind` | yes | `menu` (Scripts menu, toolbar, hotkey) or `tree` (Document Tree context menu). Missing: `tree` inside the `tree/` folder, `menu` elsewhere, with a warning |
| `entry` | no | entry module inside the folder, default `index.js` |
| `icon` | no | PNG, ICO or SVG inside the folder; scripts with an icon get a toolbar button |
| `defaultHotkey` | no | chord such as `Ctrl+Alt+U`, `Mod+Shift+F5` (`Mod` = Ctrl, Cmd on macOS); users may change it in Settings > Hotkeys (group "Scripts"); collisions are reported there |
| `needsSelection` | no | the command is disabled while nothing is selected in the Body view |
| `undoLabel` | no | label of the single undo step (default: the name) |
| `legacy` | no | provenance of a converted FBE script |

## 3. A script

The entry module exports one default `async` function that receives a context:

```js
export default async function run(ctx) {
  // ctx.script     = { id, name, group, kind }
  // ctx.uiLanguage = 'en' | 'ru'
  // ctx.treeNode   = { nodeId, type } for kind "tree" (the node that was right-clicked)
  // ctx.cancelled  = true once the user asked to cancel
  const selection = await mfbe.selection.get();
  await mfbe.ui.message(selection ? selection.text : 'Nothing selected');
}
```

Everything the script does with the editor goes through the global `mfbe` object, and
**every call returns a Promise** - always `await` it. The whole run is one undo step: one
**Edit > Undo** reverts everything the script changed. While a script runs, the book cannot
be edited and the status bar shows the run with a **Cancel** button; after 30 seconds without
any `mfbe` call (time in the script's own dialogs aside) it says that the script has not
reported progress for a while. Cancel stops the script and leaves the book exactly as it was
before the run, and so does an error. Errors are reported as
`Script error: <message> at line L, column C` (line/column inside the script's file) and
written to the error log. The script can `import` other modules placed in its own folder
(`import { helper } from './lib/helper.js'`); nothing outside the folder can be loaded.

Run a script from **Scripts > <group> > <name>**, its toolbar button, its hotkey, or
**Scripts > Last script** (the most recently run one). Tree scripts appear under
**Scripts** in the Document Tree context menu.

## 4. The `mfbe` interface

Nodes are addressed by **references** `{ nodeId, type }` (or just the `nodeId` string).
`type` is the FB2 element name: `body`, `section`, `title`, `epigraph`, `annotation`, `p`,
`subtitle`, `text-author`, `v`, `stanza`, `poem`, `cite`, `empty-line`, `table`, `tr`,
`td`, `th`, `image`, `inline-image`, `date`. Node contents are JSON in the editor's document
model (see `mfbe.d.ts` and the `document-model` types it references): a node is
`{ type, attrs, content }`; text is `{ type: 'text', text, marks }` where marks are
`strong`, `emphasis`, `strikethrough`, `sub`, `sup`, `code`, `{ type: 'style', attrs: { name } }`
and `{ type: 'link', attrs: { href, type: 'note' } }`.

### 4.1 Document - `mfbe.doc`

| Member | What it does | Example |
|--------|--------------|---------|
| `doc.get()` | Snapshot of the whole book (description, bodies, binaries metadata) as JSON. Snapshots over 64 MB are refused - use the traversal helpers instead | [08-tree-command.js](examples/08-tree-command.js) |
| `doc.getNode(ref)` | Snapshot of one node and its subtree | [04-structure.js](examples/04-structure.js) |
| `doc.replaceNode(ref, node)` | Replaces a node's subtree; the node id is kept; the type must be allowed by the parent at that position | [04-structure.js](examples/04-structure.js) |
| `doc.insertNode(where, ref, node)` | Inserts `node` `'before'` / `'after'` the reference node or `'append'`s it as the last child; returns the reference of the new node. `'after'` the last body with `{ type: 'body', attrs: { name: 'notes' }, … }` creates a new body | [04-structure.js](examples/04-structure.js) |
| `doc.removeNode(ref)` | Removes a node and its subtree. Any body except the first one may be removed (a book needs its main body); the last section of a body stays | [04-structure.js](examples/04-structure.js) |
| `doc.setDescription(description)` | Replaces the whole description block (title-info, document-info, ...) | [08-tree-command.js](examples/08-tree-command.js) |
| `doc.getElementsByTagName(name, within?)` | All nodes of an FB2 element name in document order, optionally inside a subtree. For inline marks (`emphasis`, `strong`, `link`...) the text blocks that contain the mark are returned | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.textOf(ref)` | Plain text of a subtree (text blocks joined with `\n`, inline images as U+FFFC) | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.setText(ref, text)` | Replaces the inline content of a text block (`p`, `subtitle`, `v`, `text-author`, `td`, `th`, `date`) with plain text; existing inline markup is dropped | [02-walk-paragraphs.js](examples/02-walk-paragraphs.js) |
| `doc.parentOf(ref)` / `doc.childrenOf(ref)` | Structural parent (null for a body) and direct children | [04-structure.js](examples/04-structure.js) |
| `doc.find(query)` | Matches of a search over all text blocks (or `within` a subtree): `{ text, regex?, matchCase?, wholeWord?, within? }` → `[{ nodeId, from, to, text }]` | [03-replace-all.js](examples/03-replace-all.js) |
| `doc.replaceAll(query, replacement)` | Replaces every match; with `regex: true` the replacement understands `$1`-`$9`, `$0`, `$+`, `$U`/`$L`/`$T` (case), `$S`/`$E` (strong/emphasis), `$Q` (reset) like Edit > Replace; returns `{ count }`. Patterns are compiled with the `u` flag (no identity escapes such as `\"`); there is no escape for a literal `$` in a regex replacement | [03-replace-all.js](examples/03-replace-all.js) |
| `doc.binaries()` | Metadata of the binary objects (`id`, `contentType`, `size`, `width`, `height`...), never the bytes | [06-statistics.js](examples/06-statistics.js) |
| `doc.stats()` | `{ characters, words, paragraphs, sections, images, notes, binaryBytes }` | [06-statistics.js](examples/06-statistics.js) |

Edits made with `doc.*` are schema-checked before anything changes: inserting a `title` after
a paragraph, a `p` directly into a `body`, or a node whose subtree is invalid (a section mixing
paragraphs and sub-sections, an empty poem) fails with a clear error instead of producing an
invalid book. Errors of `mfbe` calls are rejected promises whose `name` is `ScriptApiError`
and whose `code` tells the kind: `invalidNode` (the message names the offending path, e.g.
`invalid node at "section/poem[2]"`), `notAllowed` (the parent would become invalid),
`unknownNode` (stale node id) or `apiError` (bad arguments / state). Node operations cover
the bodies only: the description's annotation and history are edited through
`doc.setDescription`.

### 4.2 Selection and caret - `mfbe.selection`

| Member | What it does | Example |
|--------|--------------|---------|
| `selection.get()` | `{ anchor: {nodeId, offset}, head, text, nodes }`; `null` only when no book is open. Without a selection in the Body view it reports a collapsed selection (`anchor` = `head`, `text: ''`) at the start of the first text block - test `text === ''` for "nothing selected". A selected image reports `nodes: []`, `text: '\uFFFC'` and the enclosing paragraph (inline image) or body (block image) as `anchor.nodeId` | [01-upper-case.js](examples/01-upper-case.js) |
| `selection.set(anchor, head?)` | Moves the caret / selects a range (offsets count characters inside the text block); `anchor` and `head` may lie in different text blocks | [09-long-running.js](examples/09-long-running.js) |
| `selection.replaceText(text)` | Replaces the selected text (keeps the surrounding marks) | [01-upper-case.js](examples/01-upper-case.js) |
| `selection.wrap(mark)` | Applies `'strong'`, `'emphasis'`, `'strikethrough'`, `'sub'`, `'sup'`, `'code'`, `{ style: 'name' }` or `{ link: '#id', note: true }` to the selection | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `selection.unwrap(mark)` | Removes a mark (`'style'` and `'link'` remove any named style / link) | [04-structure.js](examples/04-structure.js) |
| `selection.selectNode(ref)` | Selects a whole node, scrolling the Body view to it | [04-structure.js](examples/04-structure.js) |
| `selection.scrollIntoView()` | Scrolls the current selection into view | [04-structure.js](examples/04-structure.js) |

### 4.3 Dialogs and status - `mfbe.ui`

| Member | What it does | Example |
|--------|--------------|---------|
| `ui.message(text, options?)` | Message box; `options.buttons` is a list of `{ id, label, default?, cancel? }` (default: OK), `options.icon` is `info`/`warning`/`error`/`question`; resolves with the id of the pressed button | [06-statistics.js](examples/06-statistics.js) |
| `ui.prompt(text, options?)` | Single-line input; resolves with the text or `null` on Cancel; with `yesNoCancel: true` the buttons are Yes / No / Cancel (No resolves with `''`) | [07-legacy-port.js](examples/07-legacy-port.js) |
| `ui.form(spec)` | Declarative modal dialog with `text` (optionally `multiline`), `number` (`min`/`max`), `checkbox`, `select`, `radio`, `list` (`multiple`; its value is always an array) and `static` fields; resolves with `{ fieldId: value }` or `null` on Cancel. One form at a time - a palette or a live list is a loop of forms | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `ui.status(text, options?)` | Status-bar text; cleared when the script ends unless `{ sticky: true }` | [01-upper-case.js](examples/01-upper-case.js) |
| `ui.progress(done, total?, label?)` | Progress in the status bar, next to the Cancel button; like every `mfbe` call it shows that the script is still working, so call it in long loops | [09-long-running.js](examples/09-long-running.js) |

### 4.4 Editing helpers - `mfbe.edit`

| Member | What it does | Example |
|--------|--------------|---------|
| `edit.label(text)` | Names a sub-step (informational; the run stays one undo entry) | [05-footnotes-form.js](examples/05-footnotes-form.js) |
| `edit.nbsp` | The non-breaking space character (`'\u00A0'`) | [09-long-running.js](examples/09-long-running.js) |
| `edit.symbols()` | The editor's symbol table `[{ codepoint, name }]` (Settings > Symbols) | [06-statistics.js](examples/06-statistics.js) |

### 4.5 Environment - `mfbe.env`

| Member | What it does | Example |
|--------|--------------|---------|
| `env.settings()` | Read-only `{ nbspDisplayChar, pasteImageFormat, jpegQuality, uiLanguage }` | [06-statistics.js](examples/06-statistics.js) |
| `env.docLanguage()` | The book language (`title-info/lang`) | [06-statistics.js](examples/06-statistics.js) |

### 4.6 Legacy helpers

For mechanical ports the following functions exist both as globals and as `mfbe.*`
members (see [07-legacy-port.js](examples/07-legacy-port.js)):

| Function | Behaviour |
|----------|-----------|
| `MsgBox(text, caption?, flags?)` | VBScript-style message box: `flags` select the buttons (0 OK, 1 OK/Cancel, 2 Abort/Retry/Ignore, 3 Yes/No/Cancel, 4 Yes/No, 5 Retry/Cancel), the icon (16 error, 32 question, 48 warning, 64 information) and the default button (256 second, 512 third); resolves with 1 OK, 2 Cancel, 3 Abort, 4 Retry, 5 Ignore, 6 Yes, 7 No |
| `InputBox(prompt, caption?, defaultValue?)` | Input prompt; resolves with the text or `null` on Cancel |
| `BeginUndoUnit(label?)` / `EndUndoUnit()` | No-ops kept for ported code (the run is already one undo unit) |

## 5. Sandbox rules

Scripts run in a dedicated Web Worker with a private channel to the editor. Before the script
loads, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `Worker`,
`SharedWorker`, `indexedDB`, `caches`, `navigator`, `BroadcastChannel`, `MessageChannel`,
`OffscreenCanvas`, `performance.memory` and the worker's own `postMessage`/`close` are removed;
the page's Content-Security-Policy additionally blocks any network access and any module that
does not come from the script's own folder. There is no file system, no clipboard, no access
to the editor's HTML, no storage. The full JavaScript language and its built-ins (`String`,
`RegExp`, `Array`, `Map`, `Math`, `Date`, `Intl`, `JSON`, `Promise`, `setTimeout`,
`console` - routed to the editor log in development builds) remain available. Widening the
`mfbe` interface is a product decision; a script cannot grant itself more.

## 5a. While a script runs

From the moment a script starts until it ends the editor shows a banner above the document
with the script's name, the time elapsed, the progress it reports (`ui.progress`) and a
**Cancel** button; the status bar keeps its run line. The document is under a *quiet lock*:
nothing is greyed and the places the script highlights (`selection.selectNode`) stay visible,
but the user's edits are refused in every view until the run ends.

What stays available while a script runs:

- reading, scrolling, selecting and copying text in the Body, Source and Description views;
- **Find**, **Find Next** and the incremental search (not Replace: the Replace and Replace All
  buttons of the Replace dialog are disabled for the run);
- the **Help** menu, including **Check for new version**, and **About**;
- **Exit** and closing the window - see below;
- the script's own messages, prompts and forms, and **Cancel**, at any time (also while the
  script is busy without reporting progress).

What is unavailable until the run ends:

- typing, pasting, dragging and deleting in the Body, Source and Description views; the
  Description form's fields are read-only (not disabled), its add / remove / choose buttons
  and the cover and binary controls are disabled;
- every menu, toolbar and hotkey command that changes the document: Cut, Paste, Undo, Redo,
  the Add and Style menus, the Document Tree operations (move, merge, delete), the table and
  links bars, spelling and the Words dialog;
- switching the view (Description / Body / Source) and the toolbar toggles;
- **New**, **Open**, the recent files, **Reload**, **Save** and **Save As** - the book is never
  written in an in-between state of a run;
- **Settings** and the Hotkeys configuration (applying them could switch the view or the
  language);
- starting another script, by menu, toolbar, "Last script", a tree command or a hotkey: the
  editor says that a script is already running.

The pointer over the document shows the busy state while the script is computing, not while
it waits in one of its dialogs.

**Exit and closing the window.** File > Exit and the window's close button first ask
"A script is running. Cancel it and exit?". **Yes** cancels the run - the document returns to
its state before the run within two seconds - and the usual "Save changes?" prompt follows;
**No** keeps the run going and nothing closes. Cancelling the save prompt abandons the exit as
well. The window's close button behaves exactly like Exit: the shell defers the close, lets the
editor run these prompts and closes only once they are answered.

**When the run ends** the banner disappears, the document becomes editable again and the
status bar says whether the script finished (and how long it took), was cancelled or failed
(with the error, as before). A run longer than five seconds additionally shows a short notice
in the work area that disappears by itself without taking the focus.

For script authors this means: no script can wait for the user to edit the text directly -
interact through `ui.message`, `ui.prompt`, `ui.form` and `ui.progress`, and check
`ctx.cancelled` inside long loops so that Cancel takes effect promptly.

## 6. Porting scripts from the original FictionBook Editor

The original scripts were JScript running inside Internet Explorer's rendering of the book;
they walked the HTML DOM (`document.all.tags("P")`, `innerText`, `TextRange`) and called a
handful of host helpers. The capabilities map one to one:

| Legacy (FBE 2.x) | Maxima | Notes |
|------------------|--------|-------|
| `function Run() { ... }` | `export default async function run(ctx) { ... }` | add `await` before every `mfbe` call |
| `MsgBox(text)` | `await MsgBox(text)` or `await mfbe.ui.message(text)` | |
| `window.external.AskYesNo(text)` | `(await MsgBox(text, caption, 4)) === 6` | or `ui.message` with Yes/No buttons |
| `InputBox(prompt, title, value)` | `await InputBox(prompt, title, value)` | `null` on Cancel |
| `window.external.BeginUndoUnit(document, name)` / `EndUndoUnit(document)` | `await BeginUndoUnit(name)` / `await EndUndoUnit()` | optional - the run is one undo step |
| `window.external.SetStatusBarText(text)` | `await mfbe.ui.status(text)` | |
| `window.external.GetNBSP()` | `mfbe.edit.nbsp` | |
| `window.external.GetBinarySize(data)` | `(await mfbe.doc.binaries()).find(b => b.id === id).size` | bytes never reach scripts |
| `window.external.GetViewWidth()/Height()` | not available | lay-out dependent; use `ui.form` for options instead |
| `window.showModalDialog("dialog.htm", ...)` | `await mfbe.ui.form({...})` | one `FormSpec` per HTML dialog |
| `document.all.tags("P")`, `getElementsByTagName("DIV")` | `await mfbe.doc.getElementsByTagName('p')` (`'section'`, `'title'`, ...) | FB2 names, not HTML classes |
| `el.innerText` | `await mfbe.doc.textOf(ref)` | |
| `el.innerText = s` | `await mfbe.doc.setText(ref, s)` | drops inline marks; prefer `replaceAll` for text-only changes |
| `el.innerHTML = ...`, `outerHTML` | `doc.replaceNode(ref, node)` / `doc.insertNode(...)` | build FB2 JSON nodes |
| `el.parentElement`, `el.children` | `doc.parentOf(ref)`, `doc.childrenOf(ref)` | |
| `document.selection.createRange().text` | `(await mfbe.selection.get()).text` | |
| `range.text = s`, `range.pasteHTML(...)` | `await mfbe.selection.replaceText(s)`, `selection.wrap(...)` | |
| `api.fbwDoc` / `doc.Description...` | `await mfbe.doc.get()` + `doc.setDescription(...)` | |
| `TreeCmd`: `ProcessCmd()`, `GetClassName()`, `GetTitle()` | `kind: "tree"`, `run(ctx)` with `ctx.treeNode`, `name` in the manifest | highlighting classes are replaced by edits or `selection.selectNode` |

Conversion tiers used for the bundled scripts: **Tier 1** (text/regex over paragraphs,
MsgBox/InputBox) ports mechanically with the façade; **Tier 2** (sections, notes, images,
poems) is rewritten against `mfbe.doc`; **Tier 3** (HTML dialogs) replaces each `.htm`
dialog with a `ui.form` spec; **Tier 4** (engine debugging helpers) is replaced or dropped
with a note in the release notes. `tools/legacy-script-audit.py` classifies the original
scripts and generates manifest skeletons; `tests/scripts/run-script.mjs` runs a package
headless on a fixture book and prints the resulting FB2 for snapshot comparison.

## 7. Checklist for a new script

1. Create `<scripts folder>/<NN_Group>/<NN_Name>/` with `script.json` and `index.js`
   (start from `tools/script-template/`).
2. `export default async function run(ctx)`; `await` every `mfbe` call.
3. Read what you need (`selection.get`, `doc.getElementsByTagName`, `doc.textOf`), change it
   (`selection.replaceText`, `doc.setText`, `doc.replaceAll`, `doc.insertNode`...), tell the
   user (`ui.status`, `ui.message`).
4. Call `ui.progress` inside long loops and stop when `ctx.cancelled` is set.
5. **Scripts > Reload scripts**, run it, press **Edit > Undo** once to check that the whole
   run reverts.

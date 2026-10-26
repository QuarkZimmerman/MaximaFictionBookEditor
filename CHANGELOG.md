# Changelog

All notable changes to Maxima Fiction Book Editor. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.0.6 - unreleased

### Changed

- Builds of the 0.0.6 development line call themselves `0.0.6-rc` - in Help > About, in
  `mfbe --version` and `mfbe-core --version`, in the build id (`0.0.6-rc+<hash>`) and in the
  package file names (`MaximaFictionBookEditor-0.0.6-rc-win64.msi`, `mfbe_0.0.6-rc_amd64.deb`,
  ...) - and `0.0.6-rc.N` when built from a tag `v0.0.6-rc.N`, so that a test build is never
  taken for 0.0.5 or for the final 0.0.6. The deb and rpm packages have the version `0.0.6~rc`
  (`0.0.6~rc.N` from a tag), which dpkg and rpm sort before `0.0.6`, so the final 0.0.6 sorts
  after every test build. The fields that must be plain numbers carry `0.0.6`: the MSI's
  version, the Windows file version, the application manifest and the macOS bundle versions,
  which Apps & features and Finder's Get Info show. The MSI's product name carries the label
  (`MaximaFictionBookEditor 0.0.6-rc` in Apps & features and in the setup dialogs). An
  untagged AppImage embeds no update information and comes without a `.zsync` file, so it
  never updates itself; an AppImage built from a tag `v0.0.6-rc.N` follows every release, the
  next test build and the final alike.
- Help > Check for new version orders a pre-release before its final: `0.0.5` < `0.0.6-rc` <
  `0.0.6-rc.1` < ... < `0.0.6-rc.10` < `0.0.6`, with `rc.N` ordered by N as a number. A
  `+build` part is ignored, and a rebuild of the same version is still not newer. A test build
  therefore learns that its final is out, which 0.0.5's comparison of the numbers alone did not
  tell it (it read `0.0.6-rc.1` as `0.0.6.1`, newer than `0.0.6`); a final release is never
  offered a pre-release, since the check asks for the latest full release.
- A table cell's language (`xml:lang`) is kept and written as a known attribute of the cell:
  scripts see it as `attrs.lang`, where release 0.0.5 kept it in `unknownAttrs` under the key
  `{http://www.w3.org/XML/1998/namespace}lang`. An attribute given both ways - a known value
  and the same name in `unknownAttrs`, such as a span set by a script on a cell whose span text
  was not a number - is written once, the known value winning; 0.0.5 wrote it twice, and the
  saved file was not well-formed. Span values below 1 are kept exactly as written unless they
  are in plain decimal form (`0`, `-1`), so `00` or `-01` no longer become `0` or `-1`.

### Fixed

- The copyright strings of the Windows file properties (*Copyright* under *Properties >
  Details*) and of the macOS application bundle name the project's licence - "Copyright (c)
  2026 Quark Zimmerman. GNU General Public License version 3 (GPL-3.0-only)." -, as Help >
  About does; both had kept the licence of 0.0.1.
- Carriage returns written in a book as `&#13;` (or `&#xD;`) no longer turn into line feeds
  when the book is saved: the text is written with `&#13;` again, in the body, the annotations
  and the other description fields alike, and reads back unchanged.
- Inline formatting keeps its language (`xml:lang` on `strong`, `emphasis`, `strikethrough`,
  `sub`, `sup`, `code` and named styles), and links keep their `xlink:type`, through opening,
  editing and saving; release 0.0.5 dropped both when a book was opened. Scripts see them as
  `attrs.lang` and `attrs.xlinkType` of the marks; changing a link's target or kind keeps its
  `xlink:type`. Other attributes of these elements are still dropped.
- Pictures and other inline items (unknown inline elements, comments, processing instructions)
  keep the link and the formatting around them through opening, editing and saving, in table
  cells and everywhere else: a picture that is a link (`<a l:href="#s1"><image .../></a>`), or a
  bold one, is written back as read, and bold or a link applied to a selected picture is saved.
  Release 0.0.5 dropped them when a book was opened, and wrote a picture at the end of a link
  outside it. File > Validate also reports a broken link on a picture alone, and
  `mfbe-core roundtrip` counts a lost link or formatting around a picture as a difference.

## 0.0.5 - unreleased

### Added

- The AI assistant (feature 005). Settings gains an **AI assistant** page with three choices:
  *Disabled* - the default, so the assistant works only after a service has been chosen
  there -; *Free service (no registration)* with a drop-down of the bundled services that need
  no account and no key, each shown as "name - model" with its limits note in the interface
  language and a link to its terms: OVHcloud AI Endpoints (`gpt-oss-120b`, first, the entry
  the choice starts with) and Pollinations (`openai-fast`); and *My own service and key*.
  *Test connection* sends one small request and reports "answered (model)" or the failure in
  the service's own words. The services come from a list file: the bundled `ai-services.json`
  is always read, never modified by the editor, and a copy of the user's own in the data folder
  (the `user` folder of a portable copy) - created by *Edit list*, applied by *Reload list* -
  adds entries, overrides a bundled entry with the same id (a stale address is corrected without
  an update) or hides one; a malformed user file is reported on the page, entry by entry, and
  the bundled list stays in use. The choice travels with a portable copy. Two further entries
  bundled during development were dropped at the release-day check of 2026-10-23: Kilo Gateway
  (its free tier withdrew the verified model and the replacement answered unstably) and LLM7.io
  (its tool-call round trip answered 502 from the origin at the second exchange in two runs;
  the proof-reading alone passed).
- The first-use notice. Before anything leaves the computer for a hosted service - the first
  request, *Test connection* or *Fetch models* - a notice names the service, says that the
  instruction and the parts of the book the assistant reads will be sent to it, links to its
  terms and offers Yes / No; Yes is remembered per service (and per host, so a list entry that
  redirects a bundled id asks again), the settings page lists the agreements with *Withdraw*,
  No sends nothing. A server on the user's own computer is never asked about; a plain `http`
  address that is not on this computer is accepted with a warning that the text travels
  unencrypted, repeated in the notice.
- The assistant panel. A panel on the right of the view - its width set by a divider and
  remembered in `session.aiPanelWidth`, its visibility in `session.aiPanelVisible`: open at the
  first start and back at every start as it was left. View > AI Assistant (Ctrl+Shift+A,
  Cmd+Shift+A on macOS), a button in the toolbar's View group and the panel's close box show
  and hide it in every mode. While the assistant is *Disabled* the panel is inert - its
  controls greyed, no conversation, a notice that the assistant is disabled with a link that
  opens the settings page - and nothing of the feature is loaded or contacted. With a service
  chosen the visible panel is live, at once when OK is pressed and without a restart: the
  service and model in use and a link to the settings page, the conversation, an activity list
  naming what the assistant did (the parts of the book it read, the changes it made, the
  scripts it ran, the validations, the waits), the phase and the elapsed time while a request
  runs, and the instruction field (Enter sends, Shift+Enter inserts a newline; Send becomes
  Stop; Clear; Undo). Hiding a live panel turns the assistant off, drops the conversation
  (never written to disk) and leaves the editor in its ordinary flow, after a question when a
  request runs. A text answer is shown without a change; an unsure assistant asks back and the
  next instruction continues the conversation; the history is trimmed from the oldest turn
  when it outgrows the service's context, and the panel says so.
- The end line of a request names the count and the place of its changes - "Done: 2 changes
  in the body text", "Done: 1 change in the Description view (book title)", or both - with the
  number of exchanges and the elapsed time. An answer that called no change is marked as words
  only, never as "Done", and when its words claim a change that no operation made the line
  carries the note that none was made - the book is as it was. The assistant is also told that
  a change exists only when an operation confirmed it, and that the book's title means the
  title in the description and the body's own title alike.
- *Ask AI...* in the context menu of the Body view and of the Source view (Ctrl+K) while the
  assistant is on: a popup next to the selection shows how much is selected and which service
  answers, takes one instruction and replaces the selection with the result - emphasis and
  footnote links kept where the service kept them, the replacement selected, *Done* with
  *Undo*; without a selection the paragraph at the caret is the context. A question gets its
  answer in the popup with *Continue in panel*; Escape cancels a running request and leaves
  the document as it was; an outside click closes an idle popup. In the Source view the
  selected XML travels as XML, and the returned XML is applied only when the document stays
  well-formed and valid with it; a selection that cuts into a binary, the stylesheet, the XML
  declaration or the root tag is refused.
- The catalogue of operations: the editor offers the model its operations as an MCP catalogue
  (Model Context Protocol - the open standard by which AI programs discover another program's
  tools), built with the official MCP TypeScript SDK and running inside the editor's own page;
  nothing listens for other programs. 22 tools - the working context, the outline, parts of
  the book, the selection, the description, search, validation and the FB2 schema for reading;
  the selection, a node, a text, every occurrence of a text and the description for changing;
  the scripts for listing, reading, running, proposing and reloading - plus the FB2 schema, the
  script API description, the scripting guide and the bundled example script as resources, and
  two prompts. Oversize material - a selection, a tool result, the history - is split along
  block or outline boundaries within the same request and the same undo step, pre-emptively
  where the service's context length is known and on the service's refusal otherwise; images
  travel as their tags, never as data; the model's regular expressions run in a worker with a
  2-second budget.
- The validity hook: every change the assistant proposes is applied to a working copy and
  checked against the FB2 2.1 schema first - and by the editor's own element rules before the
  round trip. A change that adds a schema error the document did not have before the request
  is refused with the errors (element and position) returned to the model; the third refusal
  of the same change ends the request with nothing of it applied and the errors shown; the
  commit of a request is checked once more as a whole. Pre-existing errors of the book are
  reported as before and never block an unrelated change. The model may read the whole schema
  or one element's content model.
- Scripts through the assistant. The assistant lists the scripts of the effective layers, reads
  their files and runs one nested in its request exactly as the Scripts menu would - the
  script's own dialogs appear, captioned with its name and "run by the AI assistant", its
  changes are validated like every other change and belong to the request's one undo step,
  Cancel on the banner cancels script and request together, a failed script is rolled back and
  the request goes on. It proposes complete script packages: a dialog shows every file in full
  and the target folder and offers *Write*, *Write and run* and *Don't write*; nothing is
  written before the choice, a written script lands in the user scripts folder under the group
  `90_assistant` (ids `assistant/<name>`), is in the Scripts menu at once and has the rights
  and limits of every user script; a bundled script is never modified - a change to one is
  proposed as a new user script - and a script written in the conversation runs only when the
  user asked for it.
- *My own service and key*: the address of any service speaking the OpenAI chat-completions
  format, a key and a model, with *Fetch models* offering the list the service returns (a typed
  name accepted when it lists none) and *Test connection* on the unsaved draft - nothing is
  stored before OK. Red text says the connection is not tested; a successful test turns it
  green with the model's name; an edit of the address, the key or the model turns it red
  again, and the same values are green again when the page is reopened (the record is tied to
  the triple and the core refuses a forged one). A model server on the user's own computer
  (llama.cpp, Ollama, LM Studio; `http://127.0.0.1:11434/v1`) is such a service with an empty
  key: no notice, no network beyond the computer. The key is stored with the settings so that a
  portable copy takes it along, shown masked, replaced by `•••` wherever a service echoes it
  and never written to the diagnostics log; a wrong or missing key is reported in the service's
  own words with a link to the settings page.
- *Disabled* - the default: the editor starts with it, and choosing it again later (OK) brings
  the same state back without a restart and after one: *Ask AI...*, its hotkey, the popup and
  the first-use notice are gone, no request leaves the editor and no code of the feature is
  loaded or runs. What stays is the panel's place: View > AI Assistant, Ctrl+Shift+A and the
  toolbar button still show and hide the panel, inert then and pointing to the settings page.
  Choosing *Free service* or *My own service and key* makes a visible panel live at once and
  brings *Ask AI...* back. Chosen while a request runs, the editor asks whether to stop it
  first.
- Every dialog can be moved by its title bar - with the mouse, a pen or a finger - within the
  window: Settings, the message boxes, the AI popup and the first-use notice, the script
  proposal and the scripts' own dialogs alike (Find and Replace could be moved before). A
  dialog keeps its place while it is open and never leaves the window (a smaller window pulls
  it back in); a moved dialog opens centred again the next time, Find and Replace where they
  were closed, as before; nothing is stored about where a dialog was left. The keyboard -
  Escape, Enter, Tab, the accelerators - works as before.
- Limits and slow services: a service's "wait" - a 429, a 402 or a 503 that names the wait -
  is waited out with a visible, cancellable countdown and the request retried, up to 5 minutes
  per request, and a service that reports its remaining quota in its headers is paced before
  it refuses; a longer wait (a daily quota) ends the request with the advice to try later or
  choose another service. Answers arrive whole with their elapsed time shown; a cut-off answer
  is shown as such and never applied. The document is locked during a request as during a
  script run, with the banner naming the service and model, the current operation, the
  elapsed time and Cancel; Stop reacts within a tenth of a second.
- New libraries: libcurl 8.21.0 (the curl licence) with OpenSSL 3.6.3 on Linux and macOS and
  the system's Schannel on Windows, statically linked in the core, which now sends the
  assistant's requests itself; the MCP TypeScript SDK (`@modelcontextprotocol/server` and
  `@modelcontextprotocol/client` 2.3.1, Apache-2.0) and the schema library zod 4.6.7 in the
  interface, confined to a lazily loaded chunk (`ai-assistant-*.js`) that is requested only when
  the assistant is turned on for the first time; the Mozilla CA certificate bundle (MPL-2.0,
  an aggregated data file with its notice next to it, `resources/certs/`, refreshed by
  `tools/refresh-cacert.py`) in the Linux packages only, as the last fallback of certificate
  verification - Help > About shows its notice there. `THIRD-PARTY-NOTICES.md` lists every one
  of them.
- Core API minor 4 (additive): the `ai.*` family (`ai.services`, `ai.reloadServices`,
  `ai.createUserServices`, and the jobs `ai.complete`, `ai.models`, `ai.test` with the
  phases `connecting` / `waiting` / `receiving`), `app.openUrl`, `doc.fragmentToXml` /
  `doc.fragmentFromXml`, `schema.text`, `scripts.write`, the `ai` settings group,
  `session.aiPanelWidth` and `session.aiPanelVisible`, the error codes 1200-1203 and the test
  hooks `test.aiRequests`, `test.resetAiRequests`, `test.setAiResolve`, `test.setAiTimeouts`
  (hooks-enabled builds only). Service failures are results, never RPC errors, so that a
  service's words never reach the diagnostics log; the core logs a failed request as
  `ai.<kind>` with the method, the kind of target, the host and the status only, and never a
  limit wait or a redirect.

### Changed

- The editor's network use. 0.0.4 made exactly one kind of network request, the check for a new
  version; 0.0.5 makes exactly two - that check, unchanged, and the AI assistant's requests to
  the service chosen in Settings, made only on the user's action (sending an instruction while
  the assistant is on, pressing *Test connection* or *Fetch models*), only after the recorded
  agreement for a hosted service, never while the assistant is off and never under *Disabled*
  (constitution 3.1.1, requester decision of 2026-10-22). The requests carry the instruction,
  the conversation of the session, the working context and the results of the operations the
  model asked for - never image data, never the whole book on the editor's initiative, never
  identifiers, settings or usage data - with the headers `Content-Type`, `Accept`,
  `User-Agent: MaximaFictionBookEditor/<version>` and `Authorization` only when a key is
  configured. The core takes its proxy from the environment (`https_proxy`, `http_proxy`,
  `all_proxy`, `no_proxy` and their upper-case forms; loopback always direct), verifies
  certificates through the system store on Windows (Schannel) and macOS (SecTrust) and on
  Linux through `SSL_CERT_FILE` or `CURL_CA_BUNDLE`, the distribution's bundle or, last, the
  shipped Mozilla bundle; verification is never relaxed, TLS 1.2 is the minimum, only `http`
  and `https` are reachable, no redirect is followed (a 3xx is reported and the user corrects
  the address), a request body is capped at 8 MiB and a response at 16 MiB.
- The script run lock is generalised into a run session shared by script runs and AI requests:
  the quiet lock of 0.0.3 - typing, pasting and the document-changing commands refused, the
  banner above the document in every view, the status-bar line, Cancel - now has a holder of
  either kind, the banner shows the script's name or the service and model with the current
  operation, one session at a time holds the lock so that a script cannot start during an AI
  request and vice versa, and every session ends either in a commit recorded as one undo entry
  or in a discard that restores the document and its modified flag. Exit and the window's close
  button ask whether to cancel the running request as they ask about a running script. No
  script's behaviour changes.
- The Commands toolbar's View group gains the AI Assistant button after the three view buttons.
  A customised toolbar layout stored by an earlier release does not gain it by itself:
  *Customize Toolbar* adds it and *Reset* restores the default order with it; the button shows
  and hides the panel in every mode, under *Disabled* too. The two hotkey tables gain
  Ctrl+Shift+A (View > AI Assistant) and Ctrl+K (Ask AI...), rebindable like every other;
  Ctrl+Shift+A shows and hides the panel in every mode, while Ctrl+K does nothing under
  *Disabled* and is absent from the Hotkeys page then.
- Settings file: the `ai` group (`ai.mode` with the default `disabled`, `ai.freeServiceId`
  with the default `ovhcloud`, `ai.custom.address` / `ai.custom.key` / `ai.custom.model`,
  `ai.customVerified`, `ai.agreements`), `session.aiPanelWidth` (360) and
  `session.aiPanelVisible` (`true`: the panel is open at the first start and written, like
  `session.treeVisible`, when it is hidden or shown) are new; a 0.0.4 settings file keeps every
  value and the new keys take their defaults. The core's API minor is 4; every change is
  additive.

## 0.0.4 - 2026-10-21

### Added

- The Document Tree pane can be made narrower or wider: a divider between the pane and the
  view area - the Body, Description or Source view, whichever is shown - is dragged with the
  mouse, both sides are laid out again as it moves, the pane never goes under 160 px and the
  view never under 320 px, and the width is kept for the next start (`session.treeWidth`,
  260 px until you change it). View > Document Tree hides the pane and the divider together
  and brings them back at the same width. Resizing is not a change to the book and works
  while a script runs.
- Other persons in the Description view. The title-info group gains, after Translators, an
  "Other persons" list - empty for a new document - where a person is added with a role
  chosen from the six the Maxima Library knows (Illustrator, Editor, Compiler, Designer,
  Commentator, About the author) and the three names, and removed again; the Authors and
  Translators lists are unchanged. The entries are written exactly as the library and the
  Maxima FBD Maker write them - one `custom-info` element per person with the library's
  `info-type` and `Last_name First_name Middle_name` text, no `.` added to a one-letter
  name - so a book made with the editor arrives in the library with its roles; a file's
  existing entries are shown in the list and written back character for character while
  the list is not edited, and the library's record-number entries (`mlseriesid` and the
  like) stay plain Custom info rows. A person without a last name is marked, since the
  library would read the first name as the last name.
- File > Import > Description from FictionBook file...: imports the description of another
  `.fbd` or `.fb2` file into the open document. The file is read exactly as Open reads a
  book (every encoding, 2.0 or 2.1, with or without a body; a malformed file or a file that
  is not a FictionBook document is refused with a message and nothing changes). Into a
  freshly created document whose description has not been touched everything is imported
  at once; otherwise a dialog lists the entries found - genres, authors, book title,
  annotation, keywords, date, cover (with a small picture), language, source language,
  translators, sequences, other persons, source title info, document info, publish info
  and the custom info rows - each with an unticked checkbox and its value, and Import,
  disabled while nothing is ticked, replaces exactly the ticked entries, each list as a
  whole. The import is one undo step, the status bar counts the entries, the active view
  stays, and image data crosses inside the editor's core - the same cover imported twice
  is stored once.
- File > Export > Export as FBD...: writes the description of the open document, as it is
  in the editor at that moment, as a stand-alone FBD file - the whole description with the
  cover and the other images it refers to, and one empty section in place of the text, so
  the file passes FB2 2.1 validation. Always UTF-8, validated first with Save's own "export
  anyway?" question, written atomically, never over the open document's own file; the open
  document, its file and its Recent Files entry stay as they were.
- A proposed file name. Save As (and Export as FBD) for a document that has never been
  saved proposes "Last name First name - Book title" in the book's own letters - the first
  author when there are several, "Untitled" in the interface language when there is neither
  title nor author - cleaned of the characters no file system accepts, cut to 120
  characters and 200 bytes, and handed to the system's dialog as Unicode on every platform,
  so a Cyrillic name comes out with the same letters on a Windows with a German locale. The
  encoding asked for in the dialog applies to the document's content alone, as before.
- Settings > Other > Open File > "Switch keyboard layout when a document is opened" with the
  layout chosen from the system's list: every time a document is opened - at start, with
  File > New, Open, Recent Files, a double-click or a dropped file, the restart after a
  language change, the reload of a changed book - the editor switches its own window to
  that layout. The original FictionBook Editor switched once at start-up; a tester whose
  system starts with a German layout asked for the switch on open. Only a layout the system
  already offers is ever activated, nothing is installed or changed in the system, and a
  layout removed later is shown as "(not installed)" and ignored. Works on Windows and under
  X11 on Linux; in a Wayland session, where the system offers an application no way to
  switch the layout, the option is shown greyed out with the note "The system offers no way
  to switch the layout" (requester decision D2 of 2026-10-20; the desktop's own switch of
  GNOME and KDE is a candidate for a later release); macOS best effort.

### Changed

- The annotation and the history are back at the top of the Body view and in the Document
  Tree, where the original FictionBook Editor had them. Two framed blocks captioned
  "Annotation" and "History" sit above the first body - the same text as the Description
  view's annotation and history fields, which stay as a second place to edit it - and the
  tree lists them above the bodies, with View and View Source. Typing, Find, Replace, the
  Words tool, spelling and Undo cover the blocks like the body; a selection across a block
  boundary can be copied but not deleted or cut; a block can hold paragraphs, subtitles,
  empty lines, poems, cites and tables but no section; an annotation or history that is
  present but empty in the file is kept exactly as read until one of its two editors is
  used (0.0.3 dropped it on save), and a block that was never in the file is not written
  while it stays empty.
- The browser engine's own spell checker is switched off everywhere, so no mark appears in
  the Description view or in any dialog or text box, whatever dictionaries the system has:
  the editor's own checker - its dictionaries, its marks, its Spelling dialog - covers the
  book's text in the Body view, the annotation and history blocks included, and nothing
  else. The Spelling command and the "Highlight misspelled words" toggle stay available in
  every view as before, and the dialog checks the Body text wherever it is started.
- "Restore position" reworked. The place is remembered on every route that leaves a
  document - New, Open, Recent Files, a file forwarded by the system, every save, Exit, the
  window's close button, the restart, the reload of a changed book - and restored on every
  route that opens one, in the Body view without switching the active view, scrolled into
  view. It is kept by the element's place in the document and the character offset, so it
  survives a visit to the Source view and the next start, in `positions.json` - a record of
  its own beside Recent Files holding the 100 files most recently remembered (0.0.3 kept it
  in the ten-entry Recent Files list, under session-bound identifiers that a Source visit or
  a restart invalidated) - and compared as the platform compares file names. A file that
  changed meanwhile puts the caret in the paragraph now at that place, or at the start.
  Clear Recent Files is unchanged. The core's `doc.caret` method is deprecated in favour of
  `doc.position` (API minor 3; a legacy `caret` in `recent.json` is converted once).
- The caret and the selection travel between the Body and the Source view. Switching to
  Source puts the caret, or the selected range, on the same characters of the XML and
  scrolls them into view; switching back selects the same text in the Body view, also after
  the Source text was edited (the position is mapped through the text actually parsed). A
  place without a Body equivalent - the prolog, the description, a binary - lands at the
  start of the document. The mapping is recorded by the core while it writes or parses the
  Source text and costs about a millisecond on a 10 MB book.
- Settings file: `session.treeWidth`, `other.switchKeyboardLayout`, `other.keyboardLayoutId`
  and `other.keyboardLayoutName` are new; a 0.0.3 settings file keeps every value and the
  new keys take their defaults. The core's API minor is 3; every change is additive.

### Fixed

- Titles and subtitles are centred in the Body view (tester's complaint 1). The Body view's
  generic paragraph rule, of the same weight as the title rule and written after it, won the
  cascade, so body, section and poem titles - and titles inside epigraphs and cites - were
  justified and indented like ordinary paragraphs; subtitles were centred already. The same
  defect had defeated the rule for the lines of a stanza, which are left-aligned again with
  no gap between them (requester decision of 2026-10-20); nothing else in the rendering
  changes, in either theme and with any body font.
- A text selected in the Body view, and the caret, are no longer lost when switching to the
  Source view (complaint 2) - see "The caret and the selection travel" above. The Source
  round trip after a Body edit also keeps the selection on the right node: the core's
  snapshot of the document is refreshed when the Source text is produced, so the remap of
  the next parse follows the model the text was made from (requester decision of
  2026-10-20).
- Spell checking no longer marks words in the Description view (complaint 3) - English words
  in a Russian book's publisher or keywords, for instance - see "The browser engine's own
  spell checker" above.
- The setting that switches the keyboard layout when a file is opened, which the tester
  remembered from the original, exists again (complaint 4) - see "Switch keyboard layout
  when a document is opened" above.
- "Restore position" restores the position (complaint 5) - see "Restore position reworked"
  above. Two defects found on the way are fixed with it: a caret placed while another view
  was active was not scrolled into view when the Body view was next shown, and the session
  settings written shortly before Exit (the pane width among them) could be lost because the
  debounced save had not run; the quit flow now flushes it.

## 0.0.3 - 2026-10-17

### Added

- Ukrainian interface, as the original offered: Settings > View lists System default, English,
  Russian and Ukrainian, and a first start on a Ukrainian system is in Ukrainian. Every menu,
  dialog, tooltip, message, file-type name, genre name, language name and symbol name exists in
  Ukrainian - the original editor's own Ukrainian wording wherever it had the text, the rest
  translated from the Russian texts - with access keys unique in every menu and dialog; the
  desktop shell's own right-click menu and the save dialog's encoding label follow. Script
  groups named in Ukrainian in their `group.json` show that name; the bundled scripts' own
  messages, prompts and forms stay as the scripts have them (English under the Ukrainian
  interface), while the buttons and captions the editor adds are Ukrainian. The automated
  parity check covers the three catalogues.
- Built-in Ukrainian spelling dictionary (`uk_UA`, the dict_uk dictionary): books in Ukrainian
  are checked, suggestions offered, words with the apostrophe handled, in every package without
  a download. The dictionary is run-time data the editor only reads and ships as an aggregate
  with its Mozilla Public License 1.1 notice, shown in Help > About like the other notices.
- Spelling dictionaries from a folder. Settings > View shows the dictionaries folder - the
  per-user folder of an installed editor, the `dictionaries` subfolder of the `user` folder of
  a portable one, or a folder of your own - with "Open dictionaries folder", which creates it
  when needed; a Hunspell `.aff`/`.dic` pair copied there (the dictionaries LibreOffice and
  Firefox use, any encoding the editor reads: UTF-8, UTF-16, Windows-1251/1252, ISO-8859-1/2/5/15,
  KOI8-R) is in effect after Apply or the next start, without administrator rights. The list
  "Dictionaries in effect" names every dictionary with its origin and every file the editor
  could not use with the reason - a missing partner file, an unreadable file, an encoding it
  cannot convert, a pair whose tag a built-in dictionary already has (built-in dictionaries are
  never replaced). Help > About lists every dictionary in effect with its origin and notice.
- Check for a new version on a schedule: Settings > Other > Version check offers at every
  start, once a day, once a week, once a month (the default, also for settings files of 0.0.2)
  and never. When the chosen interval has passed since the last answered check, the editor
  makes the same single request as Help > Check for new version in the background once the
  window is usable, and speaks up only when a newer version exists - after any open dialog,
  never over a script run or a file dialog; the latest version and a failed check are silent,
  and a failed check is retried at the next start. The manual command works as before; both
  record when they got an answer, in the per-user settings or the portable `user` folder.
- Windows installer: "Create a shortcut on the desktop", ticked by default as in the original's
  installer; the shortcut carries the editor's name and icon, goes to the desktop of all users,
  is removed by uninstalling, and an upgrade keeps the choice. Unattended installations choose
  with `INSTALLDESKTOPSHORTCUT=1` or `=0` (`msiexec /i <msi> /qn INSTALLDESKTOPSHORTCUT=0`).
- Tag completion in the Source view: after `<` the editor offers the FB2 elements the schema
  allows inside the enclosing element (every element where the enclosing one cannot be
  determined, the root element only at the root); after `</` only the elements open at the
  cursor and not yet closed, innermost first, each completing to the whole closing tag. Enter
  and Tab accept, Esc dismisses, typing filters, Ctrl+Space (the "Complete tag" hotkey,
  rebindable in the Hotkeys settings) asks on demand; nothing is offered inside comments,
  processing instructions, CDATA, attribute values or binary data. The "Tag completion" switch
  of Settings > View > XML source editor turns it off. In a 10 MB book the list appears well
  within its 300 ms budget (about 130 ms on the development host) and typing stays responsive.

### Changed

- A running script is unmistakable. A banner above the document - in every view, with the
  status bar shown or hidden - shows the script's name, the elapsed time, the progress it
  reports ("phase - done/total (NN %)", or the bare count without a total), a moving busy sign
  and Cancel; the status-bar line of 0.0.2 stays. The document is under a quiet lock: nothing
  is greyed and the places the script highlights stay visible, but typing, pasting, dragging
  and deleting are refused in the Body, Source and Description views and in the Document Tree,
  and every command that changes the document, switches the view, opens or saves a file (New,
  Open, Recent files, Reload, Save, Save As) or opens Settings or the Hotkeys configuration is
  unavailable; no second script can start. Reading, scrolling, selecting, copying, Find, Find
  Next, the incremental search, the Help menu, About and Exit stay available, and the pointer
  shows the busy state only while the script computes, not while it waits in its own dialog.
  When the run ends the status bar says "finished in N s", and a run longer than 5 seconds also
  ends with a short notice in the work area that disappears by itself and never takes the
  focus. Exit and closing the window during a run first ask whether to cancel the script. The
  scripting guide describes what is available while a script runs; no bundled script's
  behaviour changes.
- Closing the window by its title-bar button (or a system shutdown) runs exactly the Exit
  flow: the cancel-script prompt while a script runs, then "Save changes to X?" - Yes saves and
  closes, No closes without saving, Cancel keeps the editor open with nothing lost. A close
  request that arrives behind an open dialog (New/Open prompt, Settings, a file dialog) is
  ignored until that dialog is finished, like a native window behind its modal dialog.
- "Restart now?" after a language change restarts the editor, as the original did. Yes - after
  the usual save prompt, whose Cancel abandons the restart - closes the editor and starts the
  same program again from the same place with its own start-up options, the same data folder
  (a portable copy stays portable), the open document, the same window position and size
  (maximised if it was) and the new language; a new document never saved is not carried over.
  The new copy starts only after the old one has fully exited. When the editor cannot start
  itself again it says so and stays open. In 0.0.2 Yes only closed the editor.
- Dates follow the system's regional settings. "Today" in the Description view writes today's
  date into the date value as `YYYY-MM-DD` and into the date text in the long date form of the
  operating system's regional settings without the day of the week - "17 октября 2026 г." on a
  Russian Windows, "17 жовтня 2026 р." on a Ukrainian one, "October 17, 2026" on a US-English
  one, "17 октября 2026" on a Russian Linux - replacing whatever both fields held (0.0.2 kept an
  existing text and wrote English month names). The document date the editor fills in when it
  loads a document with an empty date is written the same way. When the system has no regional
  settings the interface language's long form is used. The text stays free text, saved as
  written.
- Licence policy: run-time data files the editor only reads and never combines into the
  program - spelling dictionaries - are aggregates: their licence must allow free
  redistribution with notice (the Ukrainian dictionary's MPL 1.1 does), the licence check lists
  them in their own section of `THIRD-PARTY-NOTICES.md`, and their notice ships next to the file
  and is shown in Help > About.
- Menus stay inside the window: a submenu that does not fit to the right of its item (the
  Scripts groups under the longer Ukrainian labels, already the case in Russian at 1280 px)
  opens to the left, a menu that does not fit below moves up and scrolls when the window is
  too small, and the Document Tree's context menu is placed by its measured height.
- Room for longer labels, found by a screenshot pass over every screen in the three languages:
  the Settings > Other checkbox labels, the Hotkeys page with the scripts group, the About
  dialog's "Open log folder" button beside a long log path, the Customize Toolbar lists and the
  Words dialog's count column no longer run into their neighbours or clip; labels wrap or end in
  an ellipsis inside their column, the Customize Toolbar dialog is as wide as Settings.

### Fixed

- The window opens where it was closed. 0.0.2 recorded the window position and size at every
  change but never applied them, so every start opened a centred 1200 x 800 window; the
  placement - maximised state included, as the original restored its window placement - is now
  applied at every start and clamped to the visible screen.
- Closing the window by its title-bar button no longer skips the editor's quit flow: in 0.0.2
  unsaved changes were lost without a prompt and a running script was torn down silently.
- A book whose language has a region the dictionaries do not know (`de-AT`, `pt-BR`) is checked
  with the dictionary of its language (`de_DE`); 0.0.2 found no dictionary for it.
- A dictionary whose `.aff` names an encoding the editor cannot convert is reported in Settings
  as unusable instead of being read as UTF-8 (0.0.2 fell back silently, with a line in the
  log); a removed or replaced dictionary file is dropped when Settings are applied instead of
  staying in use from the cache.

## 0.0.2 - 2026-10-15

### Added

- Help > Check for new version...: asks the project's release page for the latest published
  release and names a newer one, offering its page in the system browser; otherwise "You have
  the latest version", and "Can't connect to server" when the answer does not come. This is
  the editor's only network request, made only when the command is chosen. The About dialog
  links to Maxima Library.
- Toolbars are customised as in the original: a right-click on the Commands or the Scripts
  toolbar offers "Customize toolbar...", which adds, removes and orders the buttons and
  separators and restores the original layout; a button also moves when dragged with Shift
  held, or leaves the toolbar when dropped off it, and a double-click on the toolbar opens the
  dialog. Each toolbar keeps its layout for the next start. The Scripts toolbar starts with
  "Last script" alone, as the original's, and offers every script with an icon by its name.
- A `blank.fb2` of the user's own - in the template folder chosen in Settings > Other, the
  per-user data folder or the portable folder - is the template of new documents, as written,
  without administrator rights; one that cannot be used is named and the built-in template
  used. Settings > Other shows the template in effect and opens its folder.

### Changed

- Like the original, the editor shows a new, untitled document at start-up when no file is
  named, and File > New gives the same: the original's blank document, element for element
  (0.0.1 started with an empty window and used a rewritten template). As the original did,
  the editor fills in the document id (new documents), version, program used and document
  date when a document is created or opened, without marking it modified.
- Licence: the editor is now published under the GNU General Public License version 3
  (GPL-3.0-only), the licence of the original FictionBook Editor, whose scripts, icons, genre
  and symbol lists and blank document it includes (0.0.1 was published under the MIT
  licence). The original's copyright notices and contributor list ship as `CONTRIBUTORS.txt`
  and are shown in Help > About with the GPL notices, the bundled scripts carry their
  authors' notices again, and the packages include the licence text of every third-party
  component under `share/doc/mfbe/licenses/`.
- The portable Windows package keeps everything it stores - settings, recent files, logs, the
  browser cache, the custom dictionary and the user's own template, genres, scripts and
  dictionaries - in its `bin\user` folder and nothing in the user's profile, so the copy moves
  with its folder, to another computer or onto a USB stick; the installed package is unchanged.
  The settings a 0.0.1 portable copy kept in the profile are not carried over.

### Fixed

- Windows: the editor, installed or portable, no longer ends at start-up when the user's
  profile folder or the program's folder has letters outside English - every Cyrillic user
  name on Russian Windows. The shipped `mfbe.exe` lacked the editor's manifest, so Windows ran
  it with the legacy code page and the folder names were converted wrongly; the manifest is
  now in the executable and every conversion between file names and text is explicit. Started
  as administrator, the installed editor no longer leaves a `debug.log` in its program folder.
- Every menu item is readable without moving the pointer over it. The items of submenus -
  every Scripts group, File > Recent Files - and of the Body context menu took the colours of
  the item or view around them, white on white or the Body's text colour; menus now carry
  their own colours, also in the dark theme and with Windows contrast themes.
- Find and Replace in the Body view select each match in the text and scroll it into view; in
  0.0.1 a search only seemed to move the Document Tree. As in the original, the dialogs stay
  open beside the text: they move by their title, the document stays usable while they are
  open, and the next one opens where the last one was closed. A search starts from the
  selection and continues from the other end with a beep; Replace and Replace All stay
  undoable, also in large books; the Source view uses the same dialogs.
- Non-breaking spaces look like ordinary spaces by default, as in the original; 0.0.1 marked
  each one with a degree sign drawn over the next word. The markers to choose are the
  original's (□ ▫ ◦), drawn in place in paragraphs, verses, epigraphs, titles, the annotation,
  the history and the Source view, and they copy, paste and search as the character does. A
  degree sign stored by 0.0.1 reads as the plain space.
- Scripts: the bundled clean-up scripts run in seconds again. General clean-up takes about a
  second on a typical 1 MB book instead of about 8 seconds, and about five seconds on a 10 MB
  book. Each change a script made used to go through the editor and the whole book one at a
  time; a run now works on its own copy of the book, which replaces the book once at the end.
  While a script runs, the status bar shows its progress and a Cancel button, which also works
  while the script is asking a question. The book cannot be edited until the run ends. Cancel
  and script errors leave the book exactly as it was, and one Undo takes back the whole run
  however many changes it made (in 0.0.1 a large run could not be undone completely).
- File dialogs offer book files again. File > Open lists only FictionBook books, with
  "FictionBook files (*.fb2)" selected and "FictionBook descriptors (*.fbd)" and "All files
  (*.*)" one click away. Save As and the image, cover, binary object, "Save image as" and
  custom dictionary dialogs offer the original editor's file types too, named in the interface
  language, and `BOOK.FB2` counts as a book. Save As opens on the book's own file - a new book
  in the folder last used, or in Documents - with the encoding choice inside the dialog again
  and the book's encoding selected; the dictionary dialog proposes the current dictionary.
  While a file dialog is open the editor takes no input, as behind any dialog. The dialogs
  0.0.1 took from its browser engine dropped named file types and listed every file; the
  editor now shows the operating system's own dialogs (Windows, GTK on Linux, macOS).
- A file dialog left open for more than 30 seconds no longer makes opening or saving fail.
  The interface gave up waiting for the dialog's answer after 30 seconds; it now waits until
  the dialog is closed.
- No right-click offers web-page options (save image, open in a new tab, reload, inspect and
  the like). Each place shows the original's menu for it - the Body menu in the Body view and
  in the Description fields, the source editor's edit menu in the Source view, the edit menu
  of a text box in text boxes - or nothing; toolbar icons can no longer be dragged or selected
  as pictures.
- Paste from the menus works in the desktop editor: Edit > Paste, its toolbar button and the
  right-click menus waited for a browser permission that was never given, so in 0.0.1 Edit >
  Paste in the Body view did nothing. As in the original, Edit > Cut, Copy and Paste and their
  toolbar buttons also act on the Source view and on the Description view's fields; 0.0.1
  kept them disabled there.

## 0.0.1 - first public build

A complete re-implementation of the classic FictionBook Editor for Windows 10/11,
Linux (Ubuntu 22.04+, X11 and Wayland) and macOS (best effort), with the same
three views (Description, Body, Source), Document Tree, menus, dialogs,
hotkeys, spell checking (English and Russian), the Words tool and user scripts.

### Added since the first build

- Settings > View > Theme: *System* (follows the operating system), *Light* or *Dark*;
  the whole interface, the Body view and the Source editor switch immediately.
- Files that are not FictionBook documents (plain text, other XML, binary files) are
  refused with a message instead of being loaded; malformed FictionBook files still open in
  the Source view for repair. The Open dialog proposes `*.fb2` first, then `*.fbd`, then
  all files.
- Windows: the executable carries the editor's icon and version information (Start menu,
  search, taskbar, Open with); the installer installs into Program Files for all users.
- Windows: a portable ZIP next to the installer: unzip it anywhere and start `bin\mfbe.exe`;
  no installation or administrator rights needed.

### Fixed since the first build

- Linux: the editor no longer stops at start-up with "munmap_chunk(): invalid pointer" on
  desktops whose GTK theme uses PNG images (Linux Mint's Mint-Y themes, for example); the
  `.deb`, `.rpm` and AppImage were all affected.
- Linux: the editor looks for its libraries only in its own folder, never in the folder it is
  started from.
- Windows: the editor no longer needs the Microsoft Visual C++ Redistributable; on PCs without
  it, it could not start ("VCRUNTIME140.dll was not found").

### Behaviour that differs from the original editor

- Files are written as FictionBook 2.1 in UTF-8 by default (or the encoding
  chosen when saving); description elements are normalised to the 2.1 order.
- Images are stored as JPEG or PNG only: other formats are converted when the
  book is saved (JPEG quality and PNG-for-transparency rules are settings).
- Unknown elements and attributes are preserved and shown as read-only
  "unknown element" blocks in the Body view; they can be edited in Source.
- Scripts run in a sandbox with a documented `mfbe` API (ES2023 modules);
  they cannot reach the file system, the network, the clipboard or the editor
  window. Bundled scripts are read-only; user scripts live in the user folder
  and are purely additive.
- The genre list is extensible through `*.genres.tsv` files in the user
  folders; the standard list is always present and never changed.
- No autosave/crash recovery, no `.fb2.zip` support, no update checker, no CHM
  help, no keyboard-layout switching, no plugin (COM) interface and no
  Explorer shell extension in this release.

### Legacy scripts

147 scripts of the original distribution were ported (142 packages); five were
dropped because they need capabilities the sandbox does not grant (clipboard,
file system, IE-specific redraw, a drag-and-drop tree editor superseded by the
Document Tree, and a reading mode that belongs to the viewer). The details per
script are in `docs/scripting/conversion-notes.md`.

### Known limitations

- Linux: on systems that restrict unprivileged user namespaces (Ubuntu 24.04+),
  the AppImage runs without the Chromium sandbox and says so in the error log;
  the `.deb`/`.rpm` packages ship an AppArmor profile and the SUID helper
  instead.
- macOS packages are unsigned: see `docs/installing.md` for the one-time
  "Open Anyway" step.
- Windows and macOS packages are built by CI only; the Linux build is the one
  exercised end to end on the development host.

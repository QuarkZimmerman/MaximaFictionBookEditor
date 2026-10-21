# Changelog

All notable changes to Maxima Fiction Book Editor. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

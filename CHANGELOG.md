# Changelog

All notable changes to Maxima Fiction Book Editor. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

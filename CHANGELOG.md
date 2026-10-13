# Changelog

All notable changes to Maxima Fiction Book Editor. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

### Fixed since the first build

- Linux: the editor no longer stops at start-up with "munmap_chunk(): invalid pointer" on
  desktops whose GTK theme uses PNG images (Linux Mint's Mint-Y themes, for example); the
  `.deb`, `.rpm` and AppImage were all affected.
- Linux: the editor looks for its libraries only in its own folder, never in the folder it is
  started from.

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

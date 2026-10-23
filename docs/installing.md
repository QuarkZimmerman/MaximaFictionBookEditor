# Installing Maxima Fiction Book Editor

Release packages are attached to every release on the GitHub Releases page of the
repository (https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases), each with a
`.sha256` checksum file:

| Platform | File | Notes |
|----------|------|-------|
| Windows 10 / 11 (64-bit) | `MaximaFictionBookEditor-<version>-win64.msi` | installer; registers `.fb2` / `.fbd` |
| Windows 10 / 11 (64-bit) | `MaximaFictionBookEditor-<version>-win64-portable.zip` | portable: unzip and run, no installation |
| Linux (any distribution, x86_64) | `MaximaFictionBookEditor-<version>-x86_64.AppImage` | single file, no installation |
| Debian / Ubuntu family | `mfbe_<version>_amd64.deb` | package with menu entry and file associations |
| Fedora / openSUSE family | `mfbe-<version>-1.x86_64.rpm` | package with menu entry and file associations |
| macOS 13+ | `MaximaFictionBookEditor-<version>-macos-arm64.dmg` (Apple Silicon), `...-macos-x86_64.dmg` (Intel) | application bundle in a disk image |

The editor works fully offline and sends nothing anywhere on its own. Exactly two things use
the network, both on your action. The first is the check for a new version: when you choose
Help > Check for new version, the editor asks GitHub
(`api.github.com/repos/QuarkZimmerman/MaximaFictionBookEditor/releases/latest`) for the latest
release and, if it is newer, offers to open its page in your web browser; the request carries
nothing about you or your books. Nothing is downloaded or installed. The editor can also make
this same single request by itself when it starts, as often as Settings > Other > Version check
says - once a month unless you change it, or at every start, once a day or once a week; it then
speaks up only when a newer version exists, and "never" switches the automatic check off (the
manual command keeps working). The second is the AI assistant (release 0.0.5): when you have
turned it on and send it an instruction, or press *Test connection* or *Fetch models* on its
settings page, the editor sends your instruction and the parts of the book the assistant reads
to the AI service you chose in *Settings > AI assistant* - for a hosted service only after you
agreed on a notice that names it; a model server on your own computer stays on your computer.
The assistant is off at every start, and *Disabled* on that page removes it from the editor
altogether. Behind a proxy, set the usual environment variables (`https_proxy`, `http_proxy`,
`no_proxy`); on Linux a company root certificate is given with `SSL_CERT_FILE` (see
`docs/releases/0.0.5.md`, "Known limitations"). All packages are built by the project's CI from
the repository sources (`docs/building.md` explains how to build them yourself).

## Supported platforms

- **Windows 10 and Windows 11**, 64-bit (x64). Windows 7, 8/8.1 and 32-bit Windows are not
  supported.
- **Linux**, x86_64: Ubuntu 22.04 LTS and newer (and derivatives such as Linux Mint,
  Pop!_OS, elementary OS), Debian 12 and newer, Fedora 39 and newer, openSUSE Leap 15.6 /
  Tumbleweed, and other distributions of the same era with a GTK 3 desktop, under X11 and
  Wayland sessions.
- **macOS 13 (Ventura) and newer**, Apple Silicon and Intel - best effort: the bundles are
  built and smoke-tested by CI only.

The feature set is identical on every platform. The interface is available in English, Russian
and Ukrainian: the first start follows the system language (English otherwise) and *Settings >
View* changes it; the editor then offers to restart itself, with the open book and the same
window, so that the new language applies at once. Spell checking comes with dictionaries for
the same three languages; others are added as described under
[Spelling dictionaries](#spelling-dictionaries).

## Windows

### Install

1. Download `MaximaFictionBookEditor-<version>-win64.msi` and double-click it.
2. Confirm the administrator prompt, accept the licence (GNU GPL version 3) and the folder,
   leave **Create a shortcut on the desktop** ticked or untick it, click **Install**.

The editor is installed for all users of the computer into
`C:\Program Files\Maxima Fiction Book Editor` (the folder can be changed in the installer).
Unattended installation from an elevated terminal:

```powershell
msiexec /i MaximaFictionBookEditor-<version>-win64.msi /qn                          # desktop shortcut created
msiexec /i MaximaFictionBookEditor-<version>-win64.msi /qn INSTALLDESKTOPSHORTCUT=0 # no desktop shortcut
```

The installer creates a Start menu entry and, unless declined, a shortcut named *Maxima
Fiction Book Editor* with the editor's icon on the desktop of all users; it registers the
`.fb2` and `.fbd` extensions with the editor's icon and the **Open** and **Edit** verbs
(double-click opens the book; the editor is also listed under *Settings > Apps > Default
apps*). Installing a newer version over an older one upgrades it in place and keeps your
desktop-shortcut choice: an existing shortcut stays, none is added where you declined one -
unless you change the choice in the installer or give `INSTALLDESKTOPSHORTCUT=1` or `=0` on
the command line. Windows SmartScreen may show "Windows protected your PC" for an unsigned
installer: click *More info* > *Run anyway*.

### Uninstall

*Settings > Apps > Installed apps > Maxima Fiction Book Editor > Uninstall* (or
`msiexec /x MaximaFictionBookEditor-<version>-win64.msi`). This removes the program files,
the Start menu entry, the desktop shortcut and the `.fb2` / `.fbd` associations. Your
settings, dictionary and user folders (see [User folders](#user-folders)) are kept; delete
them by hand if you no longer want them.

### Portable version (no installation)

1. Download `MaximaFictionBookEditor-<version>-win64-portable.zip` and unzip it anywhere (a
   folder in your profile, a USB stick); no administrator rights are needed.
2. Start `bin\mfbe.exe` in the unzipped folder. The first time, Windows SmartScreen may show
   "Windows protected your PC": click *More info* > *Run anyway* (or tick *Unblock* in the
   ZIP file's *Properties* before unzipping).

The portable version has no Start menu entry and registers no file associations: open books
with *File > Open* or by dropping them on the window. It keeps everything it stores in the
`bin\user` folder of the unzipped folder - settings, recent files, logs, the browser cache, the
custom dictionary and your own template, genres, scripts and dictionaries - and nothing in your
user profile, so copying or moving the folder (to another computer, onto a USB stick) takes all
of it along. To remove the editor, delete the folder.

## Linux: AppImage

The AppImage runs on any recent distribution without installing anything else - it contains
the editor, the Chromium-based interface, dictionaries, schema, genre lists and
translations, and uses the desktop's own GTK 3 libraries.

```bash
chmod +x MaximaFictionBookEditor-<version>-x86_64.AppImage
./MaximaFictionBookEditor-<version>-x86_64.AppImage              # or double-click it in the file manager
./MaximaFictionBookEditor-<version>-x86_64.AppImage book.fb2     # open a book
```

Notes:

- Works under X11 and Wayland (native Wayland when the session offers it; force a backend
  with `--ozone-platform=x11` or `--ozone-platform=wayland`).
- The AppImage runtime is static: `libfuse2` is **not** required. On systems without FUSE at
  all (containers, some servers) run it with `--appimage-extract-and-run` as the first
  argument.
- **Sandbox.** Chromium's sandbox needs unprivileged user namespaces. The editor checks this
  at start-up and switches the sandbox off automatically - with a warning in the terminal and
  in the error log - only when they are unavailable, so no `--no-sandbox` option is needed.
  Ubuntu 23.10 and newer restrict user namespaces for applications that are not covered by
  an AppArmor profile, which applies to any AppImage; there the AppImage runs without the
  sandbox (the content it renders is your local files only). To keep the sandbox on Ubuntu
  24.04+, install the `.deb` instead: it ships an AppArmor profile and the SUID sandbox
  helper.
- **Desktop integration.** The image carries the desktop file, icon and MIME definition
  (`application/x-fictionbook+xml` for `.fb2` / `.fbd`); AppImageLauncher, `appimaged` or
  Gear Lever add the menu entry and file associations automatically. Without such a tool,
  copy `usr/share/applications/mfbe.desktop` out of the image
  (`./MaximaFictionBookEditor-<version>-x86_64.AppImage --appimage-extract usr/share/applications/mfbe.desktop`),
  set its `Exec=` line to the AppImage path, and put it into `~/.local/share/applications/`.
- **Updates.** The image embeds zsync update information; `AppImageUpdate` fetches only the
  changed blocks of a new release.
- **Portable mode.** Create a folder named `MaximaFictionBookEditor-<version>-x86_64.AppImage.home`
  next to the file: settings and user data then live in that folder's `user/` sub-folder
  instead of your home directory (see [User folders](#user-folders)).
- **Known limitation - the file type in the Save dialog.** The Save As and Export dialogs
  are the desktop's GTK file chooser, and it does not rename the extension of the proposed
  name when you switch the file type: Save As proposes `Last name First name - Book
  title.fb2` (or the current file's name); if you then pick "FictionBook descriptors
  (*.fbd)" and keep the name, the file is saved as `.fb2`. Change the extension in the name
  box yourself (`.fbd`). This applies to all three Linux packages.

### Uninstall

Delete the `.AppImage` file (and any desktop file you created). Your user folders are kept.

## Linux: Debian / Ubuntu package (.deb)

```bash
sudo apt install ./mfbe_<version>_amd64.deb
```

(On Ubuntu 22.04 `apt` reports "Download is performed unsandboxed as root" - this is a
harmless notice.) The package installs the editor under `/usr/lib/mfbe` with the launcher
`/usr/bin/mfbe`, the application menu entry, the icon and the MIME association so `.fb2` and
`.fbd` files open with the editor on double-click. Its post-install step makes Chromium's
SUID sandbox helper (`/usr/lib/mfbe/chrome-sandbox`) root-owned and, on Ubuntu 23.10+ /
24.04+, loads the AppArmor profile `/etc/apparmor.d/mfbe` that allows the editor to create
user namespaces, so the sandbox stays enabled.

Upgrade by installing the newer `.deb` the same way. Uninstall:

```bash
sudo apt remove mfbe        # keeps /etc/apparmor.d/mfbe (configuration)
sudo apt purge mfbe         # removes it too
```

## Linux: Fedora / openSUSE package (.rpm)

```bash
sudo dnf install ./mfbe-<version>-1.x86_64.rpm        # Fedora, RHEL-like
sudo zypper install ./mfbe-<version>-1.x86_64.rpm     # openSUSE
```

Same layout, menu entry and file associations as the `.deb`; the sandbox helper is installed
with the SUID bit set. Uninstall with `sudo dnf remove mfbe` or `sudo zypper remove mfbe`.

## macOS

### Install

1. Open `MaximaFictionBookEditor-<version>-macos-<arch>.dmg` (choose `arm64` for Apple
   Silicon, `x86_64` for Intel Macs) and drag **mfbe** into the **Applications** folder.
2. Eject the disk image.

### First launch ("Open Anyway")

The bundle is signed with an ad-hoc signature only, not notarised by Apple, so Gatekeeper
blocks the first launch:

- **macOS 15 (Sequoia) and newer:** double-click the app once (macOS reports that it could
  not verify the app and offers *Done* / *Move to Trash*: choose *Done*), then open
  *System Settings > Privacy & Security*, scroll to the *Security* section and click
  **Open Anyway** next to the message about "mfbe"; confirm with *Open Anyway* in the
  dialog that follows. This is needed once.
- **macOS 13 and 14:** right-click (Control-click) the app in Finder, choose **Open**, and
  click **Open** in the dialog. Alternatively use the same *Privacy & Security* > *Open
  Anyway* button as above after a blocked first attempt.
- From a terminal, the quarantine flag can be removed instead:
  `xattr -dr com.apple.quarantine /Applications/mfbe.app`.

The application declares the `.fb2` / `.fbd` document types, so books can be opened with
*Open With* from Finder or by dropping them on the Dock icon; use *Get Info > Open with >
Change All...* to make it the default.

### Uninstall

Drag `/Applications/mfbe.app` to the Trash. Your user folders are kept.

## User folders

An installed editor keeps its settings and user data outside the installation so that they
survive upgrades and never need administrator rights; a portable copy keeps all of them in its
own folder instead (see *Portable folder* below):

| Purpose | Windows | Linux | macOS |
|---------|---------|-------|-------|
| Configuration: `settings.json`, `hotkeys.json`, `recent.json`, `positions.json` (the places "Restore position" remembers, the 100 most recently remembered files), `exclusions.txt` | `%APPDATA%\Maxima Fiction Book Editor\` (roaming profile) | `$XDG_CONFIG_HOME/maxfbeditor/` (default `~/.config/maxfbeditor/`) | `~/Library/Application Support/Maxima Fiction Book Editor/` |
| User content: custom dictionary `custom.dic`, your own template of new documents `blank.fb2`, user folders `genres/`, `scripts/` (the scripts the AI assistant writes for you under `scripts/90_assistant/`), `dictionaries/`, your copy of the AI service list `ai-services.json` (created by *Settings > AI assistant > Edit list*; adds, replaces or hides entries of the bundled list) | `%APPDATA%\Maxima Fiction Book Editor\` (roaming profile) | `$XDG_DATA_HOME/maxfbeditor/` (default `~/.local/share/maxfbeditor/`) | same as configuration |
| Machine-local state: errors-only log `logs/mfbe-errors.log` (5 x 1 MB, rotating), browser cache | `%LOCALAPPDATA%\Maxima Fiction Book Editor\` | `$XDG_STATE_HOME/maxfbeditor/` (default `~/.local/state/maxfbeditor/`) and `$XDG_DATA_HOME/maxfbeditor/cef/` | `~/Library/Logs/Maxima Fiction Book Editor/`, `~/Library/Application Support/Maxima Fiction Book Editor/cef/` |

On Windows this follows the platform guidelines: the installation under `C:\Program Files` is
never written to, roaming data holds what belongs to the user, local data holds what belongs
to the machine.

User-extensible resources are looked up in layers, additively: a folder chosen in *Settings*,
then the per-user data folder above, then a **portable** folder, then the files bundled with
the editor. Bundled genres, scripts and dictionaries are never hidden or replaced; your files
only add to them. *Settings > Other > Open genres folder / Open scripts folder*, *Settings >
View > Open dictionaries folder* (see *Spelling dictionaries* below) and the About dialog's
*Open log folder* open the right place in the file manager.

Genre files are `*.genres.tsv` text files in the `genres` folder (UTF-8, tab-separated:
`code`, `category`, `name_en`, `name_ru`); the picker shows which file a genre comes from.
Under the Ukrainian interface a genre of your own shows the bundled Ukrainian name of its code
when there is one, else its English name.

New documents start from `blank.fb2`, the original editor's blank document. A `blank.fb2` of
your own - in the template folder chosen in *Settings > Other*, the per-user data folder or the
portable folder, looked up in that order - is used instead, as written; one that cannot be
used is named and the bundled template used. *Settings > Other* shows the template in effect
and *Open template folder* opens its folder.

**Portable folder** (no installation, data next to the program):

- Windows / Linux unpacked: a `user` folder next to the executable
  (`<folder of mfbe.exe>\user`, `<install prefix>/lib/mfbe/user`),
- AppImage: `<name>.AppImage.home/user` or `<name>.AppImage.d/user` (or `<name>.AppImage.d`)
  next to the image,
- macOS: a `user` folder next to `mfbe.app`.

When the editor can write to that folder, it keeps all of its data there - everything the
table above lists, the AI assistant's settings (the chosen service, your own service's address,
key and model, the agreements) and your `ai-services.json` included - and nothing in your
profile, so a copy moved to another folder or computer takes the assistant's configuration
along; the Windows portable ZIP comes with it. A portable folder the editor cannot write to
(one an administrator put next to an installed copy, or a read-only medium) only adds genres,
scripts, dictionaries, a template and an `ai-services.json` of its own (in effect while your
data folder has none), and the per-user folders of the table are used.

## Spelling dictionaries

The editor checks spelling with Hunspell and comes with three dictionaries: English
(`en_US`), Russian (`ru_RU`) and Ukrainian (`uk_UA`, the dict_uk dictionary, Mozilla Public
License 1.1 - its notice is shown in Help > About). A book is checked with the dictionary of its
language (`<lang>` in the description): the exact tag first (`de_AT`), then the language
(`de-AT` and `de` both use a `de_DE` dictionary).

Any other language is a folder copy away - no reinstallation, no administrator rights:

1. Get a Hunspell dictionary for the language: a pair of files `<tag>.aff` and `<tag>.dic`
   with the same name, the tag being the language code, optionally with a region
   (`de_DE`, `pl_PL`, `be_BY`). These are the dictionaries LibreOffice, OpenOffice and Firefox
   use; the LibreOffice dictionary repository (https://github.com/LibreOffice/dictionaries) and
   the dictionary extensions of LibreOffice (`.oxt` files are ZIP archives containing the pair)
   cover most languages. Keep the licence notice that comes with the dictionary; a `<tag>.txt`
   next to the pair is shown in Help > About.
2. Open *Settings > View* and press **Open dictionaries folder** in the Spellcheck group. The
   folder opens in the file manager (it is created if it does not exist yet):
   - installed editor: the `dictionaries` folder of the per-user data folder of the table
     above (`%APPDATA%\Maxima Fiction Book Editor\dictionaries` on Windows,
     `~/.local/share/maxfbeditor/dictionaries` on Linux,
     `~/Library/Application Support/Maxima Fiction Book Editor/dictionaries` on macOS);
   - portable copy: the `dictionaries` subfolder of its `user` folder - the dictionaries
     travel with the copy.
   You can also choose a folder of your own ("Chosen folder" and `...`), as for scripts,
   genres and the template; it is searched before the per-user and the portable folder.
3. Copy the `.aff` and `.dic` files into that folder and press **Apply** (or restart the
   editor). The list *Dictionaries in effect* in the same group shows every dictionary with
   its origin - built in, chosen folder, user folder, portable folder - and the files the
   editor could not use with the reason: a `.aff` or `.dic` without its partner, a file that
   cannot be read, a dictionary whose `SET` encoding the editor cannot convert (supported:
   UTF-8, UTF-16, Windows-1251/1252, ISO-8859-1/2/5/15, KOI8-R; most LibreOffice dictionaries
   are UTF-8 or ISO-8859), or a pair whose tag a dictionary of a higher layer already has. A
   chosen folder that does not exist or cannot be read is reported there too, and the default
   folder is used.

User dictionaries add to the built-in ones and never replace them: a `ru_RU` pair in your
folder is ignored (and listed as shadowed), the built-in Russian dictionary stays in effect.
Books in the new language are then checked like any other - misspelt words are underlined,
suggestions are offered, words can be added to your custom dictionary (`custom.dic`), and
Tools > Spell check uses it.

## Importing and exporting a description

*File > Import > Description from FictionBook file...* takes the description of another
FictionBook file - a `.fbd` description file, such as the ones the Maxima Library and the
Maxima FBD Maker produce, or a complete `.fb2` book - into the open document; the file is read
as Open reads a book (any encoding Open accepts, FB2 2.0 or 2.1, with or without a body; a file
that is not well-formed or not a FictionBook document is refused with a message and nothing
changes). Into a freshly created document whose description you have not touched, everything
the file has is imported at once and the status bar says how many entries arrived. In every
other case a dialog lists the entries about to be imported - genres, authors, book title,
annotation, keywords, date, cover, language, source language, translators, sequences, the
other persons' roles, the source title info, the document, publish and custom info entries -
each with an unticked checkbox and its value, the cover shown as a small picture; tick what
you want, and *Import* (disabled while nothing is ticked) replaces exactly those entries,
every ticked list as a whole. The import is one undo step; the book's text, images and the
entries you did not tick are untouched. The dialog opens in the folder Open and Save As last
used.

*File > Export > Export as FBD...* writes the description of the open document, as it is in
the editor at that moment, saved or not, as a stand-alone `.fbd` file: the whole description
with the cover and the other images it refers to, and one empty section in place of the
book's text, so that the file passes FB2 2.1 validation. The file is always UTF-8 (no encoding
choice), it is written only after validation - an incomplete description gets Save's own
"export anyway?" question - and never over the open document's own file. The name proposed is
the document's own with `.fbd`, or the proposed name of a never-saved document. The open
document, its file and its Recent Files entry stay as they were; the exported file is not
opened.

## Keyboard layout

If your system starts with one keyboard layout and your books are written in another, the
editor can switch its own window to the layout you choose every time a document is opened -
at start, with File > New, Open, Recent Files, a double-click or a file dropped on the window,
the restart after a language change, the reload of a book that changed on disk. Open *Settings
> Other*, tick **Switch keyboard layout when a document is opened** in the *Open File* group
and pick the layout from the list; the list holds the layouts installed in the system under the
names the system gives them and is read anew each time the dialog opens. The option is off by
default. Nothing is installed or changed in the system: the editor asks for one of the layouts
the system already offers, for its own window only; whether other windows follow is the
system's rule (on Windows, *Let me set a different input method for each app window*). A layout
you remove later is shown in Settings as "(not installed)" and ignored when a document opens;
pick another to replace it.

- **Windows**: works as described; the layout is active in the editor's window from the moment
  the document is shown (the layout indicator in the taskbar changes while the editor is
  focused).
- **Linux, X11 session**: the session's layout groups are switched - what Alt+Shift (or the
  switch you configured) does - so the whole session follows, as it does for any layout switch
  under X11. The list is the groups of the session's keyboard configuration (`setxkbmap -query`
  shows them).
- **Linux, Wayland session**: the system offers an application no way to switch the layout, so
  the option is shown greyed out with the note *The system offers no way to switch the layout*,
  also when the editor's window is served through XWayland; the rest of the editor is
  unaffected. Switching through the desktop's own input-source setting (GNOME, KDE) is a
  possible later addition.
- **macOS**: best effort - the editor selects the input source where the system allows; with
  *Automatically switch to a document's input source* or for a window that is not active the
  system may keep its own choice.

## Command line

```text
mfbe [FILE...] [--lang en|ru|uk] [--new] [--remote-debugging-port N] [--no-sandbox]
     [--ozone-platform x11|wayland] [--wait-for-exit PID] [--window-geometry X,Y,W,H[,max]]
     [--version] [--help]
```

`FILE` is the `.fb2` / `.fbd` / `.xml` document to open (this is how the operating system's
file associations start the editor). When an instance is already running, a second start
hands the file to it and brings its window to the front instead of opening a second copy.
`--lang` overrides the interface language for this one run only. `--wait-for-exit` and
`--window-geometry` are the options the editor gives itself when it restarts after a settings
change (the new copy waits for the old one to end, then opens at the same window placement);
you will not normally need them. Unknown options print
`Invalid command line option: '<option>'` and exit with code 2.
On Windows the `mfbe.exe` executable is in the `bin` folder of the installation directory (or
of the unzipped portable folder).

## Getting help

- Build from source: `docs/building.md`.
- Problems: open an issue in the repository; attach the errors-only log from the folder listed
  above (it never contains book text) and the output of `mfbe --version`.

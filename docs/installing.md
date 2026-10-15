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

The editor works offline and sends nothing anywhere on its own. The one exception is Help >
Check for new version: when you choose it, the editor asks GitHub
(`api.github.com/repos/QuarkZimmerman/MaximaFictionBookEditor/releases/latest`) for the latest
release and, if it is newer, offers to open its page in your web browser; the request carries
nothing about you or your books. Nothing is downloaded or installed. All packages are built by
the project's CI from the repository sources (`docs/building.md` explains how to build them
yourself).

## Supported platforms

- **Windows 10 and Windows 11**, 64-bit (x64). Windows 7, 8/8.1 and 32-bit Windows are not
  supported.
- **Linux**, x86_64: Ubuntu 22.04 LTS and newer (and derivatives such as Linux Mint,
  Pop!_OS, elementary OS), Debian 12 and newer, Fedora 39 and newer, openSUSE Leap 15.6 /
  Tumbleweed, and other distributions of the same era with a GTK 3 desktop, under X11 and
  Wayland sessions.
- **macOS 13 (Ventura) and newer**, Apple Silicon and Intel - best effort: the bundles are
  built and smoke-tested by CI only.

The feature set is identical on every platform.

## Windows

### Install

1. Download `MaximaFictionBookEditor-<version>-win64.msi` and double-click it.
2. Confirm the administrator prompt, accept the licence (GNU GPL version 3) and the folder, click
   **Install**.

The editor is installed for all users of the computer into
`C:\Program Files\Maxima Fiction Book Editor` (the folder can be changed in the installer).
Unattended installation from an elevated terminal:

```powershell
msiexec /i MaximaFictionBookEditor-<version>-win64.msi /qn
```

The installer creates a Start menu entry, registers the `.fb2` and `.fbd` extensions with the
editor's icon and the **Open** and **Edit** verbs (double-click opens the book; the editor is
also listed under *Settings > Apps > Default apps*), and installing a newer version over an
older one upgrades it in place. Windows SmartScreen may show "Windows protected your PC"
for an unsigned installer: click *More info* > *Run anyway*.

### Uninstall

*Settings > Apps > Installed apps > Maxima Fiction Book Editor > Uninstall* (or
`msiexec /x MaximaFictionBookEditor-<version>-win64.msi`). This removes the program files,
the Start menu entry and the `.fb2` / `.fbd` associations. Your settings, dictionary and
user folders (see [User folders](#user-folders)) are kept; delete them by hand if you no
longer want them.

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
| Configuration: `settings.json`, `hotkeys.json`, `recent.json`, `exclusions.txt` | `%APPDATA%\Maxima Fiction Book Editor\` (roaming profile) | `$XDG_CONFIG_HOME/maxfbeditor/` (default `~/.config/maxfbeditor/`) | `~/Library/Application Support/Maxima Fiction Book Editor/` |
| User content: custom dictionary `custom.dic`, your own template of new documents `blank.fb2`, user folders `genres/`, `scripts/`, `dictionaries/` | `%APPDATA%\Maxima Fiction Book Editor\` (roaming profile) | `$XDG_DATA_HOME/maxfbeditor/` (default `~/.local/share/maxfbeditor/`) | same as configuration |
| Machine-local state: errors-only log `logs/mfbe-errors.log` (5 x 1 MB, rotating), browser cache | `%LOCALAPPDATA%\Maxima Fiction Book Editor\` | `$XDG_STATE_HOME/maxfbeditor/` (default `~/.local/state/maxfbeditor/`) and `$XDG_DATA_HOME/maxfbeditor/cef/` | `~/Library/Logs/Maxima Fiction Book Editor/`, `~/Library/Application Support/Maxima Fiction Book Editor/cef/` |

On Windows this follows the platform guidelines: the installation under `C:\Program Files` is
never written to, roaming data holds what belongs to the user, local data holds what belongs
to the machine.

User-extensible resources are looked up in layers, additively: a folder chosen in *Settings*,
then the per-user data folder above, then a **portable** folder, then the files bundled with
the editor. Bundled genres, scripts and dictionaries are never hidden or replaced; your files
only add to them. *Settings > Other > Open genres folder / Open scripts folder* and the About
dialog's *Open log folder* open the right place in the file manager.

Genre files are `*.genres.tsv` text files in the `genres` folder (UTF-8, tab-separated:
`code`, `category`, `name_en`, `name_ru`); the picker shows which file a genre comes from.

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
table above lists - and nothing in your profile; the Windows portable ZIP comes with it. A
portable folder the editor cannot write to (one an administrator put next to an installed copy,
or a read-only medium) only adds genres, scripts, dictionaries and a template, and the per-user
folders of the table are used.

## Command line

```text
mfbe [FILE...] [--lang en|ru] [--new] [--remote-debugging-port N] [--no-sandbox]
     [--ozone-platform x11|wayland] [--version] [--help]
```

`FILE` is the `.fb2` / `.fbd` / `.xml` document to open (this is how the operating system's
file associations start the editor). When an instance is already running, a second start
hands the file to it and brings its window to the front instead of opening a second copy.
Unknown options print `Invalid command line option: '<option>'` and exit with code 2.
On Windows the `mfbe.exe` executable is in the `bin` folder of the installation directory (or
of the unzipped portable folder).

## Getting help

- Build from source: `docs/building.md`.
- Problems: open an issue in the repository; attach the errors-only log from the folder listed
  above (it never contains book text) and the output of `mfbe --version`.

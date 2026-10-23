# Maxima Fiction Book Editor

A cross-platform editor for FictionBook 2 (FB2) e-books — a modern
re-implementation of the classic FictionBook Editor (FBE) with the same views,
menus and dialogs: **Description** (metadata form), **Body** (structured
text editor), **Source** (XML, with FB2 tag completion), Document Tree, spell checking
(English, Russian and Ukrainian built in, more languages from a folder), the Words tool, user
scripts, and an optional AI assistant that changes the book on request (release 0.0.5).

- Platforms: Windows 10/11 (x64), Linux from Ubuntu 22.04 (X11 and Wayland),
  macOS (best effort).
- Writes FB2 schema 2.1, reads 2.0-era files; UTF-8 by default; images stored
  as JPEG/PNG only.
- Interface languages: English, Russian, Ukrainian (the first start follows the system
  language).
- Licence: GNU General Public License version 3 (GPL-3.0-only, see `LICENSE`), the licence of
  the original FictionBook Editor, whose material this editor includes.

> Status: under active development. Release packages are produced by the release workflow
> for every tag (see below); until the first release, build from source.

## Install

Packages for every platform are attached to each release on the
[Releases page](https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases):

| Platform | Package | Install | Uninstall |
|----------|---------|---------|-----------|
| Windows 10/11 x64 | `MaximaFictionBookEditor-<version>-win64.msi` | double-click (administrator prompt); installs into `C:\Program Files\Maxima Fiction Book Editor` for all users, registers `.fb2`/`.fbd` and offers a desktop shortcut (ticked by default, remembered at upgrades); unattended: `msiexec /i <msi> /qn` (`INSTALLDESKTOPSHORTCUT=0` for no shortcut) | *Settings > Apps* or `msiexec /x <msi>` - associations and the shortcut are removed |
| Windows 10/11 x64, portable | `MaximaFictionBookEditor-<version>-win64-portable.zip` | unzip anywhere (no installation, no administrator rights) and start `bin\mfbe.exe`; no Start menu entry or file associations; keeps everything it stores in its `bin\user` folder | delete the folder |
| Linux, any distribution | `MaximaFictionBookEditor-<version>-x86_64.AppImage` | `chmod +x` and run (X11 and Wayland, no extra packages, no FUSE needed) | delete the file |
| Debian / Ubuntu 22.04+ | `mfbe_<version>_amd64.deb` | `sudo apt install ./mfbe_<version>_amd64.deb` (menu entry, file associations, sandbox helper, AppArmor profile) | `sudo apt remove mfbe` (`purge` also drops the profile) |
| Fedora 39+ / openSUSE | `mfbe-<version>-1.x86_64.rpm` | `sudo dnf install ./mfbe-<version>-1.x86_64.rpm` or `sudo zypper install ./...` | `sudo dnf remove mfbe` / `sudo zypper remove mfbe` |
| macOS 13+ | `MaximaFictionBookEditor-<version>-macos-<arch>.dmg` | drag `mfbe.app` to Applications; first launch: *Privacy & Security > Open Anyway* (ad-hoc signed, not notarised) | move `mfbe.app` to the Trash |

Step-by-step instructions, the first-launch notes for macOS and Windows SmartScreen, the
Linux sandbox notes and the location of the per-user folders (settings, genres, scripts,
dictionaries, log) are in [`docs/installing.md`](docs/installing.md). Settings and user data
live outside the installation and survive upgrades and uninstalls. Spelling dictionaries for
other languages are a folder copy away: put a Hunspell `.aff`/`.dic` pair (the dictionaries
LibreOffice and Firefox use) into the dictionaries folder that *Settings > View > Open
dictionaries folder* opens, or choose a folder of your own, and apply the settings
([`docs/installing.md`, "Spelling dictionaries"](docs/installing.md#spelling-dictionaries)).

Open a book from the command line with `mfbe book.fb2`; a running instance receives the file
instead of a second window starting.

Release 0.0.5 adds an optional AI assistant: tell it in plain words what to change in the open
book - in the Body view or in the Source view - and it makes the change, which is checked
against the FB2 2.1 schema before it reaches the document. Two free services that need no
account and no key are bundled (OVHcloud AI Endpoints first), and your own service and key or
a model server on your own computer work as well; *View > AI Assistant* turns it on and opens
the panel, *Ask AI...* in the context menu takes one instruction for the selection, every
request is one undo step, and *Disabled* in Settings removes the assistant from the editor
altogether. Release 0.0.4 (the third feedback batch) brought back the annotation and history
blocks and the Document Tree divider and added the other person roles, the description import
and FBD export, the proposed file name, the caret carried between Body and Source, "Restore
position" and the keyboard-layout switch on open — see [`CHANGELOG.md`](CHANGELOG.md),
[`docs/releases/0.0.5.md`](docs/releases/0.0.5.md) and
[`docs/releases/0.0.4.md`](docs/releases/0.0.4.md).

## Supported platforms

- Windows 10 and Windows 11, 64-bit.
- Linux x86_64 from Ubuntu 22.04 LTS onward (Debian 12+, Fedora 39+, openSUSE Leap 15.6+ and
  other distributions of the same era with a GTK 3 desktop), X11 and Wayland sessions.
- macOS 13 and newer (Apple Silicon and Intel), best effort: built and smoke-tested by CI.

The interface is available in English, Russian and Ukrainian (Settings > View; a change takes
effect after the restart the editor offers); the feature set is the same on every platform.
The editor works fully offline and sends no telemetry. Exactly two things ever use the
network, both only on your action, never on the editor's own initiative:

- **The check for a new version** - Help > Check for new version, and the same single request
  at start-up on the schedule chosen in Settings > Other > Version check (once a month by
  default; "never" switches it off): it asks GitHub for the latest release of the editor and
  sends nothing else (no identifiers, settings or usage data).
- **The AI assistant's requests** - to the AI service you chose in Settings > AI assistant (a
  free hosted service, your own service and key, or a model server on your own computer), only
  when you send an instruction with the assistant turned on or press *Test connection* or
  *Fetch models* on its settings page, and for a hosted service only after you agreed on a
  notice that names the service and says what leaves the computer (your instruction and the
  parts of the book the assistant reads - never images, never the whole book on its own,
  never identifiers or settings). The assistant is off at every start, and *Disabled* on the
  same page switches it off completely - no entry, no panel, no request, no code path of the
  feature. The requests honour the proxy of the environment variables (`https_proxy`,
  `http_proxy`, `all_proxy`, `no_proxy`) and verify certificates through the system store on
  Windows and macOS and, on Linux, through `SSL_CERT_FILE` / `CURL_CA_BUNDLE`, the
  distribution's bundle or the Mozilla bundle the Linux packages ship
  (`docs/releases/0.0.5.md`, "Known limitations").

## Build from source

See [`docs/building.md`](docs/building.md) for toolchain installation and the build, test
and packaging steps on Windows, Linux and macOS; the guide is replayed by CI on clean
machines so it cannot go stale. Short version (Linux):

```bash
export VCPKG_ROOT=/path/to/vcpkg          # see docs/building.md
cmake --preset linux-core-debug           # core + tests (no Chromium download)
cmake --build --preset linux-core-debug
ctest --preset linux-core-debug
cmake --preset linux-app-release          # full application and packages
cmake --build --preset linux-app-release
cpack --preset linux-app-release          # AppImage, .deb, .rpm in build/linux-app-release/packages
```

## Repository layout

| Folder | Content |
|--------|---------|
| `core/` | C++20 core: FB2 model, XML, validation, images, spell checking, settings, local JSON-RPC server (`mfbe-core`) |
| `app/` | Desktop shell embedding the UI (Chromium Embedded Framework) |
| `ui/` | TypeScript/React user interface |
| `scripts/` | Bundled user scripts (installed with the editor) |
| `resources/` | FB2 schema, genre lists, dictionaries, symbols, templates, the bundled AI service list, the CA bundle of the Linux packages |
| `packaging/` | Installer and package definitions |
| `tests/` | Core tests, fixtures, corpus tooling, benchmarks |
| `tools/` | Developer tooling (never shipped) |
| `docs/` | [Building](docs/building.md), [installing](docs/installing.md) and [scripting](docs/scripting/en.md) guides, the [architecture and security review](docs/architecture.md), performance and diagnostics notes, release notes (`docs/releases/`) |

## Licence

Copyright © 2026 Quark Zimmerman.

Maxima Fiction Book Editor is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License version 3 as published by the Free Software
Foundation ([`LICENSE`](LICENSE); unofficial Russian and Ukrainian translations as shipped by
the original: [`gpl-3.0.ru.txt`](gpl-3.0.ru.txt), [`gpl-3.0.ua.txt`](gpl-3.0.ua.txt)). It is
distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

It is a modified re-implementation (2026) of FictionBook Editor 2.7 and includes the
original's material - its scripts, icons, genre and symbol lists and blank document - under
the original's licence, version 3 of the GNU GPL. The original's copyright notices and
contributor list are in [`CONTRIBUTORS.txt`](CONTRIBUTORS.txt) (also shown in Help > About),
and every bundled script keeps its author's notices.

Bundled third-party components (Chromium Embedded Framework, libxml2, libcurl with OpenSSL,
Hunspell and the spelling dictionaries, image libraries, the FictionBook schema, the MCP SDK,
...) keep their own licences, all of which allow distribution as part of a GPL-3.0 work; they
are listed in `THIRD-PARTY-NOTICES.md` (generated and checked by `tools/licence-check.py`), and
their full licence texts are installed under `share/doc/mfbe/licenses/`. Run-time data files
that the editor only reads and never combines into the program, such as spelling dictionaries,
are aggregates listed in their own section of `THIRD-PARTY-NOTICES.md` and ship with their own
notice next to the file (the Ukrainian dictionary of dict_uk, Mozilla Public License 1.1,
`resources/dictionaries/uk_UA.txt`; the Mozilla CA certificate bundle of the Linux packages,
Mozilla Public License 2.0, `resources/certs/cacert.NOTICE.txt`). The complete source of every
release is this repository at the release's tag; third-party sources are at the versions pinned
in `vcpkg.json`, `ui/package-lock.json` and `cmake/CefVersion.cmake`.

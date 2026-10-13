# Maxima Fiction Book Editor

A cross-platform editor for FictionBook 2 (FB2) e-books — a modern
re-implementation of the classic FictionBook Editor (FBE) with the same views,
menus and dialogs: **Description** (metadata form), **Body** (structured
text editor), **Source** (XML), Document Tree, spell checking (English and
Russian), the Words tool, and user scripts.

- Platforms: Windows 10/11 (x64), Linux from Ubuntu 22.04 (X11 and Wayland),
  macOS (best effort).
- Writes FB2 schema 2.1, reads 2.0-era files; UTF-8 by default; images stored
  as JPEG/PNG only.
- Interface languages: English, Russian.
- Licence: MIT (see `LICENSE`).

> Status: under active development. Release packages are produced by the release workflow
> for every tag (see below); until the first release, build from source.

## Install

Packages for every platform are attached to each release on the
[Releases page](https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases):

| Platform | Package | Install | Uninstall |
|----------|---------|---------|-----------|
| Windows 10/11 x64 | `MaximaFictionBookEditor-<version>-win64.msi` | double-click (administrator prompt); installs into `C:\Program Files\Maxima Fiction Book Editor` for all users and registers `.fb2`/`.fbd`; unattended: `msiexec /i <msi> /qn` | *Settings > Apps* or `msiexec /x <msi>` - associations are removed |
| Linux, any distribution | `MaximaFictionBookEditor-<version>-x86_64.AppImage` | `chmod +x` and run (X11 and Wayland, no extra packages, no FUSE needed) | delete the file |
| Debian / Ubuntu 22.04+ | `mfbe_<version>_amd64.deb` | `sudo apt install ./mfbe_<version>_amd64.deb` (menu entry, file associations, sandbox helper, AppArmor profile) | `sudo apt remove mfbe` (`purge` also drops the profile) |
| Fedora 39+ / openSUSE | `mfbe-<version>-1.x86_64.rpm` | `sudo dnf install ./mfbe-<version>-1.x86_64.rpm` or `sudo zypper install ./...` | `sudo dnf remove mfbe` / `sudo zypper remove mfbe` |
| macOS 13+ | `MaximaFictionBookEditor-<version>-macos-<arch>.dmg` | drag `mfbe.app` to Applications; first launch: *Privacy & Security > Open Anyway* (ad-hoc signed, not notarised) | move `mfbe.app` to the Trash |

Step-by-step instructions, the first-launch notes for macOS and Windows SmartScreen, the
Linux sandbox notes and the location of the per-user folders (settings, genres, scripts,
dictionaries, log) are in [`docs/installing.md`](docs/installing.md). Settings and user data
live outside the installation and survive upgrades and uninstalls.

Open a book from the command line with `mfbe book.fb2`; a running instance receives the file
instead of a second window starting.

## Supported platforms

- Windows 10 and Windows 11, 64-bit.
- Linux x86_64 from Ubuntu 22.04 LTS onward (Debian 12+, Fedora 39+, openSUSE Leap 15.6+ and
  other distributions of the same era with a GTK 3 desktop), X11 and Wayland sessions.
- macOS 13 and newer (Apple Silicon and Intel), best effort: built and smoke-tested by CI.

The interface is available in English and Russian; the feature set is the same on every
platform. The editor works offline and sends no telemetry.

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
| `resources/` | FB2 schema, genre lists, dictionaries, symbols, templates |
| `packaging/` | Installer and package definitions |
| `tests/` | Core tests, fixtures, corpus tooling, benchmarks |
| `tools/` | Developer tooling (never shipped) |
| `docs/` | [Building](docs/building.md), [installing](docs/installing.md) and [scripting](docs/scripting/en.md) guides, the [architecture and security review](docs/architecture.md), performance and diagnostics notes |

## Licence

MIT - see [`LICENSE`](LICENSE). Bundled third-party components (Chromium Embedded Framework,
libxml2, Hunspell and the spelling dictionaries, image libraries, the FictionBook schema and
genre lists, ...) keep their own permissive licences, which ship with the data files and in
`THIRD-PARTY-NOTICES.md` (generated and checked by `tools/licence-check.py`); the full licence
texts are installed under `share/doc/mfbe/licenses/`.

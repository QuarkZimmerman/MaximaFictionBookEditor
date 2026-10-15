# Building Maxima Fiction Book Editor from source

This guide takes a plain source download to a working editor and its packages on Windows,
Linux and macOS. It is replayed by CI (`.github/workflows/docs-build.yml`, weekly and on
every change to this file) on clean `windows-2025`, `ubuntu-22.04` and `macos-15` runners:
`tools/extract-doc-commands.py <os>` collects every command block tagged
`<!-- replay:<os> -->` (or `<!-- replay:all -->`) in document order into one script and runs
it, so the tagged blocks must work exactly as written. If a step does not work for you,
please open an issue.

Supported build hosts: Windows 10/11 x64; Ubuntu 22.04 LTS or newer and other Linux
distributions of the same era (Debian 12/13, Fedora 39+); macOS 13 or newer. The build needs
about 10 GB of disk (vcpkg compiles the native dependencies once; the CEF download is
~300 MB and extracts to ~1.5 GB) and 8 GB of RAM.

What gets built:

| Part | Result |
|------|--------|
| core (`core/`) | static library `mfbe_core` and the headless executable `mfbe-core` |
| UI (`ui/`) | the web interface bundle `ui/dist` |
| shell (`app/`) | the desktop application `mfbe` embedding Chromium (CEF) and the core |
| packages (`packaging/`) | Linux AppImage, `.deb`, `.rpm`; Windows MSI and portable ZIP; macOS `.dmg` |

## 1. Prerequisites

### Linux (Ubuntu 22.04 / 24.04, Debian 12 / 13)

Compilers, build tools and the libraries CEF needs at build and run time:

<!-- replay:linux -->
```bash
sudo apt-get update
sudo apt-get install -y build-essential g++ ninja-build pkg-config curl zip unzip tar git \
  autoconf automake autoconf-archive libtool bison flex python3 python3-pip python3-yaml \
  libgtk-3-dev libnss3 libxss1 libxtst6 libxrandr2 libxcomposite1 libxdamage1 \
  libxkbcommon0 libdrm2 libgbm1 libcups2 libatk-bridge2.0-0 xvfb file imagemagick \
  rpm dpkg-dev shellcheck patchelf
# ALSA: Ubuntu 22.04 ships "libasound2", Ubuntu 24.04 / Debian 13 ship "libasound2t64"
sudo apt-get install -y libasound2 || sudo apt-get install -y libasound2t64
```

CMake 3.30 or newer is required (`cmake --version`). Ubuntu 22.04 ships 3.22 and Ubuntu
24.04 ships 3.28, so install the current release from Kitware's APT repository (Debian 13
already ships 3.31 and can skip this block):

<!-- replay:linux -->
```bash
sudo apt-get install -y ca-certificates gpg wget lsb-release
wget -qO- https://apt.kitware.com/keys/kitware-archive-latest.asc | gpg --dearmor | sudo tee /usr/share/keyrings/kitware-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/kitware-archive-keyring.gpg] https://apt.kitware.com/ubuntu/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/kitware.list >/dev/null
sudo apt-get update
sudo apt-get install -y cmake
cmake --version
```

Node.js 24 LTS builds the UI. Any installation method is fine; with `nvm`:

<!-- replay:linux -->
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 24
nvm use 24
node --version
```

### Windows 10 / 11

1. **Visual Studio 2022** (Community is enough) or the *Build Tools for Visual Studio 2022*
   with the workload *Desktop development with C++* (MSVC v143 and a Windows 10/11 SDK):
   https://visualstudio.microsoft.com/downloads/
2. **CMake 3.30+**, **Ninja** and **Git**:
   `winget install Kitware.CMake Ninja-build.Ninja Git.Git`
3. **Node.js 24 LTS**: `winget install OpenJS.NodeJS.LTS`
4. For the MSI package: the **.NET SDK 8 or newer** (`winget install Microsoft.DotNet.SDK.8`)
   and the WiX Toolset .NET tool, installed in step 3.3 below.
5. Open a new **PowerShell** window afterwards so the updated `PATH` is in effect.

All Windows commands in this guide are PowerShell commands. They need the Visual Studio
build environment (compiler on `PATH`); either start them from the *x64 Native Tools Command
Prompt for VS 2022* (which is `cmd.exe`: replace `$env:NAME = "value"` by
`set NAME=value`), or enter the environment from PowerShell like this:

<!-- replay:windows -->
```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Import-Module (Join-Path $vsPath "Common7\Tools\Microsoft.VisualStudio.DevShell.dll")
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64"
cmake --version
ninja --version
node --version
```

### macOS 13+

Apple's command line tools (Clang, git) and a few Homebrew packages:

<!-- replay:macos -->
```bash
xcode-select -p >/dev/null 2>&1 || xcode-select --install
brew install cmake ninja node@24 pkg-config autoconf automake autoconf-archive libtool
export PATH="$(brew --prefix node@24)/bin:$PATH"
cmake --version
node --version
```

(`xcode-select --install` opens a dialog on a fresh machine; run the remaining commands
after it has finished.)

## 2. Get the sources and vcpkg

Download or clone the repository and work from its root directory:

```bash
git clone https://github.com/QuarkZimmerman/MaximaFictionBookEditor.git
cd MaximaFictionBookEditor
```

vcpkg provides every native dependency (libxml2, Hunspell, image libraries, ...). Put a
checkout next to the repository and point `VCPKG_ROOT` at it:

<!-- replay:linux,macos -->
```bash
git clone https://github.com/microsoft/vcpkg.git ../vcpkg
../vcpkg/bootstrap-vcpkg.sh -disableMetrics
VCPKG_ROOT="$(cd ../vcpkg && pwd)"
export VCPKG_ROOT
```

<!-- replay:windows -->
```powershell
git clone https://github.com/microsoft/vcpkg.git ..\vcpkg
..\vcpkg\bootstrap-vcpkg.bat -disableMetrics
$env:VCPKG_ROOT = (Resolve-Path ..\vcpkg).Path
```

The build is a vcpkg *manifest* build: the first configure compiles all dependencies listed
in `vcpkg.json` (10-25 minutes depending on the machine); later configures reuse them from
`build/vcpkg_installed`. `VCPKG_ROOT` must be set in every new terminal (or permanently in
your environment).

## 3. Configure, build, test

Presets (see `CMakePresets.json`) select the generator, the vcpkg toolchain and the options:

| Preset | What it builds |
|--------|----------------|
| `linux-core-debug` / `linux-core-release` | core library, `mfbe-core`, unit tests - no CEF |
| `linux-app-debug` / `linux-app-release` | core + UI bundle + CEF shell `mfbe` (debug: test hooks and CDP smoke) |
| `windows-core-release` / `windows-app-release` | same on Windows |
| `macos-core-release` / `macos-app-release` | same on macOS |

### 3.1 Core only (fast, no CEF download)

<!-- replay:linux -->
```bash
cmake --preset linux-core-release
cmake --build --preset linux-core-release
ctest --preset linux-core-release -LE corpus
build/linux-core-release/bin/mfbe-core --version
```

<!-- replay:windows -->
```powershell
cmake --preset windows-core-release
cmake --build --preset windows-core-release
ctest --preset windows-core-release -LE corpus
build\windows-core-release\bin\mfbe-core.exe --version
```

<!-- replay:macos -->
```bash
cmake --preset macos-core-release
cmake --build --preset macos-core-release
ctest --preset macos-core-release -LE corpus
build/macos-core-release/bin/mfbe-core --version
```

(`-LE corpus` leaves out the corpus tests, which need the local book collection described in
`tests/corpus/README.md`.)

### 3.2 User interface

<!-- replay:all -->
```bash
cd ui
npm ci
npm run typecheck
npm run lint
npm test
npm run build
cd ..
```

`npm run build` writes `ui/dist`, which the core serves and the packages ship.

### 3.3 Full application

The app presets download the pinned CEF binary distribution once (about 300 MB, into
`third_party/downloads/`), build the UI bundle with npm and link the shell:

<!-- replay:linux -->
```bash
cmake --preset linux-app-release
cmake --build --preset linux-app-release
build/linux-app-release/bin/mfbe --version
ctest --preset linux-app-release -L shell
```

<!-- replay:windows -->
```powershell
dotnet tool update --global wix
$env:PATH = "$env:USERPROFILE\.dotnet\tools;$env:PATH"
wix eula accept wix7
wix extension add -g WixToolset.UI.wixext
wix extension add -g WixToolset.Util.wixext
cmake --preset windows-app-release
cmake --build --preset windows-app-release
build\windows-app-release\bin\mfbe.exe --version
ctest --preset windows-app-release -L shell
```

<!-- replay:macos -->
```bash
cmake --preset macos-app-release
cmake --build --preset macos-app-release
build/macos-app-release/bin/mfbe.app/Contents/MacOS/mfbe --version
ctest --preset macos-app-release -L shell
```

`mfbe --version` prints the editor version together with the CEF and Chromium versions
(on Windows the output appears in the terminal the command was started from); `ctest -L
shell` runs the shell's unit tests (how a file dialog request becomes each platform's
dialog). The WiX commands are only needed for the MSI package (section 4); `dotnet tool
update` installs the
tool when it is missing and updates it otherwise, and the `PATH` line makes it available in
the current terminal right away (new terminals pick it up automatically). WiX v7 asks every
machine to acknowledge its Open Source Maintenance Fee EULA once (`wix eula accept wix7`,
see https://wixtoolset.org/osmf/); the fee itself applies to organisations above the revenue
threshold stated there, not to this independent open-source project or to individuals who
build it.

To run the editor from the build tree: `build/linux-app-release/bin/mfbe` (Linux),
`build\windows-app-release\bin\mfbe.exe` (Windows), `open build/macos-app-release/bin/mfbe.app`
(macOS). Resources, UI and scripts are taken from the source tree when the executable is not
installed.

### 3.4 End-to-end tests (Linux, macOS)

The Playwright journeys drive the real UI in a headless Chromium against `mfbe-core`, which
the test harness starts itself. The script benchmark (tagged `@perf`) measures times, so it runs
on its own after the journeys:

<!-- replay:linux -->
```bash
cd ui
npx playwright install --with-deps chromium
export MFBE_CORE_BIN=../build/linux-core-release/bin/mfbe-core MFBE_UI_DIST=../ui/dist
npm run test:e2e -- --grep-invert @perf
npx playwright test --grep @perf --workers=1
cd ..
```

<!-- replay:macos -->
```bash
cd ui
npx playwright install chromium
export MFBE_CORE_BIN=../build/macos-core-release/bin/mfbe-core MFBE_UI_DIST=../ui/dist
npm run test:e2e -- --grep-invert @perf
npx playwright test --grep @perf --workers=1
cd ..
```

Shell smoke test under a virtual display (Linux only; needs `xvfb`): starts the CEF shell
with the in-process core, attaches Playwright over CDP, checks the window title, opens a
document given on the command line and the About dialog. Every run also makes GTK decode a PNG
inside the shell, as desktop themes with PNG images do, and fails when the shell exports symbols
of its statically linked libraries:

<!-- replay:linux -->
```bash
MFBE_APP_BIN=build/linux-app-release/bin/mfbe MFBE_SMOKE_REAL_UI=1 \
  MFBE_SMOKE_OPEN_FILE=tests/fixtures/books/modern-utf8.fb2 MFBE_SMOKE_ABOUT=1 tools/shell-smoke.sh
```

## 4. Packages

The package presets run CPack with the generators of each platform; results land in
`build/<preset>/packages/` (next to a `.sha256` checksum file each):

<!-- replay:linux -->
```bash
cpack --preset linux-app-release
ls -l build/linux-app-release/packages/
```

<!-- replay:windows -->
```powershell
cpack --preset windows-app-release
Get-ChildItem build\windows-app-release\packages\
```

<!-- replay:macos -->
```bash
cpack --preset macos-app-release
ls -l build/macos-app-release/packages/
```

| Platform | Package | Tooling |
|----------|---------|---------|
| Linux | `MaximaFictionBookEditor-<version>-x86_64.AppImage` (+ `.zsync`) | `packaging/appimage/build.sh`: appimagetool and the static type2 runtime are downloaded into `build/tools/` on first use |
| Linux | `mfbe_<version>_amd64.deb` | CPack DEB (`dpkg-deb`) |
| Linux | `mfbe-<version>-1.x86_64.rpm` | CPack RPM (`rpmbuild` from the `rpm` package) |
| Windows | `MaximaFictionBookEditor-<version>-win64.msi` | CPack WIX with the WiX .NET tool (`wix`, extensions `WixToolset.UI.wixext`, `WixToolset.Util.wixext`) |
| Windows | `MaximaFictionBookEditor-<version>-win64-portable.zip` | CPack ZIP of the same installation tree plus an empty `bin\user` folder for the copy's data (portable copy, nothing registered) |
| macOS | `MaximaFictionBookEditor-<version>-macos-<arch>.dmg` | CPack DragNDrop; the bundle is ad-hoc signed (`codesign --sign -`) |

Details of each package (layout, file associations, sandbox helper, AppArmor profile,
signing) are in `packaging/README.md`; end-user installation steps are in
`docs/installing.md`. A single generator can be run directly, e.g.
`cpack -G DEB --config build/linux-app-release/CPackConfig.cmake`.

Installing into a directory instead of packaging (same layout as the packages,
`cmake/InstallLayout.cmake`):

```bash
cmake --install build/linux-app-release --prefix /tmp/mfbe --strip
/tmp/mfbe/bin/mfbe --version
```

## 5. Toolchain notes

- TypeScript is pinned to the 6.0.x line: `typescript-eslint` 8.x accepts
  `typescript >=4.8.4 <6.1.0`, so the TypeScript 7 native compiler cannot be used until the
  linter supports it. Vite 8 and Vitest 5 transpile with esbuild/oxc and have no TypeScript
  peer requirement.
- `libxml2` is built without iconv; the editor ships its own converters for the legacy
  encodings it supports (windows-1251, KOI8-R, ...).
- The CEF "minimal" distribution contains Release binaries only; Debug app builds link
  against them (handled by `cmake/FindCEFDistribution.cmake`). `libcef.so` ships with debug
  information (1.4 GB); stripped copies are produced at build time for installation and
  packaging (`MFBE_STRIP_CEF_BINARIES`, default on).
- Only the `en-US` and `ru` CEF locale packs are installed (`MFBE_CEF_LOCALES`); Chromium
  falls back to `en-US` for other system locales. Set `-DMFBE_CEF_LOCALES=` (empty) to ship
  all of them.
- `MFBE_BUILD_UI=OFF` skips the npm build inside CMake; an existing `ui/dist` (from
  `npm run build`) is still installed and packaged.
- Pre-extracted CEF: `-DMFBE_CEF_ROOT=<dir>` reuses a distribution (CI caches
  `third_party/downloads/`); `-DMFBE_CEF_DOWNLOAD_BASE_URL=<mirror>` changes the download
  server.
- `-DCMAKE_OSX_ARCHITECTURES=arm64` or `x86_64` selects the macOS architecture (one per build;
  CEF has no universal binaries).

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `CMake 3.30 or higher is required` | install a current CMake (section 1) and make sure it comes first on `PATH` |
| vcpkg: `Could not find a package configuration file` / `VCPKG_ROOT` errors | `VCPKG_ROOT` is not set in this terminal or points to a checkout that was never bootstrapped |
| vcpkg builds fail on Linux with `autoconf`, `libtool` or `bison` errors | install `autoconf automake autoconf-archive libtool bison flex` |
| vcpkg on Windows: `error: in triplet x64-windows-static` or `cl.exe` not found | the Visual Studio build environment is missing: use the Native Tools prompt or the `Enter-VsDevShell` block of section 1 |
| CEF download hash mismatch or interrupted download | delete `third_party/downloads/*.part` and the archive, re-run the configure step |
| `npm ci` fails with an engine warning/error | Node.js 24 is required (`node --version`); older Node versions are not supported |
| `mfbe` prints `Chromium sandbox unavailable ... running without the sandbox` | expected in containers and when running as root; on Ubuntu 24.04+ install the `.deb` (it ships an AppArmor profile and the SUID helper) or run the AppImage, which handles this automatically |
| `mfbe` does not start on Wayland | try `mfbe --ozone-platform=x11` (XWayland); report the session type and compositor |
| Playwright: missing shared libraries | `npx playwright install --with-deps chromium` (needs sudo) |
| `cpack -G WIX`: `Could not find the 'wix' executable` | `dotnet tool install --global wix` and open a new terminal; or set the `WIX` environment variable to the tool's directory |
| `cpack -G WIX`: unresolved `WixToolset.UI.wixext` | `wix extension add -g WixToolset.UI.wixext WixToolset.Util.wixext` (the extension version must match the `wix` version: `wix --version`, `wix extension list -g`) |
| AppImage build: `appimagetool` cannot be downloaded | put `appimagetool-x86_64.AppImage` and `runtime-x86_64` into `build/tools/` by hand, or set `MFBE_APPIMAGETOOL` / `MFBE_APPIMAGE_RUNTIME` |
| `rpmbuild` not found | `sudo apt-get install rpm` (Debian/Ubuntu) or `sudo dnf install rpm-build` (Fedora) |
| macOS: `"mfbe" cannot be opened because the developer cannot be verified` | the bundle is ad-hoc signed, not notarised: see the first-launch steps in `docs/installing.md` |

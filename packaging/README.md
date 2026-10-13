# Packaging

Everything that turns the install tree into distributable packages (User Story 11,
T141-T146). End-user instructions are in `docs/installing.md`; build instructions in
`docs/building.md`.

```text
cmake/InstallLayout.cmake        install tree shared by all generators (see below)
cmake/MfbePackaging.cmake        CPack settings common to all generators, WiX constants
packaging/CPackConfig.cmake      per-generator settings (evaluated by cpack for each generator)
packaging/appimage/              build.sh, AppRun, AppStream metadata, CPack External script
packaging/deb-rpm/               Debian maintainer scripts, RPM scriptlets, AppArmor profile
packaging/wix/                   MSI template, shell-integration fragment, feature patch
packaging/macos/                 ad-hoc codesign step for the .dmg
```

Run everything for a platform with its package preset (`cpack --preset linux-app-release`,
`windows-app-release`, `macos-app-release`) after building the matching configure preset;
single generators: `cpack -G DEB --config build/<preset>/CPackConfig.cmake`. Packages and
`.sha256` files are written to `build/<preset>/packages/`.

## Install tree

| Platform | Layout |
|----------|--------|
| Linux (prefix `/usr`) | `bin/mfbe` -> `../lib/mfbe/mfbe`, `bin/mfbe-core`; `lib/mfbe/` = shell executable, `libcef.so` and the other CEF binaries, `*.pak`, `icudtl.dat`, `locales/{en-US,ru}.pak`, `chrome-sandbox`; `share/mfbe/{resources,ui,scripts}`; `share/applications/mfbe.desktop`, `share/mime/packages/mfbe.xml`, `share/icons/hicolor/*/apps/mfbe.png`, `share/doc/mfbe/LICENSE` |
| Windows (MSI root, portable ZIP folder) | `bin\mfbe.exe` with every CEF DLL and resource next to it, `bin\mfbe-core.exe`; `share\mfbe\{resources,ui,scripts}`; `share\doc\mfbe` |
| macOS | `mfbe.app/Contents/{MacOS/mfbe, Frameworks/Chromium Embedded Framework.framework, Frameworks/mfbe Helper*.app, Resources/{resources,ui,scripts,mfbe.icns}}` (+ `bin/mfbe-core` for developers, not in the .dmg) |

The Linux shell lives in `lib/mfbe` because Chromium resolves its resources, the V8 snapshot
and the SUID helper relative to the executable/module directory; `/proc/self/exe` resolves
the `bin/mfbe` symlink, and both the shell (`app/src/user_dirs.cpp`) and the core find
`share/mfbe/...` from there. `libcef.so` is stripped at build time for installation
(1.4 GB with debug info, ~260 MB stripped; `MFBE_STRIP_CEF_BINARIES`), and only the `en-US`
and `ru` locale packs are installed (`MFBE_CEF_LOCALES`).

## Linux

### AppImage (`packaging/appimage`)

`build.sh --install-tree <dir> --output <file>` copies the install tree into an AppDir, adds
`AppRun`, the desktop file, the icon and AppStream metadata, removes `chrome-sandbox` (it
cannot be SUID inside a squashfs image) and runs `appimagetool` with the static type2
runtime (`--runtime-file`, no `libfuse2` on the target) and zsync update information
(`gh-releases-zsync|QuarkZimmerman|MaximaFictionBookEditor|latest|MaximaFictionBookEditor-*-x86_64.AppImage.zsync`).
`appimagetool` and the runtime are downloaded into `build/tools/` on first use (or pointed
to with `MFBE_APPIMAGETOOL` / `MFBE_APPIMAGE_RUNTIME`); the tool itself is run with
`--appimage-extract-and-run`, so no FUSE is needed on the build machine either.

No system libraries are bundled, on purpose: `libcef.so` links the GTK 3 stack (glib, gio,
pango, cairo, atk/at-spi, fontconfig, freetype, X11/xcb, xkbcommon, dbus, nss/nspr, cups,
alsa, drm/gbm) and Chromium loads the host's `libgtk-3` at run time for dialogs and theming.
Host GTK only loads against the host's glib/pango/cairo, so shipping those libraries breaks
the editor on any distribution newer than the build machine (the classic AppImage/Electron
failure), while every library in that list is a dependency of GTK 3 itself or of every
desktop session and is therefore present wherever a desktop runs. `linuxdeploy`'s automatic
dependency bundling was evaluated and rejected for exactly this reason (it copies glib,
pango, nss, systemd, selinux ... and a second `libcef.so`).

Sandbox: the AppImage has no SUID helper, so Chromium's namespace sandbox (unprivileged user
namespaces) is used; where that is unavailable - Ubuntu 23.10+/24.04+ restrict it for
unconfined programs - the shell switches the sandbox off itself and logs
`shell.sandboxDisabled` (`app/src/sandbox_check.cpp`); no `--no-sandbox` flag is needed.

CPack integration: the `External` generator stages the tree with
`CPACK_PACKAGING_INSTALL_PREFIX=/usr` and runs `CPackExternal.cmake`, which calls
`build.sh` and reports the image and its `.zsync` file as built packages.

Portable mode (`contracts/resource-formats.md` §2): the core reads `$APPIMAGE` (set by the
runtime) and uses `<image>.home/user`, `<image>.d/user` or `<image>.d` next to the file.

### .deb and .rpm (`packaging/deb-rpm`)

Both are monolithic CPack packages from the same install tree with explicit dependencies
(`CPACK_DEBIAN_PACKAGE_DEPENDS`: Ubuntu 22.04 package names with the time64 `t64`
alternatives; RPM: automatic soname requires plus `libgtk-3.so.0()(64bit)`, with provides and
requires of the private libraries under `/usr/lib/mfbe` excluded).

Maintainer scripts (`postinst`/`prerm`/`postrm`, `rpm-post.sh`/`rpm-preun.sh`/`rpm-postun.sh`):

1. `chown root:root; chmod 4755 /usr/lib/mfbe/chrome-sandbox` (the RPM also carries
   `%attr(4755,root,root)`);
2. load `/etc/apparmor.d/mfbe` with `apparmor_parser -r` **only** where the user-namespace
   restriction exists (`/proc/sys/kernel/apparmor_restrict_unprivileged_userns`), unload it
   on removal; the profile uses `abi <abi/4.0>` and `userns,` and attaches to
   `/usr/lib/mfbe/mfbe` (the real executable behind the `/usr/bin/mfbe` symlink) with
   `flags=(unconfined)`, like Ubuntu's own profiles for Chromium-based applications;
3. `update-desktop-database`, `update-mime-database`, `gtk-update-icon-cache` (the
   distributions' file triggers do the same).

The AppArmor profile is added to the staging tree by `CPackPreBuild.cmake` rather than by an
`install()` rule, so a developer's `cmake --install --prefix <dir>` never writes to `/etc`.
It is a Debian conffile (kept on `remove`, deleted on `purge`).

## Windows MSI (`packaging/wix`)

Built by CPack's WIX generator in WiX .NET-tool mode (`CPACK_WIX_VERSION 4`; WiX v4, v5 and
v7 share the v4 schema). Requirements on the build machine: .NET SDK,
`dotnet tool install --global wix`, `wix eula accept wix7` (WiX v7 Open Source Maintenance Fee EULA, https://wixtoolset.org/osmf/ - fee applies to organisations above the revenue threshold only), `wix extension add -g WixToolset.UI.wixext WixToolset.Util.wixext`.

- `mfbe.template.in` is CMake's own WiX v4 template kept in the repository with
  `Package/@Scope="perMachine"`: the installer asks for administrator rights and installs
  into `C:\Program Files\Maxima Fiction Book Editor` for all users of the machine, like any
  ordinary Windows program.
- `shell-integration.wxs` (`CPACK_WIX_EXTRA_SOURCES`) registers the ProgIds `MaximaFBE.fb2`
  and `MaximaFBE.fbd` (icon = `bin\mfbe.exe,0`, verbs `open` and `edit`), the `.fb2` /
  `.fbd` extensions (`OpenWithProgids`, content type `application/x-fictionbook+xml`), the
  Default Programs capabilities (`Software\Maxima Fiction Book Editor\Capabilities` +
  `RegisteredApplications`), the `Applications\mfbe.exe` entry and `App Paths`. All values use
  `Root="HKMU"` (HKLM for this per-machine package) and belong to components of the root
  feature (`feature.patch.xml`), so uninstalling removes every association. Plain registry
  values are used instead of advertised ProgIds to avoid MSI self-repair on double-click.
  Explorer's association cache is refreshed by the application on its first start after an
  installation (`SHChangeNotify(SHCNE_ASSOCCHANGED)`, `app/src/native_actions.cpp`).
- `MajorUpgrade` with the constant `CPACK_WIX_UPGRADE_GUID` (cmake/MfbePackaging.cmake)
  replaces an older installation in place; downgrades are refused.
- Start menu shortcut from `CPACK_PACKAGE_EXECUTABLES`, product icon from
  `app/win/mfbe.ico`, ARP links from `CPACK_WIX_PROPERTY_ARP*`.
- The Windows resources of the executable itself (icon, per-monitor DPI v2 manifest, UTF-8
  code page, version info) are in `app/win/`.

The same tree is also packed as `MaximaFictionBookEditor-<version>-win64-portable.zip` (CPack
ZIP, `packaging/CPackConfig.cmake`): one top-level folder with `bin\mfbe.exe`, nothing
registered, no installer.

Both are produced and smoke-tested by the `windows-app-release` jobs of the CI and release
workflows: the MSI is installed (`msiexec /i ... /qn`), the ZIP is unpacked into a folder of
the user profile, and each copy runs `mfbe.exe --version` and is started until its window shows
the interface (`tools/ci/windows-start-smoke.ps1`). Neither can be built on Linux hosts.

## macOS (`packaging/macos`, `app/mac`)

`app/mac/Info.plist.in` declares the `.fb2` / `.fbd` document types (exported UTIs
`com.quarkzimmerman.mfbe.fb2` / `.fbd`), `LSMinimumSystemVersion 13.0`,
`NSHighResolutionCapable` and the icon; the five helper bundles use
`app/mac/helper-Info.plist.in`. The build-tree bundle is ad-hoc signed after the framework,
helpers and resources were copied (POST_BUILD step in `app/CMakeLists.txt`); the installed
bundle is signed again after all components landed (`cmake/MfbePackaging.cmake` for
developer installs, `CPackPreBuild.cmake` inside the DragNDrop run), with
`codesign --force --deep --sign -` and a `codesign --verify --deep --strict` check. The
`.dmg` (`CPACK_DMG_FORMAT UDZO`, volume "Maxima Fiction Book Editor", with the usual
`/Applications` link) contains only the bundle; `bin/mfbe-core` stays out of it.

Unsigned/un-notarised builds are acceptable (FR-123); the first-launch "Open Anyway" steps
are documented in `docs/installing.md`. Signing with a Developer ID and notarisation can be
added later as an extra step after `CPackPreBuild.cmake` without changing the layout.

## Verifying a build

```bash
cmake --install build/linux-app-release --prefix /tmp/mfbe --strip && /tmp/mfbe/bin/mfbe --version
MFBE_APP_BIN=/tmp/mfbe/bin/mfbe MFBE_SMOKE_REAL_UI=1 tools/shell-smoke.sh      # installed tree under Xvfb
APPIMAGE_EXTRACT_AND_RUN=1 MFBE_APP_BIN=build/linux-app-release/packages/MaximaFictionBookEditor-*-x86_64.AppImage \
  MFBE_SMOKE_REAL_UI=1 tools/shell-smoke.sh                                       # the AppImage
dpkg-deb -I build/linux-app-release/packages/mfbe_*_amd64.deb; dpkg-deb -c ... | less
rpm -qpi build/linux-app-release/packages/mfbe-*.rpm; rpm -qpR ...; rpm -qp --scripts ...
```

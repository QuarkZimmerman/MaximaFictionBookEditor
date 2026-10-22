# Per-generator CPack settings (CPACK_PROJECT_CONFIG_FILE). cpack evaluates this file once for
# every generator with CPACK_GENERATOR set; shared values come from cmake/MfbePackaging.cmake
# through the generated CPackConfig.cmake (CPACK_MFBE_* carry project facts).
#
#   DEB / RPM      packaging/deb-rpm: dependencies, maintainer scripts (SUID chrome-sandbox,
#                  AppArmor profile, desktop caches), AppArmor profile added to the staging
#                  tree by packaging/deb-rpm/CPackPreBuild.cmake (T144)
#   External       AppImage via packaging/appimage/CPackExternal.cmake + build.sh (T143)
#   WIX            MSI via WiX .NET tool (T142; template/fragments in packaging/wix)
#   ZIP            Windows portable copy of the MSI's installation tree (no installer) with an
#                  empty bin/user folder for the copy's own data (packaging/zip/CPackPreBuild.cmake)
#   DragNDrop      .dmg with the ad-hoc signed bundle (T145; packaging/macos)

set(_mfbe_source "${CPACK_MFBE_SOURCE_DIR}")
set(_mfbe_version "${CPACK_PACKAGE_VERSION}")

# --- Linux generators --------------------------------------------------------------------------
if(CPACK_GENERATOR MATCHES "^(DEB|RPM|External)$")
  set(CPACK_PACKAGING_INSTALL_PREFIX "/usr")
  set(CPACK_MONOLITHIC_INSTALL ON)  # one package with every component
endif()

if(CPACK_GENERATOR STREQUAL "DEB")
  set(CPACK_DEBIAN_PACKAGE_NAME "mfbe")
  set(CPACK_DEBIAN_FILE_NAME "DEB-DEFAULT")                 # mfbe_<version>_amd64.deb
  set(CPACK_DEBIAN_PACKAGE_SECTION "editors")
  set(CPACK_DEBIAN_PACKAGE_PRIORITY "optional")
  set(CPACK_DEBIAN_PACKAGE_HOMEPAGE "${CPACK_MFBE_URL}")
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "${CPACK_PACKAGE_CONTACT}")
  set(CPACK_DEBIAN_COMPRESSION_TYPE "xz")
  # Run-time libraries of libcef.so / Chromium (Ubuntu 22.04 names; the time64 (t64) renames
  # of Ubuntu 24.04 / Debian 13 keep "Provides" of the old names, alternatives listed anyway)
  # plus GTK 3, which Chromium loads at run time for dialogs and theming. dpkg-shlibdeps is
  # not used so the list does not depend on the build machine's distribution.
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS OFF)
  set(CPACK_DEBIAN_PACKAGE_DEPENDS
    "libc6 (>= 2.35), libstdc++6 (>= 11), libgcc-s1, libatomic1, libgtk-3-0 | libgtk-3-0t64, libglib2.0-0 | libglib2.0-0t64, libnss3, libnspr4, libasound2 | libasound2t64, libatk1.0-0 | libatk1.0-0t64, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libatspi2.0-0 | libatspi2.0-0t64, libcups2 | libcups2t64, libdbus-1-3, libdrm2, libgbm1, libexpat1, libxkbcommon0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxi6, libxrandr2, libxrender1, libpango-1.0-0, libcairo2, libfontconfig1, libfreetype6, libharfbuzz0b, libpng16-16 | libpng16-16t64, libudev1, libsystemd0, libgnutls30 | libgnutls30t64, libkrb5-3, libavahi-client3, libbz2-1.0, libthai0, libpixman-1-0, libgraphite2-3, libcap2, libselinux1, libmount1, libblkid1, libffi8, libpcre2-8-0")
  set(CPACK_DEBIAN_PACKAGE_RECOMMENDS "xdg-utils, shared-mime-info, desktop-file-utils, hicolor-icon-theme")
  # Maintainer scripts + conffiles (/etc/apparmor.d/mfbe is kept on remove, deleted on purge).
  set(CPACK_DEBIAN_PACKAGE_CONTROL_EXTRA
    "${_mfbe_source}/packaging/deb-rpm/postinst;${_mfbe_source}/packaging/deb-rpm/prerm;${_mfbe_source}/packaging/deb-rpm/postrm;${_mfbe_source}/packaging/deb-rpm/conffiles")
  set(CPACK_DEBIAN_PACKAGE_CONTROL_STRICT_PERMISSION ON)
  list(APPEND CPACK_PRE_BUILD_SCRIPTS "${_mfbe_source}/packaging/deb-rpm/CPackPreBuild.cmake")
endif()

if(CPACK_GENERATOR STREQUAL "RPM")
  set(CPACK_RPM_PACKAGE_NAME "mfbe")
  set(CPACK_RPM_FILE_NAME "RPM-DEFAULT")                    # mfbe-<version>-1.x86_64.rpm
  set(CPACK_RPM_PACKAGE_SUMMARY "${CPACK_PACKAGE_DESCRIPTION_SUMMARY}")
  set(CPACK_RPM_PACKAGE_DESCRIPTION "${CPACK_PACKAGE_DESCRIPTION}")
  set(CPACK_RPM_PACKAGE_LICENSE "GPL-3.0-only")
  set(CPACK_RPM_PACKAGE_GROUP "Applications/Publishing")
  set(CPACK_RPM_PACKAGE_URL "${CPACK_MFBE_URL}")
  set(CPACK_RPM_PACKAGE_VENDOR "${CPACK_PACKAGE_VENDOR}")
  set(CPACK_RPM_PACKAGE_RELEASE 1)
  set(CPACK_RPM_PACKAGE_RELEASE_DIST OFF)
  set(CPACK_RPM_PACKAGE_RELOCATABLE OFF)
  set(CPACK_RPM_COMPRESSION_TYPE "xz")
  # Dependencies: automatic soname requires (distribution-neutral: Fedora and openSUSE both
  # provide them) plus GTK 3, which is loaded at run time and therefore invisible to rpmbuild.
  set(CPACK_RPM_PACKAGE_AUTOREQ ON)
  set(CPACK_RPM_PACKAGE_AUTOPROV ON)
  set(CPACK_RPM_PACKAGE_REQUIRES "libgtk-3.so.0()(64bit)")
  set(CPACK_RPM_PACKAGE_SUGGESTS "xdg-utils")
  # Private libraries under /usr/lib/mfbe must neither be offered to other packages nor
  # demanded from the system (libcef.so, the ANGLE/SwiftShader/Vulkan loaders).
  set(CPACK_RPM_SPEC_MORE_DEFINE
    "%global __provides_exclude_from ^/usr/lib/mfbe/.*$
%global __requires_exclude ^(libcef[.]so|libEGL[.]so|libGLESv2[.]so|libvk_swiftshader[.]so|libvulkan[.]so[.]1)
%global _build_id_links none
%global debug_package %{nil}")
  set(CPACK_RPM_SPEC_INSTALL_POST "/bin/true")  # files are already stripped (CPACK_STRIP_FILES)
  set(CPACK_RPM_POST_INSTALL_SCRIPT_FILE "${_mfbe_source}/packaging/deb-rpm/rpm-post.sh")
  set(CPACK_RPM_PRE_UNINSTALL_SCRIPT_FILE "${_mfbe_source}/packaging/deb-rpm/rpm-preun.sh")
  set(CPACK_RPM_POST_UNINSTALL_SCRIPT_FILE "${_mfbe_source}/packaging/deb-rpm/rpm-postun.sh")
  # SUID sandbox helper and the AppArmor profile as a config file.
  set(CPACK_RPM_USER_FILELIST
    "%attr(4755,root,root) /usr/lib/mfbe/chrome-sandbox"
    "%config(noreplace) /etc/apparmor.d/mfbe")
  # Directories owned by the base system / other packages.
  set(CPACK_RPM_EXCLUDE_FROM_AUTO_FILELIST_ADDITION
    /etc /etc/apparmor.d /usr/lib /usr/bin /usr/share /usr/share/doc /usr/share/applications
    /usr/share/mime /usr/share/mime/packages /usr/share/icons /usr/share/icons/hicolor
    /usr/share/icons/hicolor/16x16 /usr/share/icons/hicolor/16x16/apps
    /usr/share/icons/hicolor/32x32 /usr/share/icons/hicolor/32x32/apps
    /usr/share/icons/hicolor/48x48 /usr/share/icons/hicolor/48x48/apps
    /usr/share/icons/hicolor/64x64 /usr/share/icons/hicolor/64x64/apps
    /usr/share/icons/hicolor/128x128 /usr/share/icons/hicolor/128x128/apps
    /usr/share/icons/hicolor/256x256 /usr/share/icons/hicolor/256x256/apps)
  list(APPEND CPACK_PRE_BUILD_SCRIPTS "${_mfbe_source}/packaging/deb-rpm/CPackPreBuild.cmake")
endif()

if(CPACK_GENERATOR STREQUAL "External")
  set(CPACK_PACKAGE_FILE_NAME "MaximaFictionBookEditor-${_mfbe_version}")
  set(CPACK_EXTERNAL_ENABLE_STAGING ON)
  set(CPACK_EXTERNAL_PACKAGE_SCRIPT "${_mfbe_source}/packaging/appimage/CPackExternal.cmake")
  set(CPACK_MFBE_APPIMAGE_SCRIPT "${_mfbe_source}/packaging/appimage/build.sh")
  set(CPACK_MFBE_APPIMAGE_TOOLS_DIR "${CPACK_MFBE_BINARY_DIR}/tools")
  set(CPACK_MFBE_APPIMAGE_ARCH "${CPACK_MFBE_ARCH}")
  # CPACK_MFBE_APPIMAGE_UPDATE_INFO comes from cmake/MfbePackaging.cmake.
endif()

# --- Windows ----------------------------------------------------------------------------------
if(CPACK_GENERATOR STREQUAL "WIX")
  set(CPACK_PACKAGE_FILE_NAME "MaximaFictionBookEditor-${_mfbe_version}-win64")
  set(CPACK_MONOLITHIC_INSTALL ON)  # one feature, WixUI_InstallDir dialog set
  # CPack passes WixToolset.UI.wixext itself for the dialog set; the shell-integration
  # fragment needs no further extension (plain registry elements).
endif()

if(CPACK_GENERATOR STREQUAL "ZIP")
  # One top-level folder holding the same tree the MSI installs: <folder>\bin\mfbe.exe.
  set(CPACK_PACKAGE_FILE_NAME "MaximaFictionBookEditor-${_mfbe_version}-win64-portable")
  set(CPACK_MONOLITHIC_INSTALL ON)
  set(CPACK_INCLUDE_TOPLEVEL_DIRECTORY ON)
  list(APPEND CPACK_PRE_BUILD_SCRIPTS "${_mfbe_source}/packaging/zip/CPackPreBuild.cmake")
endif()

# --- macOS ------------------------------------------------------------------------------------
if(CPACK_GENERATOR STREQUAL "DragNDrop")
  set(CPACK_PACKAGE_FILE_NAME "MaximaFictionBookEditor-${_mfbe_version}-macos-${CPACK_MFBE_APPLE_ARCH}")
  set(CPACK_DMG_VOLUME_NAME "${CPACK_MFBE_PRODUCT_NAME}")
  set(CPACK_DMG_FORMAT "UDZO")
  # APFS, not HFS+: HFS+ stores file names in decomposed Unicode (NFD), which renames the
  # Cyrillic script folders inside the bundle and breaks the code signature seal
  # ("a sealed resource is missing or invalid"). APFS keeps the names as signed; macOS 13+
  # (our minimum) mounts APFS images.
  set(CPACK_DMG_FILESYSTEM "APFS")
  # hdiutil through a retrying wrapper: on the GitHub macOS runners `hdiutil convert` fails now
  # and then with "Resource temporarily unavailable" and succeeds a moment later; CPack itself
  # runs it once (packaging/macos/hdiutil-retry.sh).
  set(CPACK_COMMAND_HDIUTIL "${_mfbe_source}/packaging/macos/hdiutil-retry.sh")
  # Only the bundle goes into the image (bin/mfbe-core is a developer tool).
  set(CPACK_COMPONENTS_ALL app resources ui scripts)
  set(CPACK_COMPONENTS_GROUPING "ALL_COMPONENTS_IN_ONE")
  list(APPEND CPACK_PRE_BUILD_SCRIPTS "${_mfbe_source}/packaging/macos/CPackPreBuild.cmake")
endif()

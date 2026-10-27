# CPack configuration shared by every generator (included last by the root CMakeLists.txt).
#
# Generators are selected by the package presets (CMakePresets.json): Linux DEB;RPM;External
# (External = AppImage through packaging/appimage/CPackExternal.cmake), Windows WIX;ZIP (WiX
# .NET tool, CPACK_WIX_VERSION 4; ZIP = portable copy), macOS DragNDrop. Generator-specific
# settings live in packaging/CPackConfig.cmake, which cpack evaluates once per generator; every
# CPACK_* value set here is written to the generated CPackConfig.cmake and therefore visible
# there.
#
# Produces (<label> = MFBE_VERSION from MfbeVersion.cmake: 0.0.6-rc untagged, 0.0.6-rc.N from the
# tag v0.0.6-rc.N, the plain number for a final; feature 006, contracts/installer.md):
#   mfbe_<label>_amd64.deb, mfbe-<label>-1.x86_64.rpm (their Version: the package form,
#   0.0.6~rc),
#   MaximaFictionBookEditor-<label>-x86_64.AppImage (+ .zsync when it carries update information),
#   MaximaFictionBookEditor-<label>-win64.msi (ProductVersion: the numeric form, 0.0.6),
#   MaximaFictionBookEditor-<label>-win64-portable.zip,
#   MaximaFictionBookEditor-<label>-macos-<arch>.dmg

set(CPACK_PACKAGE_NAME "MaximaFictionBookEditor")
set(CPACK_PACKAGE_VENDOR "${MFBE_VENDOR}")
# The numeric form: the MSI's Package/@Version takes numbers only (packaging/wix/mfbe.template.in).
# The file names take the label (CPACK_MFBE_VERSION_LABEL, packaging/CPackConfig.cmake).
set(CPACK_PACKAGE_VERSION "${MFBE_VERSION_NUMERIC}")
set(CPACK_PACKAGE_VERSION_MAJOR "${PROJECT_VERSION_MAJOR}")
set(CPACK_PACKAGE_VERSION_MINOR "${PROJECT_VERSION_MINOR}")
set(CPACK_PACKAGE_VERSION_PATCH "${PROJECT_VERSION_PATCH}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "${PROJECT_DESCRIPTION}")
set(CPACK_PACKAGE_DESCRIPTION
  "Editor for FictionBook 2 (.fb2/.fbd) e-books: Description, Body and Source views, document tree, schema validation, English and Russian spell checking, the Words tool and user scripts. Works offline.")
set(CPACK_PACKAGE_HOMEPAGE_URL "${MFBE_URL}")
set(CPACK_PACKAGE_CONTACT "${MFBE_VENDOR} (${MFBE_URL})")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "${MFBE_PRODUCT_NAME}")
set(CPACK_PACKAGE_EXECUTABLES "mfbe;${MFBE_PRODUCT_NAME}")
set(CPACK_STRIP_FILES ON)
set(CPACK_PACKAGE_CHECKSUM SHA256)
set(CPACK_VERBATIM_VARIABLES ON)
set(CPACK_PACKAGE_DIRECTORY "${CMAKE_BINARY_DIR}/packages")

# Licence text: the WiX generator converts a .txt file to RTF itself; keep one .txt copy for
# every generator.
configure_file("${CMAKE_SOURCE_DIR}/LICENSE" "${CMAKE_BINARY_DIR}/packaging/LICENSE.txt" COPYONLY)
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_BINARY_DIR}/packaging/LICENSE.txt")
set(CPACK_RESOURCE_FILE_README "${CMAKE_SOURCE_DIR}/README.md")

# Paths and facts the per-generator configuration needs (only CPACK_* variables survive).
set(CPACK_MFBE_SOURCE_DIR "${CMAKE_SOURCE_DIR}")
set(CPACK_MFBE_BINARY_DIR "${CMAKE_BINARY_DIR}")
set(CPACK_MFBE_PRODUCT_NAME "${MFBE_PRODUCT_NAME}")
set(CPACK_MFBE_SHORT_NAME "${MFBE_SHORT_NAME}")
set(CPACK_MFBE_URL "${MFBE_URL}")
set(CPACK_MFBE_APP_BUNDLE_NAME "${MFBE_APP_BUNDLE_NAME}")
set(CPACK_MFBE_HAVE_APP "${MFBE_BUILD_APP}")
# The version forms (cmake/MfbeVersion.cmake): the label names the files, the package form is
# the deb and rpm Version, and a pre-release part puts the label into the MSI's ProductName.
set(CPACK_MFBE_VERSION_LABEL "${MFBE_VERSION}")
set(CPACK_MFBE_VERSION_PACKAGE "${MFBE_VERSION_PACKAGE}")
set(CPACK_MFBE_PRERELEASE "${MFBE_VERSION_PRERELEASE}")
if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64|ARM64)$")
  set(CPACK_MFBE_ARCH "aarch64")
  set(CPACK_MFBE_APPLE_ARCH "arm64")
else()
  set(CPACK_MFBE_ARCH "x86_64")
  set(CPACK_MFBE_APPLE_ARCH "x86_64")
endif()
if(APPLE AND CMAKE_OSX_ARCHITECTURES)
  set(CPACK_MFBE_APPLE_ARCH "${CMAKE_OSX_ARCHITECTURES}")
endif()
# The AppImage's update information follows the release channel of the version forms: none for
# an untagged pre-release build (it could "update" itself to an older release; no .zsync then),
# latest-all for a tag v<numeric>-<pre-release>.N (the next rc, then the final), latest for a
# final.
if(MFBE_APPIMAGE_CHANNEL STREQUAL "")
  set(CPACK_MFBE_APPIMAGE_UPDATE_INFO "")
else()
  set(CPACK_MFBE_APPIMAGE_UPDATE_INFO
    "gh-releases-zsync|QuarkZimmerman|MaximaFictionBookEditor|${MFBE_APPIMAGE_CHANNEL}|MaximaFictionBookEditor-*-${CPACK_MFBE_ARCH}.AppImage.zsync")
endif()

# Component descriptions (shown by component-aware generators).
set(CPACK_COMPONENT_APP_DISPLAY_NAME "Application")
set(CPACK_COMPONENT_CORE_DISPLAY_NAME "Headless core (mfbe-core)")
set(CPACK_COMPONENT_RESOURCES_DISPLAY_NAME "Schema, genres, dictionaries")
set(CPACK_COMPONENT_UI_DISPLAY_NAME "User interface")
set(CPACK_COMPONENT_SCRIPTS_DISPLAY_NAME "Bundled scripts")

# --- WiX (Windows) ------------------------------------------------------------------------------
# Constant upgrade GUID: every release shares it so MajorUpgrade replaces the previous
# installation in place. Never change it.
set(CPACK_WIX_VERSION 4)
set(CPACK_WIX_UPGRADE_GUID "4EE6A25D-B378-4A18-83A4-01A5F62C214E")
set(CPACK_WIX_PRODUCT_ICON "${CMAKE_SOURCE_DIR}/app/win/mfbe.ico")
set(CPACK_WIX_TEMPLATE "${CMAKE_SOURCE_DIR}/packaging/wix/mfbe.template.in")
# shell-integration.wxs: file associations, Default Programs, the optional desktop shortcut and
# its INSTALLDESKTOPSHORTCUT property; ui.wxs: the dialog set WixUI_MfbeInstallDir (the stock
# InstallDir flow with the "Create a shortcut on the desktop" checkbox), referenced by the
# template through CPACK_WIX_UI_REF (feature 003, User Story 7).
set(CPACK_WIX_EXTRA_SOURCES
  "${CMAKE_SOURCE_DIR}/packaging/wix/shell-integration.wxs"
  "${CMAKE_SOURCE_DIR}/packaging/wix/ui.wxs")
set(CPACK_WIX_PATCH_FILE "${CMAKE_SOURCE_DIR}/packaging/wix/feature.patch.xml")
set(CPACK_WIX_UI_REF "WixUI_MfbeInstallDir")
set(CPACK_WIX_PROGRAM_MENU_FOLDER "${MFBE_PRODUCT_NAME}")
set(CPACK_WIX_ARCHITECTURE "x64")
set(CPACK_WIX_CULTURES "en-US")
set(CPACK_WIX_PROPERTY_ARPHELPLINK "${MFBE_URL}")
set(CPACK_WIX_PROPERTY_ARPURLINFOABOUT "${MFBE_URL}")
# ARPNOMODIFY is defined by the dialog set (packaging/wix/ui.wxs, as the stock WixUI_InstallDir
# does in WiX v5+) - a duplicate Property otherwise.
set(CPACK_WIX_ROOT_FEATURE_TITLE "${MFBE_PRODUCT_NAME}")
set(CPACK_WIX_ROOT_FEATURE_DESCRIPTION "${PROJECT_DESCRIPTION}")

# --- macOS: ad-hoc signature of the installed bundle ------------------------------------------
# Developer installs (`cmake --install`, no component selection) sign the bundle once every
# component has been copied; CPack's DragNDrop run does the same through
# packaging/macos/CPackPreBuild.cmake before the .dmg is created (T145).
if(APPLE AND MFBE_BUILD_APP)
  install(CODE "
    if(NOT CMAKE_INSTALL_COMPONENT)
      set(_bundle \"\$ENV{DESTDIR}\${CMAKE_INSTALL_PREFIX}/${MFBE_APP_BUNDLE_NAME}\")
      if(IS_DIRECTORY \"\${_bundle}\")
        message(STATUS \"Ad-hoc signing \${_bundle}\")
        execute_process(COMMAND codesign --force --deep --sign - \"\${_bundle}\"
          RESULT_VARIABLE _codesign_result)
        if(NOT _codesign_result EQUAL 0)
          message(WARNING \"codesign failed (\${_codesign_result}); the bundle is unsigned\")
        endif()
      endif()
    endif()")
endif()

# Default generators of the `package` build target (the package presets list the same ones).
if(NOT CPACK_GENERATOR)
  if(WIN32)
    set(CPACK_GENERATOR "WIX;ZIP")
  elseif(APPLE)
    set(CPACK_GENERATOR "DragNDrop")
  else()
    set(CPACK_GENERATOR "DEB;RPM;External")
  endif()
endif()

set(CPACK_PROJECT_CONFIG_FILE "${CMAKE_SOURCE_DIR}/packaging/CPackConfig.cmake")

include(CPack)

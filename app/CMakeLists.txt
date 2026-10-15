# mfbe - the CEF desktop shell (T034).
#
# Targets
#   mfbe_app_bridge  static library with the two translation units that talk to the
#                    in-process core (core_host.cpp, dialog_provider.cpp). The core uses
#                    exceptions and RTTI, so these files are compiled with the project's
#                    normal flags (mfbe::options) plus the CEF include path and defines,
#                    but WITHOUT CEF's -fno-exceptions/-fno-rtti/-Werror. Exceptions never
#                    cross into CEF code: every call into the core is wrapped in try/catch
#                    inside the bridge and reported as an error string / empty result.
#   mfbe             the browser-process executable (Linux: the same binary also serves as
#                    the Chromium sub-process executable; Windows: DLL + CEF bootstrap.exe
#                    when the sandbox is enabled; macOS: app bundle + 5 helper bundles).
#
# The CEF binary distribution is resolved (downloaded on first use) by
# cmake/FindCEFDistribution.cmake. Patterns follow tests/cefsimple/CMakeLists.txt.in of
# the CEF source tree (branch 7871 = CEF 150).

# ---------------------------------------------------------------------------------------------
# CEF API version pin.
#
# cef_variables.cmake appends CEF_API_VERSION=${api_version} to CEF_COMPILER_DEFINES when the
# variable `api_version` is defined; that makes libcef_dll_wrapper and every target configured
# with SET_*_TARGET_PROPERTIES() use the same explicit API version, which is required for the
# C++ wrapper vtables to match. An explicit version (instead of the default "experimental")
# gives back/forward ABI compatibility, so libcef binaries can be updated without recompiling
# the shell (https://chromiumembedded.github.io/cef/api_versioning). 15000 is
# CEF_API_VERSION_LAST of the pinned distribution (include/cef_api_versions.h).
set(MFBE_CEF_API_VERSION "15000" CACHE STRING
  "Explicit CEF_API_VERSION compiled into the shell and libcef_dll_wrapper (5 digits)")
if(NOT DEFINED api_version)
  set(api_version "${MFBE_CEF_API_VERSION}")
endif()

if(WIN32)
  # libcef_dll_wrapper and the shell use the static runtime (/MT) too, like every other target
  # (CMAKE_MSVC_RUNTIME_LIBRARY, vcpkg triplet x64-windows-static). A plain variable: a value
  # cached by an older configuration does not override it.
  set(CEF_RUNTIME_LIBRARY_FLAG "/MT")
endif()

find_package(CEFDistribution REQUIRED)

# libcef_dll_wrapper (static, built from the distribution sources with CEF's flags).
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

if(NOT OS_MAC)
  # Logical target used to link the libcef library (the minimal distribution ships Release
  # binaries only; FindCEFDistribution.cmake maps the Debug paths onto them).
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
endif()

# ---------------------------------------------------------------------------------------------
# Common definitions for both targets.

# Version stamps (shared by the bridge and the executable).
set(MFBE_SHELL_VERSION_DEFINES
  MFBE_PRODUCT_NAME="${MFBE_PRODUCT_NAME}"
  MFBE_VERSION="${MFBE_VERSION}"
  MFBE_VERSION_RC=${PROJECT_VERSION_MAJOR},${PROJECT_VERSION_MINOR},${PROJECT_VERSION_PATCH},0
  MFBE_BUILD_ID="${MFBE_BUILD_ID}"
  MFBE_GIT_HASH="${MFBE_GIT_HASH}"
  MFBE_BUILD_DATE="${MFBE_BUILD_DATE}"
  MFBE_HOMEPAGE_URL="${MFBE_URL}")

# Executable-only defines.
set(MFBE_SHELL_DEFINES
  ${MFBE_SHELL_VERSION_DEFINES}
  # Development fallbacks for locating bundled data when running from the build tree.
  MFBE_RESOURCES_SOURCE_DIR="${MFBE_RESOURCES_SOURCE_DIR}"
  MFBE_SCRIPTS_SOURCE_DIR="${MFBE_SCRIPTS_SOURCE_DIR}"
  MFBE_UI_SOURCE_DIR="${MFBE_UI_SOURCE_DIR}"
  # F12 opens DevTools in Debug builds (and always when --remote-debugging-port is given).
  $<$<CONFIG:Debug>:MFBE_SHELL_DEVTOOLS=1>
  $<$<BOOL:${MFBE_TEST_HOOKS}>:MFBE_SHELL_TEST_HOOKS=1>)

# ---------------------------------------------------------------------------------------------
# Pure shell logic without CEF types (file dialog requests in each platform's terms, the
# right-click menu, the latest-release request), shared by the bridge, the shell and the
# mfbe_shell_tests executable (tests/shell).

add_library(mfbe_shell_logic STATIC
  src/context_menu.cpp
  src/context_menu.h
  src/file_dialog_request.cpp
  src/file_dialog_request.h
  src/permission_policy.cpp
  src/permission_policy.h
  src/release_request.cpp
  src/release_request.h)
target_include_directories(mfbe_shell_logic PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(mfbe_shell_logic PUBLIC mfbe_paths PRIVATE mfbe::options)

# ---------------------------------------------------------------------------------------------
# Core bridge library (compiled with exceptions; see header comment). native_actions.cpp is
# plain C++ (file manager, clipboard, external URLs) and lives here so both the bridge and
# the shell sources can call it. The platform file dialogs (file_dialog_platform.h) are plain
# C++ too: one implementation per platform.

set(MFBE_BRIDGE_SRCS
  src/clipboard_bridge.cpp
  src/clipboard_bridge.h
  src/core_host.cpp
  src/core_host.h
  src/dialog_provider.cpp
  src/dialog_provider.h
  src/file_dialog_platform.h
  src/native_actions.cpp
  src/native_actions.h)
if(OS_WINDOWS)
  list(APPEND MFBE_BRIDGE_SRCS src/file_dialog_win.cpp)
elseif(OS_MAC)
  list(APPEND MFBE_BRIDGE_SRCS src/file_dialog_mac.mm src/native_actions_mac.mm)
elseif(OS_LINUX)
  list(APPEND MFBE_BRIDGE_SRCS src/file_dialog_gtk.cpp)
endif()

add_library(mfbe_app_bridge STATIC ${MFBE_BRIDGE_SRCS})

target_compile_definitions(mfbe_app_bridge PRIVATE ${MFBE_SHELL_VERSION_DEFINES})
target_include_directories(mfbe_app_bridge SYSTEM PRIVATE ${CEF_INCLUDE_PATH})

# CEF preprocessor defines (CEF_API_VERSION, CEF_USE_SANDBOX, _FILE_OFFSET_BITS, ...) are
# needed so the CEF headers seen by the bridge match the wrapper. Drop the MSVC
# _HAS_EXCEPTIONS=0 define: this library deliberately keeps exceptions enabled.
set(_bridge_defines ${CEF_COMPILER_DEFINES})
list(FILTER _bridge_defines EXCLUDE REGEX "^_HAS_EXCEPTIONS")
target_compile_definitions(mfbe_app_bridge PRIVATE
  ${_bridge_defines}
  $<$<CONFIG:Debug>:${CEF_COMPILER_DEFINES_DEBUG}>
  $<$<CONFIG:Release>:${CEF_COMPILER_DEFINES_RELEASE}>)
unset(_bridge_defines)

# All dependencies are PRIVATE: for a static library CMake still forwards them to the final
# link ($<LINK_ONLY:...>), but their compile options/defines (mfbe::options warnings, the
# core's public defines) must not leak into the CEF-flagged executable sources.
target_link_libraries(mfbe_app_bridge PRIVATE mfbe::options mfbe_paths mfbe_shell_logic
  libcef_dll_wrapper)
if(NOT OS_MAC)
  target_link_libraries(mfbe_app_bridge PRIVATE libcef_lib)
endif()
if(OS_POSIX)
  target_compile_options(mfbe_app_bridge PRIVATE -fPIC -pthread)
  find_package(Threads REQUIRED)
  target_link_libraries(mfbe_app_bridge PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
endif()
if(OS_WINDOWS)
  # Common Item Dialog (COM) for the file dialogs.
  target_link_libraries(mfbe_app_bridge PRIVATE ole32 shell32 uuid)
endif()
if(OS_MAC)
  target_link_libraries(mfbe_app_bridge PRIVATE "-framework Cocoa"
    "-framework UniformTypeIdentifiers")
  set_source_files_properties(src/native_actions_mac.mm src/file_dialog_mac.mm
    PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
endif()

# The in-process core. Linking it makes <mfbe/core_server.hpp> and <mfbe/dialog_provider.hpp>
# visible; core_host.cpp / dialog_provider.cpp enable the real integration with
# `#if __has_include(<mfbe/core_server.hpp>)` and fall back to the --url developer override
# otherwise, so the shell builds and runs before the core server lands.
# MFBE_APP_WITH_CORE=OFF builds the shell without any core dependency (standalone smoke
# testing while the core is under construction).
option(MFBE_APP_WITH_CORE "Link the in-process core (mfbe::core) into the shell" ON)
if(MFBE_APP_WITH_CORE AND TARGET mfbe::core)
  target_link_libraries(mfbe_app_bridge PRIVATE mfbe::core)
  message(STATUS "mfbe shell: linking the in-process core (mfbe::core)")
elseif(MFBE_APP_WITH_CORE)
  message(STATUS "mfbe shell: mfbe::core target not found - shell requires --url <http url>")
else()
  message(STATUS "mfbe shell: MFBE_APP_WITH_CORE=OFF - shell requires --url <http url>")
endif()

# ---------------------------------------------------------------------------------------------
# Shell sources (compiled with CEF's flags: -fno-exceptions -fno-rtti -Werror ...).

set(MFBE_SHELL_SRCS
  src/command_line.cpp
  src/command_line.h
  src/mfbe_app.cpp
  src/mfbe_app.h
  src/mfbe_client.cpp
  src/mfbe_client.h
  src/sandbox_check.cpp
  src/sandbox_check.h
  src/shell_runner.cpp
  src/shell_runner.h
  src/single_instance.cpp
  src/single_instance.h
  src/user_dirs.cpp
  src/user_dirs.h
  src/window.cpp
  src/window.h)
set(MFBE_SHELL_SRCS_LINUX src/main.cpp)
set(MFBE_SHELL_SRCS_WINDOWS src/main.cpp win/app.rc win/resource.h)
set(MFBE_SHELL_SRCS_MAC src/main_mac.mm)
APPEND_PLATFORM_SOURCES(MFBE_SHELL_SRCS)

set(MFBE_HELPER_SRCS_MAC src/helper_main.cpp)
APPEND_PLATFORM_SOURCES(MFBE_HELPER_SRCS)

set(MFBE_TARGET "mfbe")
set(MFBE_TARGET_OUT_DIR "${CMAKE_BINARY_DIR}/bin")

# Applies the shell defines and links the bridge + CEF to an executable/library target.
function(mfbe_shell_configure_target target)
  target_compile_definitions(${target} PRIVATE ${MFBE_SHELL_DEFINES})
  add_dependencies(${target} libcef_dll_wrapper)
  target_link_libraries(${target} mfbe_app_bridge mfbe_paths mfbe_shell_logic libcef_dll_wrapper
    ${CEF_STANDARD_LIBS})
  if(NOT OS_MAC)
    target_link_libraries(${target} libcef_lib)
  endif()
endfunction()

# Window/app icons (PNG, loaded at runtime via CefImage) live in resources/icons/app/.
set(MFBE_ICON_DIR "${MFBE_RESOURCES_SOURCE_DIR}/icons/app")

# ---------------------------------------------------------------------------------------------
# Linux

if(OS_LINUX)
  # Libraries are looked up next to the executable ($ORIGIN below), never in the working
  # directory: CEF's linker flags add "." to the run path.
  list(REMOVE_ITEM CEF_LINKER_FLAGS "-Wl,-rpath,.")

  add_executable(${MFBE_TARGET} ${MFBE_SHELL_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(${MFBE_TARGET})
  mfbe_shell_configure_target(${MFBE_TARGET})
  # The statically linked libraries (libpng, zlib, ...) stay private to the executable: exported,
  # they would replace the system copies that GTK and its image loaders use in this process.
  target_link_options(${MFBE_TARGET} PRIVATE "LINKER:--exclude-libs,ALL")

  # libcef.so and friends are placed next to the executable.
  set_target_properties(${MFBE_TARGET} PROPERTIES
    INSTALL_RPATH "$ORIGIN"
    BUILD_WITH_INSTALL_RPATH TRUE
    RUNTIME_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}")

  # Copy binary and resource files to the output directory.
  COPY_FILES("${MFBE_TARGET}" "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${MFBE_TARGET_OUT_DIR}")
  COPY_FILES("${MFBE_TARGET}" "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${MFBE_TARGET_OUT_DIR}")
  if(EXISTS "${CEF_BINARY_DIR}/libminigbm.so")
    COPY_FILES("${MFBE_TARGET}" "libminigbm.so" "${CEF_BINARY_DIR}" "${MFBE_TARGET_OUT_DIR}")
  endif()

  # chrome-sandbox must be root-owned and SUID (4755) for the Chromium sandbox; the .deb/.rpm
  # set that in their post-install step (packaging/deb-rpm). The build only prints the manual
  # command; sandbox_check.cpp falls back to --no-sandbox when neither the helper nor user
  # namespaces are usable.
  SET_LINUX_SUID_PERMISSIONS("${MFBE_TARGET}" "${MFBE_TARGET_OUT_DIR}/chrome-sandbox")

  # Install (cmake/InstallLayout.cmake): the executable and every CEF file in lib/mfbe,
  # bin/mfbe as a symlink, desktop integration under share/.
  install(TARGETS ${MFBE_TARGET} RUNTIME DESTINATION "${MFBE_INSTALL_LIBDIR}" COMPONENT app)
  mfbe_install_bin_symlink(${MFBE_TARGET} "../${MFBE_INSTALL_LIBDIR}/${MFBE_TARGET}" app)
  set(_cef_binary_files ${CEF_BINARY_FILES})
  if(EXISTS "${CEF_BINARY_DIR}/libminigbm.so")
    list(APPEND _cef_binary_files libminigbm.so)
  endif()
  mfbe_install_cef_files(app "${CEF_BINARY_DIR}" "${_cef_binary_files}"
    "${CEF_RESOURCE_DIR}" "${CEF_RESOURCE_FILES}")
  unset(_cef_binary_files)

  # Desktop integration: launcher, MIME type, hicolor icons.
  install(FILES linux/mfbe.desktop DESTINATION share/applications COMPONENT app)
  install(FILES linux/mfbe.xml DESTINATION share/mime/packages COMPONENT app)
  foreach(_size 16 32 48 64 128 256)
    install(FILES "${MFBE_ICON_DIR}/mfbe-${_size}.png"
      DESTINATION "share/icons/hicolor/${_size}x${_size}/apps"
      RENAME mfbe.png COMPONENT app)
  endforeach()
endif()

# ---------------------------------------------------------------------------------------------
# macOS (app bundle + helper bundles; cefsimple pattern)

if(OS_MAC)
  option(OPTION_USE_ARC "Build with ARC (automatic Reference Counting) on macOS." ON)
  if(OPTION_USE_ARC)
    list(APPEND CEF_COMPILER_FLAGS -fobjc-arc)
  endif()

  set(MFBE_HELPER_TARGET "mfbe_Helper")
  set(MFBE_HELPER_OUTPUT_NAME "mfbe Helper")
  set(MFBE_APP "${MFBE_TARGET_OUT_DIR}/${MFBE_TARGET}.app")

  # Variables referenced from Info.plist.in.
  set(EXECUTABLE_NAME "${MFBE_TARGET}")
  set(PRODUCT_NAME "${MFBE_PRODUCT_NAME}")
  set(VERSION_SHORT "${MFBE_VERSION}")

  set(MFBE_BUNDLE_RESOURCES mac/mfbe.icns)

  add_executable(${MFBE_TARGET} MACOSX_BUNDLE ${MFBE_BUNDLE_RESOURCES} ${MFBE_SHELL_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(${MFBE_TARGET})
  mfbe_shell_configure_target(${MFBE_TARGET})
  set_target_properties(${MFBE_TARGET} PROPERTIES
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in"
    RUNTIME_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}"
    CLANG_ENABLE_OBJC_ARC "YES")

  # Copy the CEF framework into the Frameworks directory and create the necessary symlinks.
  COPY_MAC_FRAMEWORK("${MFBE_TARGET}" "${CEF_BINARY_DIR}" "${MFBE_APP}")

  # Create the multiple Helper app bundle targets.
  foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
    string(REPLACE ":" ";" _suffix_list ${_suffix_list})
    list(GET _suffix_list 0 _name_suffix)
    list(GET _suffix_list 1 _target_suffix)
    list(GET _suffix_list 2 _plist_suffix)

    set(_helper_target "${MFBE_HELPER_TARGET}${_target_suffix}")
    set(_helper_output_name "${MFBE_HELPER_OUTPUT_NAME}${_name_suffix}")

    # Helper-specific Info.plist (configure_file would use the global variables).
    set(_helper_info_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" _plist_contents)
    string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
    string(REPLACE "\${PRODUCT_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
    string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist_contents "${_plist_contents}")
    string(REPLACE "\${VERSION_SHORT}" "${VERSION_SHORT}" _plist_contents "${_plist_contents}")
    file(WRITE "${_helper_info_plist}" "${_plist_contents}")

    add_executable(${_helper_target} MACOSX_BUNDLE ${MFBE_HELPER_SRCS})
    SET_EXECUTABLE_TARGET_PROPERTIES(${_helper_target})
    add_dependencies(${_helper_target} libcef_dll_wrapper)
    target_link_libraries(${_helper_target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${_helper_target} PROPERTIES
      MACOSX_BUNDLE_INFO_PLIST "${_helper_info_plist}"
      OUTPUT_NAME "${_helper_output_name}"
      RUNTIME_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}")

    add_dependencies(${MFBE_TARGET} "${_helper_target}")

    # Copy the Helper app bundle into the Frameworks directory.
    add_custom_command(
      TARGET ${MFBE_TARGET}
      POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
              "${MFBE_TARGET_OUT_DIR}/${_helper_output_name}.app"
              "${MFBE_APP}/Contents/Frameworks/${_helper_output_name}.app"
      VERBATIM)
  endforeach()

  # Bundle resources (icon); the "mac/" prefix is stripped from the destination path.
  COPY_MAC_RESOURCES("${MFBE_BUNDLE_RESOURCES}" "mac/" "${MFBE_TARGET}" "${CMAKE_CURRENT_SOURCE_DIR}" "${MFBE_APP}")

  # Ad-hoc signature of the build-tree bundle (after the framework, helpers and resources were
  # copied; POST_BUILD steps run in the order they were added). Apple Silicon refuses to start
  # unsigned code and `--deep` re-seals the nested helper bundles. The installed/packaged
  # bundle is signed again by cmake/MfbePackaging.cmake / packaging/macos (T145).
  find_program(MFBE_CODESIGN_EXECUTABLE codesign)
  if(MFBE_CODESIGN_EXECUTABLE)
    add_custom_command(
      TARGET ${MFBE_TARGET}
      POST_BUILD
      COMMAND "${MFBE_CODESIGN_EXECUTABLE}" --force --deep --sign - "${MFBE_APP}"
      COMMENT "Ad-hoc signing ${MFBE_APP}"
      VERBATIM)
  endif()

  # Install the whole bundle; resources/ui/scripts are added to Contents/Resources by their
  # own install rules (MFBE_INSTALL_DATADIR) and the installed bundle is ad-hoc signed by
  # cmake/MfbePackaging.cmake (T145) before the DragNDrop generator wraps it in a .dmg.
  install(DIRECTORY "${MFBE_APP}" DESTINATION . COMPONENT app USE_SOURCE_PERMISSIONS)
endif()

# ---------------------------------------------------------------------------------------------
# Windows

if(OS_WINDOWS)
  if(USE_SANDBOX)
    # Since CEF 138 the sandboxed browser process is CEF's signed bootstrap.exe loading the
    # application as a DLL that exports RunWinMain (see main.cpp, CEF_USE_BOOTSTRAP).
    add_library(${MFBE_TARGET} SHARED ${MFBE_SHELL_SRCS})
    SET_LIBRARY_TARGET_PROPERTIES(${MFBE_TARGET})
    set_target_properties(${MFBE_TARGET} PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}"
      LIBRARY_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}")
    # Copy and rename the bootstrap binary, then give it the editor's icon, version information
    # and manifest (Explorer, the Start menu and the taskbar show the executable's resources;
    # Windows reads the process manifest - UTF-8 code page, DPI awareness - only from the
    # executable; the bootstrap carries CEF's generic ones). win/stamp_resources.cpp is a plain
    # Win32 tool.
    add_executable(mfbe_stamp_resources win/stamp_resources.cpp)
    target_link_libraries(mfbe_stamp_resources PRIVATE mfbe::options)
    set_target_properties(mfbe_stamp_resources PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/tools" FOLDER "tools")
    add_dependencies(${MFBE_TARGET} mfbe_stamp_resources)
    COPY_SINGLE_FILE(${MFBE_TARGET} "${CEF_BINARY_DIR}/bootstrap.exe" "${MFBE_TARGET_OUT_DIR}/${MFBE_TARGET}.exe")
    add_custom_command(TARGET ${MFBE_TARGET} POST_BUILD
      COMMAND "$<TARGET_FILE:mfbe_stamp_resources>"
              "${MFBE_TARGET_OUT_DIR}/${MFBE_TARGET}.exe"
              "${CMAKE_CURRENT_SOURCE_DIR}/win/mfbe.ico"
              "$<TARGET_FILE:${MFBE_TARGET}>"
              "${CMAKE_CURRENT_SOURCE_DIR}/win/app.manifest"
      COMMENT "Stamping icon, version information and manifest into ${MFBE_TARGET}.exe"
      VERBATIM)
    if(CMAKE_GENERATOR MATCHES "Visual Studio")
      set_target_properties(${MFBE_TARGET} PROPERTIES
        VS_DEBUGGER_COMMAND "$<TARGET_FILE_DIR:${MFBE_TARGET}>/${MFBE_TARGET}.exe")
    endif()
    # The stamped copy is what gets installed (not CEF's pristine bootstrap).
    install(PROGRAMS "${MFBE_TARGET_OUT_DIR}/${MFBE_TARGET}.exe" DESTINATION bin COMPONENT app)
    install(TARGETS ${MFBE_TARGET} RUNTIME DESTINATION bin COMPONENT app)
  else()
    # Plain executable; the manifest (per-monitor-v2 DPI, UTF-8 code page, common controls)
    # is embedded through win/app.rc, so no mt.exe post-build step is needed.
    add_executable(${MFBE_TARGET} WIN32 ${MFBE_SHELL_SRCS})
    SET_EXECUTABLE_TARGET_PROPERTIES(${MFBE_TARGET})
    set_target_properties(${MFBE_TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${MFBE_TARGET_OUT_DIR}")
    install(TARGETS ${MFBE_TARGET} RUNTIME DESTINATION bin COMPONENT app)
  endif()
  mfbe_shell_configure_target(${MFBE_TARGET})
  target_include_directories(${MFBE_TARGET} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/win")

  COPY_FILES("${MFBE_TARGET}" "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${MFBE_TARGET_OUT_DIR}")
  COPY_FILES("${MFBE_TARGET}" "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${MFBE_TARGET_OUT_DIR}")

  if(USE_SANDBOX)
    # LPAC ACLs required for Windows sandbox support. CEF's macro reads CEF_TARGET_OUT_DIR
    # (cefsimple's name for the output directory); icacls needs a native path.
    file(TO_NATIVE_PATH "${MFBE_TARGET_OUT_DIR}" CEF_TARGET_OUT_DIR)
    SET_LPAC_ACLS("${MFBE_TARGET}")
  endif()

  # Flat layout: every CEF DLL/resource next to mfbe.exe in bin/ (cmake/InstallLayout.cmake).
  mfbe_install_cef_files(app "${CEF_BINARY_DIR}" "${CEF_BINARY_FILES}"
    "${CEF_RESOURCE_DIR}" "${CEF_RESOURCE_FILES}")
endif()

PRINT_CEF_CONFIG()
message(STATUS "mfbe shell: CEF ${CEFDistribution_VERSION}, CEF_API_VERSION=${api_version}, "
  "output ${MFBE_TARGET_OUT_DIR}")

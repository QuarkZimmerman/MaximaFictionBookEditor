cmake_minimum_required(VERSION 3.30)

# vcpkg manifest features must be set before project()
option(MFBE_BUILD_TESTS "Build the core test suite" ON)
if(MFBE_BUILD_TESTS)
  list(APPEND VCPKG_MANIFEST_FEATURES "tests")
endif()

project(MaximaFictionBookEditor
  VERSION 0.0.6
  DESCRIPTION "Maxima Fiction Book Editor - cross-platform FictionBook 2 editor"
  HOMEPAGE_URL "https://github.com/QuarkZimmerman/MaximaFictionBookEditor"
  LANGUAGES C CXX)
# The pre-release part of the version label: 0.0.6-rc, and 0.0.6-rc.N from a release tag
# v0.0.6-rc.N (cmake/MfbeVersion.cmake). It is emptied only for a final version, on the
# requester's word (feature 006, FR-054).
set(MFBE_VERSION_PRERELEASE "rc")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Windows: the C/C++ runtime is linked into every binary (vcpkg triplet x64-windows-static, CEF's
# /MT), so the package needs no Visual C++ Redistributable.
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

option(MFBE_BUILD_APP "Build the desktop shell (requires the CEF binary distribution)" OFF)
option(MFBE_TEST_HOOKS "Compile the test-only RPC hooks (dev/test builds only)" OFF)
option(MFBE_BUILD_UI "Build the web UI bundle with npm as part of the CMake build" OFF)
option(MFBE_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

include(MfbeCompilerOptions)
include(MfbeVersion)

set(MFBE_RESOURCES_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/resources")
set(MFBE_SCRIPTS_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/scripts")
set(MFBE_UI_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui")

include(InstallLayout)  # install tree shared by core/, app/, resources/, ui/ and packaging

if(MFBE_BUILD_TESTS)
  enable_testing()
endif()

add_subdirectory(core)

if(MFBE_BUILD_UI)
  add_subdirectory(ui)
endif()

if(MFBE_BUILD_APP)
  add_subdirectory(app)
  # The packages carry the licence text of every third-party component (MIT, BSD, Apache-2.0
  # and the others require it with binaries): tools/licence-check.py exports them, failing the
  # build when a licence breaks the policy. It reads the vcpkg tree, ui/node_modules (after the
  # UI build's npm ci) and the CEF distribution.
  find_package(Python3 COMPONENTS Interpreter REQUIRED)
  set(MFBE_LICENCE_TEXTS_DIR "${CMAKE_BINARY_DIR}/licenses")
  add_custom_target(mfbe_licence_texts ALL
    COMMAND "${CMAKE_COMMAND}" -E rm -rf "${MFBE_LICENCE_TEXTS_DIR}"
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/tools/licence-check.py"
            --vcpkg-installed "${VCPKG_INSTALLED_DIR}" --vcpkg-triplet "${VCPKG_TARGET_TRIPLET}"
            --export-texts "${MFBE_LICENCE_TEXTS_DIR}"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Third-party licence texts for the packages"
    VERBATIM)
  if(TARGET mfbe_ui)
    add_dependencies(mfbe_licence_texts mfbe_ui)
  endif()
  install(DIRECTORY "${MFBE_LICENCE_TEXTS_DIR}/"
    DESTINATION "${MFBE_INSTALL_DOCDIR}/licenses" COMPONENT app)
endif()

add_subdirectory(resources)

if(MFBE_BUILD_TESTS)
  add_subdirectory(tests)
endif()

include(MfbePackaging)

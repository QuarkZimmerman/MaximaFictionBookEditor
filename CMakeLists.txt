cmake_minimum_required(VERSION 3.30)

# vcpkg manifest features must be set before project()
option(MFBE_BUILD_TESTS "Build the core test suite" ON)
if(MFBE_BUILD_TESTS)
  list(APPEND VCPKG_MANIFEST_FEATURES "tests")
endif()

project(MaximaFictionBookEditor
  VERSION 0.0.1
  DESCRIPTION "Maxima Fiction Book Editor - cross-platform FictionBook 2 editor"
  HOMEPAGE_URL "https://github.com/QuarkZimmerman/MaximaFictionBookEditor"
  LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

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
endif()

add_subdirectory(resources)

if(MFBE_BUILD_TESTS)
  add_subdirectory(tests)
endif()

include(MfbePackaging)

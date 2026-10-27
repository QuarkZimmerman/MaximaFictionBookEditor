# Unit tests of the CEF shell's logic without CEF types (feature 002): how a file dialog request
# becomes each platform's dialog, the right-click menu, the latest-release request and (feature
# 003) the command line. Built with the application presets; the CI app jobs run them with
# `ctest -L shell`.
find_package(Catch2 3 CONFIG REQUIRED)

file(GLOB MFBE_SHELL_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
add_executable(mfbe_shell_tests ${MFBE_SHELL_TEST_SOURCES})
target_link_libraries(mfbe_shell_tests PRIVATE mfbe_shell_logic mfbe::options
  Catch2::Catch2WithMain)
# The --version case compares versionText() with the configured version stamps (feature 006),
# which the logic library has as private definitions.
target_compile_definitions(mfbe_shell_tests PRIVATE
  MFBE_VERSION="${MFBE_VERSION}"
  MFBE_BUILD_ID="${MFBE_BUILD_ID}"
  MFBE_BUILD_DATE="${MFBE_BUILD_DATE}")
include(Catch)
catch_discover_tests(mfbe_shell_tests PROPERTIES LABELS shell)

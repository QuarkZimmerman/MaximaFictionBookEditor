add_subdirectory(core)

# The shell's pure logic (mfbe_shell_logic) is built with the application presets.
if(TARGET mfbe_shell_logic)
  add_subdirectory(shell)
endif()

# The version forms of cmake/MfbeVersion.cmake (feature 006, contracts/installer.md "Tests"): a
# cmake -P script, run by the core legs of CI (ctest ... -LE corpus).
add_test(NAME version_forms
  COMMAND ${CMAKE_COMMAND} -P ${CMAKE_SOURCE_DIR}/tests/cmake/version_forms.cmake)
set_tests_properties(version_forms PROPERTIES LABELS version)

add_subdirectory(core)

# The shell's pure logic (mfbe_shell_logic) is built with the application presets.
if(TARGET mfbe_shell_logic)
  add_subdirectory(shell)
endif()

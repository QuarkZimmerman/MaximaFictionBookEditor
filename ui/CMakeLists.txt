# Builds the web UI bundle with npm as part of the CMake build (MFBE_BUILD_UI=ON)
# and installs it as data for the core/shell to serve.

find_program(NPM_EXECUTABLE NAMES npm npm.cmd REQUIRED)

set(MFBE_UI_DIST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/dist")
set(MFBE_UI_STAMP "${CMAKE_CURRENT_BINARY_DIR}/ui-build.stamp")

file(GLOB_RECURSE _mfbe_ui_sources CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/src/*"
  "${CMAKE_CURRENT_SOURCE_DIR}/public/*"
  "${CMAKE_CURRENT_SOURCE_DIR}/index.html"
  "${CMAKE_CURRENT_SOURCE_DIR}/vite.config.ts"
  "${CMAKE_CURRENT_SOURCE_DIR}/tsconfig.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/package.json")

add_custom_command(
  OUTPUT "${MFBE_UI_STAMP}"
  COMMAND "${CMAKE_COMMAND}" -E echo "Installing UI dependencies (npm ci)"
  COMMAND "${NPM_EXECUTABLE}" ci --no-audit --no-fund --loglevel=error
  COMMAND "${CMAKE_COMMAND}" -E echo "Building UI bundle (npm run build)"
  COMMAND "${NPM_EXECUTABLE}" run --silent build
  COMMAND "${CMAKE_COMMAND}" -E touch "${MFBE_UI_STAMP}"
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  DEPENDS ${_mfbe_ui_sources} "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json"
  COMMENT "Maxima FB Editor UI bundle"
  VERBATIM)

add_custom_target(mfbe_ui ALL DEPENDS "${MFBE_UI_STAMP}")

# <MFBE_INSTALL_DATADIR>/ui: share/mfbe/ui (Linux/Windows), mfbe.app/Contents/Resources/ui
# (macOS); see cmake/InstallLayout.cmake.
install(DIRECTORY "${MFBE_UI_DIST_DIR}/"
  DESTINATION "${MFBE_INSTALL_DATADIR}/ui"
  COMPONENT ui)

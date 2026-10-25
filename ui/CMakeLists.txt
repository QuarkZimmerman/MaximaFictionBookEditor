# Builds the web UI bundle with npm as part of the CMake build (MFBE_BUILD_UI=ON)
# and installs it as data for the core/shell to serve.

# npm runs on the build host. On Windows npm.cmd comes first: the extensionless "npm" beside it
# is a script for POSIX shells, which `cmake -E env` below cannot start ("inappropriate file type
# or format"); cmd.exe used to find npm.cmd for it, but `cmake -E env` starts the file it is given.
if(CMAKE_HOST_WIN32)
  find_program(NPM_EXECUTABLE NAMES npm.cmd npm REQUIRED)
else()
  find_program(NPM_EXECUTABLE NAMES npm npm.cmd REQUIRED)
endif()

set(MFBE_UI_DIST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/dist")
set(MFBE_UI_STAMP "${CMAKE_CURRENT_BINARY_DIR}/ui-build.stamp")

file(GLOB_RECURSE _mfbe_ui_sources CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/src/*"
  "${CMAKE_CURRENT_SOURCE_DIR}/public/*"
  "${CMAKE_CURRENT_SOURCE_DIR}/index.html"
  "${CMAKE_CURRENT_SOURCE_DIR}/vite.config.ts"
  "${CMAKE_CURRENT_SOURCE_DIR}/tsconfig.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/package.json")

# The bundle shows the version label (MFBE_UI_VERSION, cmake/MfbeVersion.cmake; feature 006),
# which vite.config.ts takes from the environment. The file holding it is rewritten only when
# the label changes, so a reused build folder rebuilds the bundle for another label.
set(MFBE_UI_VERSION_FILE "${CMAKE_CURRENT_BINARY_DIR}/ui-version.txt")
file(CONFIGURE OUTPUT "${MFBE_UI_VERSION_FILE}" CONTENT "${MFBE_UI_VERSION}\n" @ONLY)

add_custom_command(
  OUTPUT "${MFBE_UI_STAMP}"
  COMMAND "${CMAKE_COMMAND}" -E echo "Installing UI dependencies (npm ci)"
  COMMAND "${NPM_EXECUTABLE}" ci --no-audit --no-fund --loglevel=error
  COMMAND "${CMAKE_COMMAND}" -E echo "Building UI bundle ${MFBE_UI_VERSION} (npm run build)"
  COMMAND "${CMAKE_COMMAND}" -E env "MFBE_UI_VERSION=${MFBE_UI_VERSION}"
          "${NPM_EXECUTABLE}" run --silent build
  COMMAND "${CMAKE_COMMAND}" -E touch "${MFBE_UI_STAMP}"
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  DEPENDS ${_mfbe_ui_sources} "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json"
          "${MFBE_UI_VERSION_FILE}"
  COMMENT "Maxima FB Editor UI bundle"
  VERBATIM)

add_custom_target(mfbe_ui ALL DEPENDS "${MFBE_UI_STAMP}")

# <MFBE_INSTALL_DATADIR>/ui: share/mfbe/ui (Linux/Windows), mfbe.app/Contents/Resources/ui
# (macOS); see cmake/InstallLayout.cmake.
install(DIRECTORY "${MFBE_UI_DIST_DIR}/"
  DESTINATION "${MFBE_INSTALL_DATADIR}/ui"
  COMPONENT ui)

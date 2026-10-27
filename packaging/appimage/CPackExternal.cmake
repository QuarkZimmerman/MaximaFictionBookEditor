# CPack "External" generator script: wraps packaging/appimage/build.sh (T143).
#
# CPack stages the install tree in CPACK_TEMPORARY_DIRECTORY (with
# CPACK_PACKAGING_INSTALL_PREFIX=/usr, i.e. <staging>/usr/...), then runs this script. The
# resulting AppImage (and its .zsync file) are reported through CPACK_EXTERNAL_BUILT_PACKAGES
# so `cpack` lists and copies them like any other package.
#
# Variables consumed (set in packaging/CPackConfig.cmake or on the cpack command line):
#   CPACK_MFBE_APPIMAGE_SCRIPT       path of build.sh
#   CPACK_MFBE_APPIMAGE_TOOLS_DIR    tool cache (appimagetool + runtime), default build/tools
#   CPACK_MFBE_APPIMAGE_UPDATE_INFO  zsync update information ("" = none)
#   CPACK_MFBE_APPIMAGE_ARCH         architecture suffix of the file name (x86_64, aarch64)
#   CPACK_MFBE_VERSION_LABEL         the version label (cmake/MfbePackaging.cmake), passed to
#                                    build.sh as MFBE_APPIMAGE_VERSION: the embedded desktop
#                                    file's X-AppImage-Version

if(NOT CPACK_MFBE_APPIMAGE_SCRIPT)
  message(FATAL_ERROR "CPACK_MFBE_APPIMAGE_SCRIPT is not set (see packaging/CPackConfig.cmake)")
endif()
if(NOT EXISTS "${CPACK_TEMPORARY_DIRECTORY}/usr/lib/mfbe/mfbe")
  message(FATAL_ERROR "AppImage: staged install tree ${CPACK_TEMPORARY_DIRECTORY} has no usr/lib/mfbe/mfbe "
    "(is CPACK_PACKAGING_INSTALL_PREFIX /usr and the app component installed?)")
endif()

if(NOT CPACK_MFBE_APPIMAGE_ARCH)
  set(CPACK_MFBE_APPIMAGE_ARCH "x86_64")
endif()
set(_output "${CPACK_PACKAGE_DIRECTORY}/${CPACK_PACKAGE_FILE_NAME}-${CPACK_MFBE_APPIMAGE_ARCH}.AppImage")

set(_args --install-tree "${CPACK_TEMPORARY_DIRECTORY}" --output "${_output}")
if(CPACK_MFBE_APPIMAGE_TOOLS_DIR)
  list(APPEND _args --tools-dir "${CPACK_MFBE_APPIMAGE_TOOLS_DIR}")
endif()
if(CPACK_MFBE_APPIMAGE_UPDATE_INFO)
  list(APPEND _args --update-info "${CPACK_MFBE_APPIMAGE_UPDATE_INFO}")
endif()

message(STATUS "AppImage: ${CPACK_MFBE_APPIMAGE_SCRIPT} ${_args}")
execute_process(
  COMMAND "${CMAKE_COMMAND}" -E env "MFBE_APPIMAGE_VERSION=${CPACK_MFBE_VERSION_LABEL}"
          "${CPACK_MFBE_APPIMAGE_SCRIPT}" ${_args}
  RESULT_VARIABLE _result)
if(NOT _result EQUAL 0)
  message(FATAL_ERROR "AppImage build failed (exit code ${_result})")
endif()

set(CPACK_EXTERNAL_BUILT_PACKAGES "${_output}")
if(EXISTS "${_output}.zsync")
  list(APPEND CPACK_EXTERNAL_BUILT_PACKAGES "${_output}.zsync")
endif()

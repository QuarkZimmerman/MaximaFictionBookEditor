# Version and build identification shared by core, app and packaging.

set(MFBE_VERSION "${PROJECT_VERSION}")
set(MFBE_PRODUCT_NAME "Maxima Fiction Book Editor")
set(MFBE_SHORT_NAME "mfbe")
set(MFBE_VENDOR "Quark Zimmerman")
set(MFBE_URL "${PROJECT_HOMEPAGE_URL}")

find_package(Git QUIET)
set(MFBE_GIT_HASH "unknown")
if(GIT_FOUND)
  execute_process(
    COMMAND "${GIT_EXECUTABLE}" rev-parse --short=10 HEAD
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    OUTPUT_VARIABLE _mfbe_git_hash
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET)
  if(_mfbe_git_hash)
    set(MFBE_GIT_HASH "${_mfbe_git_hash}")
  endif()
endif()

string(TIMESTAMP MFBE_BUILD_DATE "%Y-%m-%d" UTC)
set(MFBE_BUILD_ID "${MFBE_VERSION}+${MFBE_GIT_HASH}")

message(STATUS "${MFBE_PRODUCT_NAME} ${MFBE_BUILD_ID} (${MFBE_BUILD_DATE})")

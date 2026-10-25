# Version and build identification shared by core, app and packaging.
#
# The inputs (feature 006, specs/006-table-editing/contracts/installer.md "The version forms"):
# the numeric form from project(... VERSION), the pre-release part MFBE_VERSION_PRERELEASE set
# right after it (CMakeLists.txt), and the release tag from the environment variable
# MFBE_RELEASE_TAG, which only the release workflow sets (unset or empty: untagged).
# tools/version-check.py mirrors mfbe_version_forms(); this file stays the authority, and
# tests/cmake/version_forms.cmake checks it.

# mfbe_version_forms(<numeric> <prerelease> <tag> <out-prefix>)
#
# Checks <tag> against the committed version and sets in the caller's scope:
#   <out-prefix>_VERSION           the label: <numeric>-<prerelease> untagged,
#                                  <numeric>-<prerelease>.N from the tag v<numeric>-<prerelease>.N,
#                                  <numeric> when <prerelease> is empty
#   <out-prefix>_BUILD_ID          <label>+<MFBE_GIT_HASH of the calling scope>
#   <out-prefix>_VERSION_PACKAGE   the label with its first "-" turned into "~" (deb and rpm, so
#                                  that 0.0.6~rc < 0.0.6~rc.1 < ... < 0.0.6)
#   <out-prefix>_VERSION_NUMERIC   <numeric> (the fields that take numbers only)
#   <out-prefix>_UI_VERSION        the label (the UI bundle)
#   <out-prefix>_APPIMAGE_CHANNEL  "" untagged with a pre-release part (no update information),
#                                  latest-all for a tag v<numeric>-<prerelease>.N, latest for a
#                                  final
# An empty <tag> is untagged. With a pre-release part the tag must be v<numeric>-<prerelease>.N,
# N a whole number from 1 without a leading zero; without one it must be exactly v<numeric>.
# Any other tag stops with "tag <tag> does not match the committed version <committed label>".
function(mfbe_version_forms numeric prerelease tag prefix)
  if(prerelease STREQUAL "")
    set(_committed "${numeric}")
  else()
    set(_committed "${numeric}-${prerelease}")
  endif()

  set(_label "${_committed}")
  if(NOT tag STREQUAL "")
    set(_tag_ok FALSE)
    if(prerelease STREQUAL "")
      if(tag STREQUAL "v${numeric}")
        set(_tag_ok TRUE)
      endif()
    else()
      # ^v<numeric>-<prerelease>\.([1-9][0-9]*)$, compared literally so that no character of the
      # committed parts is read as a regular expression.
      set(_tag_prefix "v${_committed}.")
      string(LENGTH "${_tag_prefix}" _prefix_length)
      string(LENGTH "${tag}" _tag_length)
      if(_tag_length GREATER _prefix_length)
        string(SUBSTRING "${tag}" 0 ${_prefix_length} _tag_head)
        string(SUBSTRING "${tag}" ${_prefix_length} -1 _tag_number)
        if(_tag_head STREQUAL _tag_prefix AND _tag_number MATCHES "^[1-9][0-9]*$")
          set(_label "${_committed}.${_tag_number}")
          set(_tag_ok TRUE)
        endif()
      endif()
    endif()
    if(NOT _tag_ok)
      message(FATAL_ERROR "tag ${tag} does not match the committed version ${_committed}")
    endif()
  endif()

  string(FIND "${_label}" "-" _dash)
  if(_dash EQUAL -1)
    set(_package "${_label}")
  else()
    string(SUBSTRING "${_label}" 0 ${_dash} _package_head)
    math(EXPR _after_dash "${_dash} + 1")
    string(SUBSTRING "${_label}" ${_after_dash} -1 _package_tail)
    set(_package "${_package_head}~${_package_tail}")
  endif()

  if(prerelease STREQUAL "")
    set(_channel "latest")
  elseif(tag STREQUAL "")
    set(_channel "")
  else()
    set(_channel "latest-all")
  endif()

  set(${prefix}_VERSION "${_label}" PARENT_SCOPE)
  set(${prefix}_BUILD_ID "${_label}+${MFBE_GIT_HASH}" PARENT_SCOPE)
  set(${prefix}_VERSION_PACKAGE "${_package}" PARENT_SCOPE)
  set(${prefix}_VERSION_NUMERIC "${numeric}" PARENT_SCOPE)
  set(${prefix}_UI_VERSION "${_label}" PARENT_SCOPE)
  set(${prefix}_APPIMAGE_CHANNEL "${_channel}" PARENT_SCOPE)
endfunction()

# A cmake -P script (tests/cmake/version_forms.cmake) includes this file for the function only.
if(CMAKE_SCRIPT_MODE_FILE)
  return()
endif()

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

# The release tag, read at every configure and never cached: a reused build folder would keep a
# stale tag.
set(MFBE_RELEASE_TAG "$ENV{MFBE_RELEASE_TAG}")
mfbe_version_forms("${PROJECT_VERSION}" "${MFBE_VERSION_PRERELEASE}" "${MFBE_RELEASE_TAG}" MFBE)

if(MFBE_RELEASE_TAG STREQUAL "")
  set(_mfbe_tag_text "untagged")
else()
  set(_mfbe_tag_text "tag ${MFBE_RELEASE_TAG}")
endif()
message(STATUS "${MFBE_PRODUCT_NAME} ${MFBE_VERSION} (build ${MFBE_BUILD_ID}, ${MFBE_BUILD_DATE}; "
               "package ${MFBE_VERSION_PACKAGE}; ${_mfbe_tag_text})")

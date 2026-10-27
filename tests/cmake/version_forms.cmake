# Script test of mfbe_version_forms() (cmake/MfbeVersion.cmake): every row of the forms table of
# specs/006-table-editing/contracts/installer.md ("The version forms"), the refused tags and the
# empty tag as untagged.
#
#   cmake -P tests/cmake/version_forms.cmake       (CTest version_forms, label "version")
#
# A refused tag stops with FATAL_ERROR, so each refusal runs in a child cmake -P of this file,
# given -DMFBE_VF_PRERELEASE=<pre-release part> -DMFBE_VF_TAG=<tag>; the child calls the function
# once and must fail with the message.

cmake_minimum_required(VERSION 3.30)

include("${CMAKE_CURRENT_LIST_DIR}/../../cmake/MfbeVersion.cmake")

set(MFBE_GIT_HASH "1a2b3c4d5e")

if(DEFINED MFBE_VF_TAG)
  mfbe_version_forms("0.0.6" "${MFBE_VF_PRERELEASE}" "${MFBE_VF_TAG}" CHILD)
  message("not refused: the tag ${MFBE_VF_TAG} gave the label ${CHILD_VERSION}")
  return()
endif()

set(_failures 0)

# _expect_forms(<case> <prerelease> <tag> <label> <build id> <package> <numeric> <ui> <channel>)
function(_expect_forms case prerelease tag label build_id package numeric ui channel)
  mfbe_version_forms("0.0.6" "${prerelease}" "${tag}" VF)
  set(_bad "")
  foreach(_pair IN ITEMS "VERSION|${label}" "BUILD_ID|${build_id}" "VERSION_PACKAGE|${package}"
                         "VERSION_NUMERIC|${numeric}" "UI_VERSION|${ui}"
                         "APPIMAGE_CHANNEL|${channel}")
    string(FIND "${_pair}" "|" _bar)
    string(SUBSTRING "${_pair}" 0 ${_bar} _name)
    math(EXPR _value_at "${_bar} + 1")
    string(SUBSTRING "${_pair}" ${_value_at} -1 _expected)
    if(NOT DEFINED VF_${_name})
      string(APPEND _bad "\n    VF_${_name} is not set")
    elseif(NOT "${VF_${_name}}" STREQUAL "${_expected}")
      string(APPEND _bad "\n    VF_${_name} is \"${VF_${_name}}\", expected \"${_expected}\"")
    endif()
  endforeach()
  if(_bad STREQUAL "")
    message(STATUS "ok: ${case}")
  else()
    message(SEND_ERROR "FAILED: ${case}${_bad}")
    math(EXPR _n "${_failures} + 1")
    set(_failures ${_n} PARENT_SCOPE)
  endif()
endfunction()

# _expect_refused(<case> <prerelease> <tag> <committed label>)
function(_expect_refused case prerelease tag committed)
  execute_process(
    COMMAND "${CMAKE_COMMAND}" "-DMFBE_VF_PRERELEASE=${prerelease}" "-DMFBE_VF_TAG=${tag}"
            -P "${CMAKE_CURRENT_LIST_FILE}"
    RESULT_VARIABLE _rc
    OUTPUT_VARIABLE _out
    ERROR_VARIABLE _out)
  # CMake indents and may wrap a message: compare with the white space folded.
  string(REGEX REPLACE "[ \t\r\n]+" " " _folded "${_out}")
  set(_message "tag ${tag} does not match the committed version ${committed}")
  if(_rc EQUAL 0)
    message(SEND_ERROR "FAILED: ${case}: the tag was accepted (exit code 0):\n${_out}")
  elseif(NOT _folded MATCHES "does not match the committed version")
    message(SEND_ERROR "FAILED: ${case}: exit code ${_rc} without the message:\n${_out}")
  else()
    string(FIND "${_folded}" "${_message}" _at)
    if(_at EQUAL -1)
      message(SEND_ERROR "FAILED: ${case}: expected \"${_message}\" in:\n${_out}")
    else()
      message(STATUS "ok: ${case}")
      return()
    endif()
  endif()
  math(EXPR _n "${_failures} + 1")
  set(_failures ${_n} PARENT_SCOPE)
endfunction()

# The forms table (installer.md): untagged, tag v0.0.6-rc.N, final.
_expect_forms("untagged: an empty tag" "rc" ""
  "0.0.6-rc" "0.0.6-rc+1a2b3c4d5e" "0.0.6~rc" "0.0.6" "0.0.6-rc" "")
_expect_forms("tag v0.0.6-rc.1" "rc" "v0.0.6-rc.1"
  "0.0.6-rc.1" "0.0.6-rc.1+1a2b3c4d5e" "0.0.6~rc.1" "0.0.6" "0.0.6-rc.1" "latest-all")
_expect_forms("tag v0.0.6-rc.12" "rc" "v0.0.6-rc.12"
  "0.0.6-rc.12" "0.0.6-rc.12+1a2b3c4d5e" "0.0.6~rc.12" "0.0.6" "0.0.6-rc.12" "latest-all")
_expect_forms("final: tag v0.0.6, empty pre-release part" "" "v0.0.6"
  "0.0.6" "0.0.6+1a2b3c4d5e" "0.0.6" "0.0.6" "0.0.6" "latest")
_expect_forms("final: no tag, empty pre-release part" "" ""
  "0.0.6" "0.0.6+1a2b3c4d5e" "0.0.6" "0.0.6" "0.0.6" "latest")

# The tags refused while the label is rc, and v0.0.6-rc.1 without a pre-release part.
foreach(_tag IN ITEMS "v0.0.6" "v0.0.5" "v0.0.6-rc" "v0.0.6-beta.1" "v0.0.6-rc.0" "v0.0.6-rc.01")
  _expect_refused("refused with rc: ${_tag}" "rc" "${_tag}" "0.0.6-rc")
endforeach()
_expect_refused("refused without a pre-release part: v0.0.6-rc.1" "" "v0.0.6-rc.1" "0.0.6")

if(_failures GREATER 0)
  message(FATAL_ERROR "version_forms: ${_failures} case(s) failed")
endif()
message(STATUS "version_forms: every case passed")

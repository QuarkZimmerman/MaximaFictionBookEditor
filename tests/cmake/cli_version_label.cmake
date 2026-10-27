# CTest cli_version_label (feature 006, contracts/cli.md "Tests to write"): `mfbe-core --version`
# prints exactly "mfbe-core <MFBE_VERSION> (<MFBE_BUILD_ID>)", the configured version label and
# build id (cmake/MfbeVersion.cmake), e.g. "mfbe-core 0.0.6-rc (0.0.6-rc+1a2b3c4d5e)".
#
#   cmake -DMFBE_CORE_BIN=<mfbe-core> -DMFBE_VERSION=<label> -DMFBE_BUILD_ID=<build id>
#         -P tests/cmake/cli_version_label.cmake

cmake_minimum_required(VERSION 3.30)

foreach(_var IN ITEMS MFBE_CORE_BIN MFBE_VERSION MFBE_BUILD_ID)
  if("${${_var}}" STREQUAL "")
    message(FATAL_ERROR "cli_version_label: -D${_var}=<value> is required")
  endif()
endforeach()

execute_process(
  COMMAND "${MFBE_CORE_BIN}" --version
  RESULT_VARIABLE _rc
  OUTPUT_VARIABLE _out
  ERROR_VARIABLE _err)
if(NOT _rc EQUAL 0)
  message(FATAL_ERROR "cli_version_label: ${MFBE_CORE_BIN} --version exited with ${_rc}\n"
                      "stdout: ${_out}\nstderr: ${_err}")
endif()

# The line ends with a line break (CRLF on Windows), which is not part of the line.
string(REGEX REPLACE "\r?\n$" "" _line "${_out}")
set(_expected "mfbe-core ${MFBE_VERSION} (${MFBE_BUILD_ID})")
if(NOT _line STREQUAL _expected)
  message(FATAL_ERROR "cli_version_label: ${MFBE_CORE_BIN} --version printed\n  \"${_line}\"\n"
                      "expected exactly\n  \"${_expected}\"")
endif()
message(STATUS "cli_version_label: ${_line}")

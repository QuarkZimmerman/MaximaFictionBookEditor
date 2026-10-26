# CTest cli_validate_tables (feature 006, T124; FR-062, FR-068; SC-011; contracts/cli.md §2 and
# "Tests to write"): `mfbe-core validate` and `mfbe-core roundtrip` list every irregular table of
# the fixture books as the warning table.irregular, whose params are those of the shared vectors
# (tests/fixtures/tables/grid-vectors.json, read here with string(JSON)), and the warning never
# changes an exit code. `validate tables.fb2` exiting 0 also checks FR-068: the book holds named
# styles around note links and nested named styles, which the 0.0.5 writer turned into
# `schema.invalid element=style`.
#
#   cmake -DMFBE_CORE_BIN=<mfbe-core> -DMFBE_FIXTURES_DIR=<tests/fixtures> -DMFBE_WORK_DIR=<dir>
#         -P tests/cmake/cli_validate_tables.cmake

cmake_minimum_required(VERSION 3.30)

foreach(_var IN ITEMS MFBE_CORE_BIN MFBE_FIXTURES_DIR MFBE_WORK_DIR)
  if("${${_var}}" STREQUAL "")
    message(FATAL_ERROR "cli_validate_tables: -D${_var}=<value> is required")
  endif()
endforeach()

# Every failed check is collected and reported at the end; the arguments are joined as message()
# joins them (each one taken whole, semicolons included).
set_property(GLOBAL PROPERTY CLI_VALIDATE_TABLES_FAILURES "")
function(_fail)
  set(_text "")
  math(EXPR _last "${ARGC} - 1")
  foreach(_k RANGE ${_last})
    string(APPEND _text "${ARGV${_k}}")
  endforeach()
  set_property(GLOBAL APPEND_STRING PROPERTY CLI_VALIDATE_TABLES_FAILURES "\n  - ${_text}")
endfunction()

# `<out>`: the members of the JSON object at the location ARGN of `json` as the CLI prints
# params, `<key>=<value>` with the keys sorted and separated by single spaces (core/main.cpp
# issue_line; ValidationIssue.params is a std::map).
function(_params_line out json)
  string(JSON _count LENGTH "${json}" ${ARGN})
  set(_keys "")
  if(_count GREATER 0)
    math(EXPR _last "${_count} - 1")
    foreach(_j RANGE ${_last})
      string(JSON _key MEMBER "${json}" ${ARGN} ${_j})
      list(APPEND _keys "${_key}")
    endforeach()
  endif()
  list(SORT _keys)
  set(_pairs "")
  foreach(_key IN LISTS _keys)
    string(JSON _value GET "${json}" ${ARGN} ${_key})
    list(APPEND _pairs "${_key}=${_value}")
  endforeach()
  list(JOIN _pairs " " _line)
  set(${out} "${_line}" PARENT_SCOPE)
endfunction()

# Runs mfbe-core with ARGN; `<prefix>_rc` and `<prefix>_out` (stdout, line feeds only).
function(_run prefix)
  execute_process(
    COMMAND "${MFBE_CORE_BIN}" ${ARGN}
    RESULT_VARIABLE _rc
    OUTPUT_VARIABLE _out
    ERROR_VARIABLE _err
    ENCODING UTF-8)
  string(REPLACE "\r" "" _out "${_out}")
  set(${prefix}_rc "${_rc}" PARENT_SCOPE)
  set(${prefix}_out "${_out}" PARENT_SCOPE)
  set(${prefix}_err "${_err}" PARENT_SCOPE)
endfunction()

# Compares two lists of params lines as multisets.
function(_same_params what actual expected)
  set(_actual ${actual})
  set(_expected ${expected})
  list(SORT _actual)
  list(SORT _expected)
  if(NOT "${_actual}" STREQUAL "${_expected}")
    string(REPLACE ";" "\n      " _a "${_actual}")
    string(REPLACE ";" "\n      " _e "${_expected}")
    _fail("${what}: the table.irregular params are\n      ${_a}\n    expected (grid-vectors.json)\n      ${_e}")
  endif()
endfunction()

# ---- The expectations: the irregular vector cases of each fixture book ------------------------

file(READ "${MFBE_FIXTURES_DIR}/tables/grid-vectors.json" _vectors)
string(JSON _case_count LENGTH "${_vectors}" cases)
math(EXPR _last_case "${_case_count} - 1")
set(_expected_tables "")
set(_expected_invalid "")
foreach(_i RANGE ${_last_case})
  string(JSON _fixture ERROR_VARIABLE _no_fixture GET "${_vectors}" cases ${_i} fixture)
  if(NOT "${_no_fixture}" STREQUAL "NOTFOUND")
    continue()  # JSON only: values XML cannot carry
  endif()
  string(JSON _regular GET "${_vectors}" cases ${_i} expect regular)
  if(_regular)
    continue()
  endif()
  _params_line(_line "${_vectors}" cases ${_i} expect params)
  if(_fixture STREQUAL "tables.fb2")
    list(APPEND _expected_tables "${_line}")
  elseif(_fixture STREQUAL "tables-invalid.fb2")
    list(APPEND _expected_invalid "${_line}")
  endif()
endforeach()
list(LENGTH _expected_tables _count)
list(LENGTH _expected_invalid _invalid_count)
# T012: tables.fb2 holds the 13 irregular cases, tables-invalid.fb2 the empty tr.
if(NOT _count EQUAL 13 OR NOT _invalid_count EQUAL 1)
  message(FATAL_ERROR "cli_validate_tables: grid-vectors.json names ${_count} irregular cases "
                      "for tables.fb2 and ${_invalid_count} for tables-invalid.fb2, not 13 and 1")
endif()

set(_tables "${MFBE_FIXTURES_DIR}/books/tables.fb2")
set(_invalid "${MFBE_FIXTURES_DIR}/books/tables-invalid.fb2")
set(_warning_regex ":([0-9]+):0: warning: table\\.irregular ([^\n]*)$")

# ---- validate tables.fb2: exit 0, one warning line per irregular table ------------------------

_run(_validate validate "${_tables}")
if(NOT _validate_rc EQUAL 0)
  _fail("validate tables.fb2 exited with ${_validate_rc}, expected 0 (warnings never change it)\n"
        "${_validate_out}${_validate_err}")
endif()
string(REGEX MATCHALL "[^\n]*: warning: table\\.irregular [^\n]*" _lines "${_validate_out}")
set(_actual "")
foreach(_l IN LISTS _lines)
  if(NOT _l MATCHES "${_warning_regex}" OR CMAKE_MATCH_1 EQUAL 0)
    _fail("validate tables.fb2: no line of <table> in \"${_l}\"")
  endif()
  list(APPEND _actual "${CMAKE_MATCH_2}")
endforeach()
_same_params("validate tables.fb2" "${_actual}" "${_expected_tables}")
string(REGEX MATCHALL "[^\n]*: (error|warning): [^\n]*" _all_issues "${_validate_out}")
list(LENGTH _all_issues _issue_count)
if(NOT _issue_count EQUAL _count)
  _fail("validate tables.fb2 printed ${_issue_count} issue lines, expected the ${_count} warnings\n"
        "${_validate_out}")
endif()
string(FIND "${_validate_out}" "tables.fb2: valid (0 errors, ${_count} warnings, " _at)
if(_at EQUAL -1)
  _fail("validate tables.fb2: no summary \"tables.fb2: valid (0 errors, ${_count} warnings, ...\"\n"
        "${_validate_out}")
endif()

# ---- validate --json tables.fb2: one entry per irregular table, with line, nodeId and path ----

_run(_json validate --json "${_tables}")
if(NOT _json_rc EQUAL 0)
  _fail("validate --json tables.fb2 exited with ${_json_rc}, expected 0\n${_json_err}")
else()
  string(JSON _well_formed GET "${_json_out}" 0 wellFormed)
  string(JSON _errors GET "${_json_out}" 0 report errorCount)
  string(JSON _warnings GET "${_json_out}" 0 report warningCount)
  if(NOT _well_formed OR NOT _errors EQUAL 0 OR NOT _warnings EQUAL _count)
    _fail("validate --json tables.fb2: wellFormed ${_well_formed}, errorCount ${_errors}, "
          "warningCount ${_warnings}; expected ON, 0, ${_count}")
  endif()
  string(JSON _n LENGTH "${_json_out}" 0 report issues)
  set(_actual "")
  if(_n GREATER 0)
    math(EXPR _last "${_n} - 1")
    foreach(_i RANGE ${_last})
      string(JSON _code GET "${_json_out}" 0 report issues ${_i} code)
      if(NOT _code STREQUAL "table.irregular")
        continue()
      endif()
      string(JSON _severity GET "${_json_out}" 0 report issues ${_i} severity)
      string(JSON _line ERROR_VARIABLE _no_line GET "${_json_out}" 0 report issues ${_i} line)
      string(JSON _node ERROR_VARIABLE _no_node GET "${_json_out}" 0 report issues ${_i} nodeId)
      string(JSON _path ERROR_VARIABLE _no_path GET "${_json_out}" 0 report issues ${_i} path)
      string(JSON _column ERROR_VARIABLE _no_column GET "${_json_out}" 0 report issues ${_i}
             column)
      if(NOT _severity STREQUAL "warning" OR NOT "${_no_line}" STREQUAL "NOTFOUND"
         OR NOT "${_no_node}" STREQUAL "NOTFOUND" OR NOT "${_no_path}" STREQUAL "NOTFOUND"
         OR "${_no_column}" STREQUAL "NOTFOUND" OR NOT _line GREATER 0
         OR NOT _path MATCHES "table\\[[0-9]+\\]$" OR "${_node}" STREQUAL "")
        string(JSON _entry GET "${_json_out}" 0 report issues ${_i})
        _fail("validate --json tables.fb2: issue ${_i} is not a warning with line, nodeId and "
              "path (and no column): ${_entry}")
      endif()
      _params_line(_params "${_json_out}" 0 report issues ${_i} params)
      list(APPEND _actual "${_params}")
    endforeach()
  endif()
  _same_params("validate --json tables.fb2" "${_actual}" "${_expected_tables}")
endif()

# ---- validate tables-invalid.fb2: exit 1 for its schema errors, the empty tr still listed -----

_run(_broken validate "${_invalid}")
if(NOT _broken_rc EQUAL 1)
  _fail("validate tables-invalid.fb2 exited with ${_broken_rc}, expected 1 (schema errors)\n"
        "${_broken_out}${_broken_err}")
endif()
string(REGEX MATCHALL "[^\n]*: warning: table\\.irregular [^\n]*" _lines "${_broken_out}")
set(_actual "")
foreach(_l IN LISTS _lines)
  if(NOT _l MATCHES "${_warning_regex}" OR CMAKE_MATCH_1 EQUAL 0)
    _fail("validate tables-invalid.fb2: no line of <table> in \"${_l}\"")
  endif()
  list(APPEND _actual "${CMAKE_MATCH_2}")
endforeach()
_same_params("validate tables-invalid.fb2" "${_actual}" "${_expected_invalid}")
string(FIND "${_broken_out}" "tables-invalid.fb2: INVALID (" _at)
if(_at EQUAL -1)
  _fail("validate tables-invalid.fb2: no summary \"tables-invalid.fb2: INVALID (...\"\n"
        "${_broken_out}")
endif()

# ---- roundtrip tables.fb2 --json: identical and valid, the warnings in validation.issues -------

file(REMOVE_RECURSE "${MFBE_WORK_DIR}")
_run(_rt_json roundtrip "${_tables}" --out "${MFBE_WORK_DIR}/json" --json)
if(NOT _rt_json_rc EQUAL 0)
  _fail("roundtrip tables.fb2 --json exited with ${_rt_json_rc}, expected 0 (identical and "
        "valid; warnings ignored)\n${_rt_json_out}${_rt_json_err}")
else()
  string(JSON _identical GET "${_rt_json_out}" identical)
  string(JSON _valid GET "${_rt_json_out}" valid)
  string(JSON _warnings GET "${_rt_json_out}" validation warningCount)
  if(NOT _identical OR NOT _valid OR NOT _warnings EQUAL _count)
    _fail("roundtrip tables.fb2 --json: identical ${_identical}, valid ${_valid}, warningCount "
          "${_warnings}; expected ON, ON, ${_count}")
  endif()
  string(JSON _n LENGTH "${_rt_json_out}" validation issues)
  set(_actual "")
  if(_n GREATER 0)
    math(EXPR _last "${_n} - 1")
    foreach(_i RANGE ${_last})
      string(JSON _code GET "${_rt_json_out}" validation issues ${_i} code)
      if(_code STREQUAL "table.irregular")
        _params_line(_params "${_rt_json_out}" validation issues ${_i} params)
        list(APPEND _actual "${_params}")
      endif()
    endforeach()
  endif()
  _same_params("roundtrip tables.fb2 --json" "${_actual}" "${_expected_tables}")
endif()

# ---- roundtrip tables.fb2: the text summary shows 10 issues, then "    ..." -------------------

_run(_rt roundtrip "${_tables}" --out "${MFBE_WORK_DIR}/text")
if(NOT _rt_rc EQUAL 0)
  _fail("roundtrip tables.fb2 exited with ${_rt_rc}, expected 0\n${_rt_out}${_rt_err}")
endif()
string(FIND "${_rt_out}" "\n  structural comparison: identical (" _at)
if(_at EQUAL -1)
  _fail("roundtrip tables.fb2: not identical\n${_rt_out}")
endif()
string(FIND "${_rt_out}" "\n  validation: valid (0 errors, ${_count} warnings, " _at)
if(_at EQUAL -1)
  _fail("roundtrip tables.fb2: no \"validation: valid (0 errors, ${_count} warnings, ...\"\n"
        "${_rt_out}")
endif()
# Report::summary shows at most 10 issues (core/include/mfbe/roundtrip.hpp), then "    ...".
string(REGEX MATCHALL "\n    (error|warning)[^\n]*" _shown "${_rt_out}")
string(REGEX MATCHALL "\n    warning line [0-9]+: table\\.irregular [^\n]*" _lines "${_rt_out}")
list(LENGTH _shown _shown_count)
list(LENGTH _lines _line_count)
if(NOT _shown_count EQUAL 10 OR NOT _line_count EQUAL 10)
  _fail("roundtrip tables.fb2 showed ${_shown_count} issues, ${_line_count} of them table.irregular "
        "with a line; expected 10 of the ${_count}\n${_rt_out}")
endif()
foreach(_l IN LISTS _lines)
  string(REGEX REPLACE "^\n    warning line [0-9]+: table\\.irregular " "" _params "${_l}")
  list(FIND _expected_tables "${_params}" _found)
  if(_found EQUAL -1)
    _fail("roundtrip tables.fb2: \"${_params}\" is not the params of an irregular case")
  endif()
endforeach()
if(NOT _rt_out MATCHES "\n    warning line [0-9]+: table\\.irregular [^\n]*\n    \\.\\.\\.\n")
  _fail("roundtrip tables.fb2: no \"    ...\" line after the tenth issue\n${_rt_out}")
endif()

get_property(_failures GLOBAL PROPERTY CLI_VALIDATE_TABLES_FAILURES)
if(NOT "${_failures}" STREQUAL "")
  message(FATAL_ERROR "cli_validate_tables:${_failures}")
endif()
message(STATUS "cli_validate_tables: ${_count} irregular tables of tables.fb2 and "
               "${_invalid_count} of tables-invalid.fb2 reported as table.irregular")

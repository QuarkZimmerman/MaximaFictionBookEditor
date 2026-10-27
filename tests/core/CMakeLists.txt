find_package(Catch2 3 CONFIG REQUIRED)
# The in-process HTTP test server (test_http_server.hpp) is a uWS::App on its own thread; the
# core links uWebSockets privately, so the tests name the imported target for its headers.
find_package(unofficial-uwebsockets CONFIG REQUIRED)
# The XML-level round-trip walker of test_support.hpp (feature 006, document-model §3.3) parses
# with the core's hardened parser (core/src/xml/xml_security.hpp); the core links libxml2
# privately, so the tests name the imported target for its headers.
find_package(LibXml2 CONFIG REQUIRED)
if(NOT WIN32)
  # The HTTPS fixture (test_tls_fixture.hpp) drives OpenSSL directly - the TLS library libcurl
  # is built on for Linux and macOS (vcpkg curl[ssl]). Windows links Schannel and no OpenSSL:
  # the fixture reports itself unavailable there and the HTTPS cases skip (feature 005, T010).
  find_package(OpenSSL REQUIRED)
endif()

file(GLOB MFBE_CORE_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
if(MFBE_CORE_TEST_SOURCES)
  add_executable(mfbe_core_tests ${MFBE_CORE_TEST_SOURCES})
  target_link_libraries(mfbe_core_tests PRIVATE
    mfbe::core Catch2::Catch2WithMain unofficial::uwebsockets::uwebsockets LibXml2::LibXml2)
  # Internal helpers without a public header (core/src/util/sha256.hpp) are included as the
  # core's own sources include them ("util/sha256.hpp").
  target_include_directories(mfbe_core_tests PRIVATE "${CMAKE_SOURCE_DIR}/core/src")
  target_compile_definitions(mfbe_core_tests PRIVATE
    MFBE_TEST_FIXTURES_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
    MFBE_TEST_CORPUS_DIR="${CMAKE_SOURCE_DIR}/tests/corpus"
    MFBE_TEST_BUILD_DIR="${CMAKE_BINARY_DIR}")
  if(NOT WIN32)
    target_link_libraries(mfbe_core_tests PRIVATE OpenSSL::SSL OpenSSL::Crypto)
    target_compile_definitions(mfbe_core_tests PRIVATE MFBE_TEST_TLS=1)
  endif()
  include(Catch)
  catch_discover_tests(mfbe_core_tests)
endif()

# Corpus round-trip tests are long-running and labelled "corpus"
file(GLOB MFBE_CORPUS_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/corpus_*.cpp")
if(MFBE_CORPUS_TEST_SOURCES)
  add_executable(mfbe_corpus_tests ${MFBE_CORPUS_TEST_SOURCES})
  target_link_libraries(mfbe_corpus_tests PRIVATE mfbe::core Catch2::Catch2WithMain)
  target_compile_definitions(mfbe_corpus_tests PRIVATE
    MFBE_TEST_FIXTURES_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
    MFBE_TEST_CORPUS_DIR="${CMAKE_SOURCE_DIR}/tests/corpus"
    MFBE_TEST_BUILD_DIR="${CMAKE_BINARY_DIR}")
  add_test(NAME corpus_roundtrip COMMAND mfbe_corpus_tests)
  set_tests_properties(corpus_roundtrip PROPERTIES LABELS "corpus" TIMEOUT 3600)
endif()

# The command line's --version names the version label and the build id (feature 006,
# contracts/cli.md "Tests to write"): a cmake -P script around the mfbe-core executable, which
# the Catch2 suites do not link (core/main.cpp is outside the library).
add_test(NAME cli_version_label
  COMMAND ${CMAKE_COMMAND} -DMFBE_CORE_BIN=$<TARGET_FILE:mfbe-core> -DMFBE_VERSION=${MFBE_VERSION}
          -DMFBE_BUILD_ID=${MFBE_BUILD_ID}
          -P ${CMAKE_SOURCE_DIR}/tests/cmake/cli_version_label.cmake)
set_tests_properties(cli_version_label PROPERTIES LABELS version)

# validate and roundtrip list each irregular table of the fixture books as the warning
# table.irregular with the shared vectors' params, and the warning changes no exit code (feature
# 006, contracts/cli.md "Tests to write"): registered by name as corpus_roundtrip is, but without
# the corpus label, so CI's `ctest -LE corpus` runs it on the three core legs.
add_test(NAME cli_validate_tables
  COMMAND ${CMAKE_COMMAND} -DMFBE_CORE_BIN=$<TARGET_FILE:mfbe-core>
          -DMFBE_FIXTURES_DIR=${CMAKE_SOURCE_DIR}/tests/fixtures
          -DMFBE_WORK_DIR=${CMAKE_CURRENT_BINARY_DIR}/cli_validate_tables
          -P ${CMAKE_SOURCE_DIR}/tests/cmake/cli_validate_tables.cmake)

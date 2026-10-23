find_package(Catch2 3 CONFIG REQUIRED)
# The in-process HTTP test server (test_http_server.hpp) is a uWS::App on its own thread; the
# core links uWebSockets privately, so the tests name the imported target for its headers.
find_package(unofficial-uwebsockets CONFIG REQUIRED)
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
    mfbe::core Catch2::Catch2WithMain unofficial::uwebsockets::uwebsockets)
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

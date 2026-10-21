find_package(Catch2 3 CONFIG REQUIRED)

file(GLOB MFBE_CORE_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
if(MFBE_CORE_TEST_SOURCES)
  add_executable(mfbe_core_tests ${MFBE_CORE_TEST_SOURCES})
  target_link_libraries(mfbe_core_tests PRIVATE mfbe::core Catch2::Catch2WithMain)
  target_compile_definitions(mfbe_core_tests PRIVATE
    MFBE_TEST_FIXTURES_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
    MFBE_TEST_CORPUS_DIR="${CMAKE_SOURCE_DIR}/tests/corpus"
    MFBE_TEST_BUILD_DIR="${CMAKE_BINARY_DIR}")
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

# mfbe_core (static library) + mfbe-core (headless executable)

find_package(LibXml2 CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(CLI11 CONFIG REQUIRED)
find_package(stduuid CONFIG REQUIRED)
find_package(platform_folders CONFIG REQUIRED)
find_package(unofficial-uwebsockets CONFIG REQUIRED)
find_package(ZLIB REQUIRED)
find_package(JPEG REQUIRED)
find_package(PNG REQUIRED)
find_package(WebP CONFIG REQUIRED)
find_package(TIFF REQUIRED)
find_package(GIF REQUIRED)
find_package(Stb REQUIRED)
find_path(HUNSPELL_INCLUDE_DIR NAMES hunspell/hunspell.hxx REQUIRED)
find_library(HUNSPELL_LIBRARY NAMES hunspell-1.7 hunspell libhunspell REQUIRED)

configure_file(
  "${CMAKE_CURRENT_SOURCE_DIR}/include/mfbe/version.hpp.in"
  "${CMAKE_CURRENT_BINARY_DIR}/generated/mfbe/version.hpp" @ONLY)

# UTF-8 text <-> path helpers (mfbe/utf8_paths.hpp): a library of their own because the CEF
# shell, whose sources do not link the core, needs them too.
add_library(mfbe_paths STATIC "${CMAKE_CURRENT_SOURCE_DIR}/src/platform/paths.cpp")
target_include_directories(mfbe_paths PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>")
target_link_libraries(mfbe_paths PRIVATE mfbe::options)

# All other translation units under src/ are part of the library (layout: see plan.md).
file(GLOB_RECURSE _mfbe_existing_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")
list(FILTER _mfbe_existing_sources EXCLUDE REGEX "/src/platform/paths\\.cpp$")

add_library(mfbe_core STATIC ${_mfbe_existing_sources})
add_library(mfbe::core ALIAS mfbe_core)

target_include_directories(mfbe_core
  PUBLIC
    "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>"
    "$<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/generated>"
  PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${HUNSPELL_INCLUDE_DIR}"
    "${Stb_INCLUDE_DIR}")

target_link_libraries(mfbe_core
  PUBLIC
    mfbe::options
    mfbe_paths
    nlohmann_json::nlohmann_json
    spdlog::spdlog
  PRIVATE
    LibXml2::LibXml2
    stduuid
    sago::platform_folders
    unofficial::uwebsockets::uwebsockets
    ZLIB::ZLIB
    JPEG::JPEG
    PNG::PNG
    WebP::webp WebP::webpdecoder
    TIFF::TIFF
    GIF::GIF
    "${HUNSPELL_LIBRARY}")

target_compile_definitions(mfbe_core
  PUBLIC
    $<$<BOOL:${MFBE_TEST_HOOKS}>:MFBE_TEST_HOOKS=1>
    MFBE_RESOURCES_SOURCE_DIR="${MFBE_RESOURCES_SOURCE_DIR}"
    MFBE_SCRIPTS_SOURCE_DIR="${MFBE_SCRIPTS_SOURCE_DIR}")

if(WIN32)
  target_link_libraries(mfbe_core PRIVATE ws2_32 shell32 ole32)
elseif(APPLE)
  target_link_libraries(mfbe_core PRIVATE "-framework CoreFoundation")
else()
  find_package(Threads REQUIRED)
  target_link_libraries(mfbe_core PRIVATE Threads::Threads)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/main.cpp")
  add_executable(mfbe-core main.cpp)
  target_link_libraries(mfbe-core PRIVATE mfbe::core CLI11::CLI11)
  set_target_properties(mfbe-core PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
  install(TARGETS mfbe-core RUNTIME DESTINATION bin COMPONENT core)
endif()

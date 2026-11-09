# Common compiler options applied through the mfbe::options interface target.

add_library(mfbe_options INTERFACE)
add_library(mfbe::options ALIAS mfbe_options)

target_compile_features(mfbe_options INTERFACE cxx_std_20)

if(MSVC)
  target_compile_options(mfbe_options INTERFACE
    /W4 /permissive- /Zc:__cplusplus /Zc:preprocessor /utf-8 /EHsc /bigobj
    /wd4100 /wd4127)
  target_compile_definitions(mfbe_options INTERFACE
    _CRT_SECURE_NO_WARNINGS NOMINMAX WIN32_LEAN_AND_MEAN UNICODE _UNICODE)
  if(MFBE_WARNINGS_AS_ERRORS)
    target_compile_options(mfbe_options INTERFACE /WX)
  endif()
else()
  target_compile_options(mfbe_options INTERFACE
    -Wall -Wextra -Wpedantic -Wshadow -Wnon-virtual-dtor -Wold-style-cast
    -Wcast-align -Wunused -Woverloaded-virtual -Wnull-dereference
    -Wdouble-promotion -Wformat=2 -Wimplicit-fallthrough
    -Wno-unused-parameter)
  # GCC's -Wnull-dereference and -Warray-bounds judge what the optimiser has inlined; at -O2, GCC 14
  # reports paths inside libstdc++'s std::streambuf and nlohmann::json's std::map that cannot occur
  # (50 warnings in the Release core, none in our own code; feature 011's gate). The optimised GCC
  # builds leave the two out; Clang keeps -Wnull-dereference.
  if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    target_compile_options(mfbe_options INTERFACE
      $<$<NOT:$<CONFIG:Debug>>:-Wno-null-dereference -Wno-array-bounds>)
  endif()
  if(MFBE_WARNINGS_AS_ERRORS)
    target_compile_options(mfbe_options INTERFACE -Werror)
  endif()
endif()

if(APPLE)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "Minimum macOS version" FORCE)
endif()

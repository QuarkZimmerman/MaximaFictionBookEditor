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
  if(MFBE_WARNINGS_AS_ERRORS)
    target_compile_options(mfbe_options INTERFACE -Werror)
  endif()
endif()

if(APPLE)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "Minimum macOS version" FORCE)
endif()

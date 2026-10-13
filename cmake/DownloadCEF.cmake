# Download and extract the pinned CEF binary distribution.
#
# Modelled on cef-project/cmake/DownloadCEF.cmake, except that the archive SHA1
# is pinned in CefVersion.cmake instead of being fetched from the CDN.
#
# Usage:
#   include(CefVersion)
#   include(DownloadCEF)
#   mfbe_cef_detect_platform(MFBE_CEF_PLATFORM)
#   mfbe_download_cef("${MFBE_CEF_PLATFORM}" "${MFBE_CEF_VERSION_${MFBE_CEF_PLATFORM}}"
#     "${MFBE_CEF_DOWNLOAD_DIR}" CEF_ROOT)
#
# Cache overrides:
#   MFBE_CEF_ROOT          pre-extracted distribution; skips download and
#                          extraction entirely (for CI caches)
#   MFBE_CEF_DOWNLOAD_DIR  where archives are downloaded and extracted
#   MFBE_CEF_DOWNLOAD_BASE_URL  mirror of https://cef-builds.spotifycdn.com

include_guard(GLOBAL)

set(MFBE_CEF_DOWNLOAD_DIR "${CMAKE_SOURCE_DIR}/third_party/downloads" CACHE PATH
  "Directory where the CEF binary distribution is downloaded and extracted")
set(MFBE_CEF_ROOT "" CACHE PATH
  "Pre-extracted CEF binary distribution to use instead of downloading one")
set(MFBE_CEF_DOWNLOAD_BASE_URL "https://cef-builds.spotifycdn.com" CACHE STRING
  "Base URL for CEF binary distribution downloads")
mark_as_advanced(MFBE_CEF_DOWNLOAD_BASE_URL)

# Sets <out_var> to the CEF platform key of the system being configured:
# linux64, linuxarm64, windows64, windowsarm64, macosx64 or macosarm64.
function(mfbe_cef_detect_platform out_var)
  set(system "${CMAKE_SYSTEM_NAME}")
  set(arch "${CMAKE_SYSTEM_PROCESSOR}")
  if(NOT system)
    # Script mode or before project(): fall back to the host.
    set(system "${CMAKE_HOST_SYSTEM_NAME}")
    cmake_host_system_information(RESULT arch QUERY OS_PLATFORM)
  endif()

  if(system STREQUAL "Darwin" AND CMAKE_OSX_ARCHITECTURES)
    list(LENGTH CMAKE_OSX_ARCHITECTURES count)
    if(count GREATER 1)
      message(FATAL_ERROR "CEF: universal binaries are not available; "
        "set CMAKE_OSX_ARCHITECTURES to either arm64 or x86_64")
    endif()
    set(arch "${CMAKE_OSX_ARCHITECTURES}")
  elseif(system STREQUAL "Windows")
    # Prefer the target architecture of the VS generator (-A) or the compiler.
    if(CMAKE_GENERATOR_PLATFORM)
      set(arch "${CMAKE_GENERATOR_PLATFORM}")
    elseif(CMAKE_CXX_COMPILER_ARCHITECTURE_ID)
      set(arch "${CMAKE_CXX_COMPILER_ARCHITECTURE_ID}")
    endif()
  endif()

  string(TOLOWER "${arch}" arch)
  if(arch MATCHES "^(x86_64|amd64|x64)$")
    set(arch "x64")
  elseif(arch MATCHES "^(aarch64|arm64)$")
    set(arch "arm64")
  endif()

  if(system STREQUAL "Linux" AND arch STREQUAL "x64")
    set(key "linux64")
  elseif(system STREQUAL "Linux" AND arch STREQUAL "arm64")
    set(key "linuxarm64")
  elseif(system STREQUAL "Windows" AND arch STREQUAL "x64")
    set(key "windows64")
  elseif(system STREQUAL "Windows" AND arch STREQUAL "arm64")
    set(key "windowsarm64")
  elseif(system STREQUAL "Darwin" AND arch STREQUAL "x64")
    set(key "macosx64")
  elseif(system STREQUAL "Darwin" AND arch STREQUAL "arm64")
    set(key "macosarm64")
  else()
    message(FATAL_ERROR "CEF: unsupported platform ${system}/${arch}")
  endif()
  set(${out_var} "${key}" PARENT_SCOPE)
endfunction()

# Fails unless <root> looks like an extracted CEF binary distribution.
function(_mfbe_cef_check_root root what)
  foreach(entry IN ITEMS cmake/cef_variables.cmake include libcef_dll Release)
    if(NOT EXISTS "${root}/${entry}")
      message(FATAL_ERROR
        "CEF: ${what} (${root}) is not a CEF binary distribution: missing ${entry}")
    endif()
  endforeach()
endfunction()

# Downloads (unless a valid archive is cached) and extracts (unless already
# extracted) the minimal distribution cef_binary_<version>_<platform>_minimal
# into <download_dir>. Sets <out_var> to the extracted root, i.e. the directory
# holding cmake/cef_variables.cmake, include/, libcef_dll/, Release/ and
# Resources/. A non-empty MFBE_CEF_ROOT is validated and returned instead.
function(mfbe_download_cef platform version download_dir out_var)
  if(MFBE_CEF_ROOT)
    _mfbe_cef_check_root("${MFBE_CEF_ROOT}" "MFBE_CEF_ROOT")
    message(STATUS "CEF: using pre-extracted distribution ${MFBE_CEF_ROOT}")
    set(${out_var} "${MFBE_CEF_ROOT}" PARENT_SCOPE)
    return()
  endif()

  set(distribution "cef_binary_${version}_${platform}_minimal")
  set(file_name "${distribution}.tar.bz2")
  set(archive "${download_dir}/${file_name}")
  set(cef_root "${download_dir}/${distribution}")

  if(NOT DEFINED MFBE_CEF_SHA1_${platform}
      OR NOT "${MFBE_CEF_FILE_${platform}}" STREQUAL "${file_name}")
    message(FATAL_ERROR
      "CEF: no SHA1 pinned for ${file_name}; add it to cmake/CefVersion.cmake")
  endif()
  set(sha1 "${MFBE_CEF_SHA1_${platform}}")

  if(EXISTS "${cef_root}/cmake/cef_variables.cmake")
    message(STATUS "CEF: using extracted distribution ${cef_root}")
    set(${out_var} "${cef_root}" PARENT_SCOPE)
    return()
  endif()

  file(MAKE_DIRECTORY "${download_dir}")

  # Reuse a cached archive only when its hash matches the pin.
  set(have_archive FALSE)
  if(EXISTS "${archive}")
    file(SHA1 "${archive}" actual_sha1)
    if(actual_sha1 STREQUAL sha1)
      set(have_archive TRUE)
      message(STATUS "CEF: reusing cached archive ${archive}")
    else()
      message(STATUS "CEF: cached archive ${archive} has SHA1 ${actual_sha1}, "
        "expected ${sha1}; downloading again")
      file(REMOVE "${archive}")
    endif()
  endif()

  if(NOT have_archive)
    # The CDN expects "+" in the file name to be percent-encoded. Download to a
    # temporary name so an aborted transfer never passes for a cached archive;
    # file(DOWNLOAD) fails fatally on transfer errors and on a hash mismatch.
    string(REPLACE "+" "%2B" url_file_name "${file_name}")
    set(url "${MFBE_CEF_DOWNLOAD_BASE_URL}/${url_file_name}")
    message(STATUS "CEF: downloading ${url}")
    file(DOWNLOAD "${url}" "${archive}.part"
      EXPECTED_HASH SHA1=${sha1}
      SHOW_PROGRESS
      TLS_VERIFY ON
      INACTIVITY_TIMEOUT 120)
    file(RENAME "${archive}.part" "${archive}")
  endif()

  # The archive contains a single top-level <distribution>/ directory. Drop any
  # incomplete leftover from an interrupted extraction first.
  if(IS_DIRECTORY "${cef_root}")
    file(REMOVE_RECURSE "${cef_root}")
  endif()
  message(STATUS "CEF: extracting ${file_name} into ${download_dir}")
  file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${download_dir}")
  _mfbe_cef_check_root("${cef_root}" "extracted archive")
  set(${out_var} "${cef_root}" PARENT_SCOPE)
endfunction()

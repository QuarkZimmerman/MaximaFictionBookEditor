# Locates the pinned CEF binary distribution (downloading it when necessary)
# and loads its CMake bootstrap: FindCEF.cmake, which pulls in
# cef_variables.cmake and cef_macros.cmake.
#
# Usage (after project(); C and CXX must be enabled):
#   list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")
#   find_package(CEFDistribution REQUIRED)
#   add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)
#   ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}") # not on macOS
#   add_executable(mfbe_app ...)
#   SET_EXECUTABLE_TARGET_PROPERTIES(mfbe_app)
#   add_dependencies(mfbe_app libcef_dll_wrapper)
#   target_link_libraries(mfbe_app libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
#   COPY_FILES(mfbe_app "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
#   COPY_FILES(mfbe_app "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
#   PRINT_CEF_CONFIG()
#
# Input:  CEF_ROOT, when the distribution is already known (-DCEF_ROOT=...).
#         Otherwise the version pinned in CefVersion.cmake is resolved through
#         DownloadCEF.cmake, honouring MFBE_CEF_ROOT and MFBE_CEF_DOWNLOAD_DIR.
# Output: CEF_ROOT, MFBE_CEF_PLATFORM, PROJECT_ARCH, CEFDistribution_FOUND,
#         CEFDistribution_VERSION, CEFDistribution_CHROMIUM_VERSION and all of
#         FindCEF.cmake: CEF_LIBCEF_DLL_WRAPPER_PATH, CEF_INCLUDE_PATH,
#         CEF_BINARY_DIR, CEF_BINARY_FILES, CEF_RESOURCE_DIR, CEF_RESOURCE_FILES,
#         CEF_STANDARD_LIBS, OS_LINUX/OS_MAC/OS_WINDOWS, USE_SANDBOX and the
#         SET_*_TARGET_PROPERTIES(), COPY_*() and PRINT_CEF_CONFIG() macros.

include("${CMAKE_CURRENT_LIST_DIR}/CefVersion.cmake")
include("${CMAKE_CURRENT_LIST_DIR}/DownloadCEF.cmake")

mfbe_cef_detect_platform(MFBE_CEF_PLATFORM)

if(NOT CEF_ROOT)
  mfbe_download_cef("${MFBE_CEF_PLATFORM}" "${MFBE_CEF_VERSION_${MFBE_CEF_PLATFORM}}"
    "${MFBE_CEF_DOWNLOAD_DIR}" CEF_ROOT)
endif()

# cef_variables.cmake derives PROJECT_ARCH from the host unless it is already
# defined; make it follow the distribution so cross builds pick the right flags.
if(NOT DEFINED PROJECT_ARCH)
  if(MFBE_CEF_PLATFORM MATCHES "arm64$")
    set(PROJECT_ARCH "arm64")
  else()
    set(PROJECT_ARCH "x86_64")
  endif()
endif()

list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
list(REMOVE_DUPLICATES CMAKE_MODULE_PATH)

# The minimal distribution ships Release binaries only; let Debug builds of the
# application link against and copy the Release CEF binaries.
if(NOT IS_DIRECTORY "${CEF_BINARY_DIR_DEBUG}")
  set(CEF_BINARY_DIR "${CEF_BINARY_DIR_RELEASE}")
  set(CEF_BINARY_DIR_DEBUG "${CEF_BINARY_DIR_RELEASE}")
  if(DEFINED CEF_LIB_RELEASE)
    set(CEF_LIB_DEBUG "${CEF_LIB_RELEASE}")
  endif()
  if(DEFINED CEF_SANDBOX_LIB_RELEASE)
    set(CEF_SANDBOX_LIB_DEBUG "${CEF_SANDBOX_LIB_RELEASE}")
  endif()
endif()

# Report the versions baked into the distribution headers.
file(STRINGS "${CEF_ROOT}/include/cef_version.h" _mfbe_cef_version_line
  REGEX "^#define CEF_VERSION \"")
string(REGEX REPLACE "^#define CEF_VERSION \"([^\"]*)\".*$" "\\1"
  CEFDistribution_VERSION "${_mfbe_cef_version_line}")
string(REGEX REPLACE "^.*chromium-([0-9.]+).*$" "\\1"
  CEFDistribution_CHROMIUM_VERSION "${CEFDistribution_VERSION}")
unset(_mfbe_cef_version_line)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(CEFDistribution
  REQUIRED_VARS CEF_ROOT CEF_LIBCEF_DLL_WRAPPER_PATH CEF_INCLUDE_PATH
  VERSION_VAR CEFDistribution_VERSION)

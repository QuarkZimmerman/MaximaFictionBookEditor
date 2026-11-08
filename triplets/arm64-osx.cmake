# vcpkg's built-in arm64-osx triplet plus the editor's deployment target (feature 011, D47): every static
# library vcpkg builds for macOS targets macOS 13.0, like the editor itself
# (cmake/MfbeCompilerOptions.cmake, CMakePresets.json, app/mac/Info.plist.in).
set(VCPKG_TARGET_ARCHITECTURE arm64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Darwin)
set(VCPKG_OSX_ARCHITECTURES arm64)
set(VCPKG_OSX_DEPLOYMENT_TARGET 13.0)

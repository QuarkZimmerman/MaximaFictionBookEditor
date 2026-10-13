# Pinned Chromium Embedded Framework (CEF) binary distribution.
#
# Source of truth: https://cef-builds.spotifycdn.com/index.json (checked 2026-10-12).
# For every platform key the entry with cef_version == MFBE_CEF_VERSION_<platform>
# was located under <platform>.versions[] and the files[] element with
# type == "minimal" supplied the archive name and SHA1 recorded below.
#
# Only the "minimal" distribution is used: Release binaries, resources, headers
# and the libcef_dll_wrapper sources (no Debug binaries, no cefclient sources).
# Download URL: https://cef-builds.spotifycdn.com/<name with "+" encoded as %2B>

# CEF 150 LTC channel (Chromium 150.0.7871.x).
set(MFBE_CEF_VERSION "150.0.22+gc1a097e+chromium-150.0.7871.256")
set(MFBE_CEF_CHROMIUM_VERSION "150.0.7871.256")

# Platform keys with a pinned archive (see mfbe_cef_detect_platform()).
set(MFBE_CEF_PLATFORMS linux64 linuxarm64 windows64 windowsarm64 macosx64 macosarm64)

# Per-platform version. macOS deviates: the index has no 150.0.22 build for
# macosx64/macosarm64 (newest 150.x there is 150.0.21, Chromium 150.0.7871.255,
# published 2026-09-23), so macOS pins that build with its own hashes.
set(MFBE_CEF_VERSION_linux64 "${MFBE_CEF_VERSION}")
set(MFBE_CEF_VERSION_linuxarm64 "${MFBE_CEF_VERSION}")
set(MFBE_CEF_VERSION_windows64 "${MFBE_CEF_VERSION}")
set(MFBE_CEF_VERSION_windowsarm64 "${MFBE_CEF_VERSION}")
set(MFBE_CEF_VERSION_macosx64 "150.0.21+ga61e9a5+chromium-150.0.7871.255")
set(MFBE_CEF_VERSION_macosarm64 "150.0.21+ga61e9a5+chromium-150.0.7871.255")

# Minimal distribution archives (cef_binary_<version>_<platform>_minimal.tar.bz2)
# and their SHA1 hashes as published in index.json.
set(MFBE_CEF_FILE_linux64
  "cef_binary_${MFBE_CEF_VERSION_linux64}_linux64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_linux64 "7e7ca1e73e5d5e6317ca53dc1302fd180a3e1222")

set(MFBE_CEF_FILE_linuxarm64
  "cef_binary_${MFBE_CEF_VERSION_linuxarm64}_linuxarm64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_linuxarm64 "dca12dae6fb104fef4c614e990eaeb1c0a6e263f")

set(MFBE_CEF_FILE_windows64
  "cef_binary_${MFBE_CEF_VERSION_windows64}_windows64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_windows64 "01011e3f5b05caacb3b724c7965b047ffd33fd18")

set(MFBE_CEF_FILE_windowsarm64
  "cef_binary_${MFBE_CEF_VERSION_windowsarm64}_windowsarm64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_windowsarm64 "65989dbafd0be1ae5289091e6259cc6461bdf413")

set(MFBE_CEF_FILE_macosx64
  "cef_binary_${MFBE_CEF_VERSION_macosx64}_macosx64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_macosx64 "6a76dc19c34b7858ba409dc2fa017cb9a2dcd27b")

set(MFBE_CEF_FILE_macosarm64
  "cef_binary_${MFBE_CEF_VERSION_macosarm64}_macosarm64_minimal.tar.bz2")
set(MFBE_CEF_SHA1_macosarm64 "4057b6558bc83c93eb955b6983e00ef6361a0ffc")

# vcpkg overlay ports

The ports here replace vcpkg's own of the same name (`VCPKG_OVERLAY_PORTS` in `CMakePresets.json`): each is a
vcpkg port in another form than the manifest's `builtin-baseline` gives. Its entry says which, and when it can go.

- `fmt/` is vcpkg's `fmt` 12.2.1 port of the baseline (microsoft/vcpkg `ea49500a3353`) with one change: the
  backport of fmt PR 4813 ("Fix fallback uint128 bitwise not", fmt commit `588b3a0f`), which the port downloads from
  that GitHub commit, lies here as `fmt-backport-4813.patch` - the same file, its SHA512 the port's. GitHub answered
  the download with HTTP 503 again and again on its own runners (2026-11-20, all three systems), which stopped the
  release of 0.0.12. Remove this overlay when vcpkg's port carries the patch itself.
- `spdlog/` is vcpkg's `spdlog` port of the same baseline with the same change for its two backports, spdlog commits
  `1685e694` and `d5af52d9`, kept here as `spdlog-backport-3541.patch` and `spdlog-backport-3543.patch` (their SHA512s
  the port's). It depends on fmt: with fmt's overlay it is built again, and its downloads failed the same way. Of the
  47 ports the editor builds, these two are the only ones that download a patch from a GitHub commit; remove this
  overlay with fmt's.
- `tesseract/` is vcpkg's `tesseract` 5.5.4 port of the same baseline with `-DOPENMP_BUILD=OFF` added to
  `vcpkg_cmake_configure`. Upstream Tesseract enables OpenMP by default on MSVC and GCC; on Windows static builds
  (`x64-windows-static`, `/MT`), MSVC OpenMP links `vcomp140.dll` dynamically, which would break standalone/portable
  installations lacking the Visual C++ Redistributable. `mfbe-pdf-reader` parallelizes OCR across pages with C++
  `std::thread` workers instead, so OpenMP is unnecessary on all three platforms.

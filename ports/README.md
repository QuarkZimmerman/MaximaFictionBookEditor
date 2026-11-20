# vcpkg overlay ports

The ports here replace vcpkg's own of the same name (`VCPKG_OVERLAY_PORTS` in `CMakePresets.json`): each is a
vcpkg port in another form than the manifest's `builtin-baseline` gives. Its entry says which, and when it can go.

- `fmt/` is vcpkg's `fmt` 12.2.1 port of the baseline (microsoft/vcpkg `ea49500a3353`) with one change: the
  backport of fmt PR 4813 ("Fix fallback uint128 bitwise not", fmt commit `588b3a0f`), which the port downloads from
  that GitHub commit, lies here as `fmt-backport-4813.patch` - the same file, its SHA512 the port's. GitHub answered
  the download with HTTP 503 again and again on its own runners (2026-11-20, all three systems), which stopped the
  release of 0.0.12. Remove this overlay when vcpkg's port carries the patch itself.

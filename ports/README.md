# vcpkg overlay ports

The ports here replace vcpkg's own of the same name (`VCPKG_OVERLAY_PORTS` in `CMakePresets.json`): each is a
vcpkg port in another form than the manifest's `builtin-baseline` gives. Its entry says which, and when it can go.

- `poppler/` is vcpkg's own `poppler` 26.4.0 port-version 1, copied unchanged from microsoft/vcpkg commit
  `ea49500a3353` (2026-11-18, "Patch Tuesday November 2026"). Its `fix-incomplete-types.patch` defines
  `Object(std::unique_ptr<Array>)` in `Object.cc`, where `Array` is complete: MSVC 14.52 (the Windows runner image of
  2026-11-16 on) rejects the inline definition in `Object.h` (C2027, C2338). Moving the `builtin-baseline` there
  instead would update 34 of the 47 ports the editor builds; remove this overlay when the baseline reaches that
  commit.

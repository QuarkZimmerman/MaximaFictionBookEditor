# vcpkg overlay ports

The ports here replace vcpkg's own of the same name (`VCPKG_OVERLAY_PORTS` in `CMakePresets.json`). Each is
vcpkg's port at the manifest's `builtin-baseline`, unchanged but for the patches named below; remove it once
vcpkg's port builds without them.

- `poppler/` (26.4.0) adds `msvc-incomplete-array.patch`. MSVC 14.52 (the Windows runner image of
  2026-11-16 on) refuses `poppler/Object.h`: `Object(std::unique_ptr<Array>)` takes the pointer by value in an
  inline constructor, where `Array` is only declared, and the newer standard library instantiates its deleter
  there (C2027, C2338). The patch takes it by rvalue reference, as the `Dict` constructor beside it already does;
  callers are unchanged, as they pass rvalues either way.

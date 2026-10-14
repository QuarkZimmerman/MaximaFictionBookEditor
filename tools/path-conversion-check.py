#!/usr/bin/env python3
"""Fails on implicit conversions between filesystem paths and narrow text in the C++ sources.

On Windows ``std::filesystem::path(std::string)``, ``path::string()`` and ``generic_string()``
convert through the process code page - the legacy ANSI code page unless the executable's
manifest selects UTF-8 - so a user or folder name with letters outside it turns into a
different, often non-existent, path (feature 002, research R1: the start-up crash on Russian
Windows). Every conversion between paths and text goes through ``platform::path_from_utf8``,
``platform::utf8_from_path`` and ``platform::utf8_from_path_generic`` instead.

Reported in ``core/src``, ``core/include``, ``app/src`` and ``core/main.cpp``
(``core/src/platform/paths.cpp``, which implements the helpers, is exempt):

* ``.string()`` / ``.generic_string()`` calls (also through ``->``);
* ``u8path(``;
* ``std::filesystem::path(...)`` / ``fs::path(...)``, and declarations such as
  ``fs::path p(...)`` / ``fs::path p{...}``, built from anything but nothing or a wide string
  literal (``L"..."``).

A line that converts on purpose carries ``// path-text: <reason>`` (for example text that is not
a path, or a wide string from the Windows API). Implicit conversions - a ``std::string`` passed
where a path is expected - cannot be seen here; the Windows core tests, which run with the
legacy code page, cover them with non-English file and folder names.

Usage: python3 tools/path-conversion-check.py   (from the repository root; exit 1 on findings)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ROOTS = ("core/src", "core/include", "app/src", "core/main.cpp")
SUFFIXES = {".cpp", ".hpp", ".h", ".mm"}
EXEMPT_FILES = {"core/src/platform/paths.cpp"}
MARKER = "// path-text:"

STRING_CALL = re.compile(r"(?:\.|->)(?:generic_)?string\(\)")
U8PATH = re.compile(r"\bu8path\(")
PATH_CTOR = re.compile(r"\b(?:std::filesystem::|filesystem::|fs::)path\((?!\)|L\")")
PATH_DECL = re.compile(r"\b(?:std::filesystem::|filesystem::|fs::)path\s+\w+\s*[({](?![)}]|L\")(.*)")
# "Type name" pairs inside the parentheses make the line a function declaration, not a variable.
TYPED_PARAMETER = re.compile(r"\b[\w:<>]+[&*]?\s+[&*]?\w+\s*(?:[,=)]|$)")


def strip_comments_and_strings(line: str) -> str:
    """The code part of a line: string literals blanked, a trailing // comment removed."""
    code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
    index = code.find("//")
    return code if index < 0 else code[:index]


def main() -> int:
    findings: list[str] = []
    for root in ROOTS:
        top = REPO / root
        for path in [top] if top.is_file() else sorted(top.rglob("*")):
            if path.suffix not in SUFFIXES or not path.is_file():
                continue
            relative = path.relative_to(REPO).as_posix()
            if relative in EXEMPT_FILES:
                continue
            in_block_comment = False
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                stripped = line.strip()
                if in_block_comment:
                    if "*/" in stripped:
                        in_block_comment = False
                    continue
                if stripped.startswith("/*") and "*/" not in stripped:
                    in_block_comment = True
                    continue
                if MARKER in line:
                    continue
                code = strip_comments_and_strings(line)
                declaration = PATH_DECL.search(code)
                if declaration and TYPED_PARAMETER.search(declaration.group(1)):
                    declaration = None  # a function returning a path
                for found, what in ((STRING_CALL.search(code), "path to narrow text"),
                                    (U8PATH.search(code), "u8path"),
                                    (PATH_CTOR.search(code) or declaration,
                                     "path built from narrow text")):
                    if found:
                        findings.append(f"{relative}:{number}: {what}: {stripped}")
                        break
    for finding in findings:
        print(finding)
    if findings:
        print(f"path-conversion-check: {len(findings)} implicit conversion(s); use "
              "platform::path_from_utf8 / utf8_from_path (or mark the line "
              f"'{MARKER} <reason>')", file=sys.stderr)
        return 1
    print("path-conversion-check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

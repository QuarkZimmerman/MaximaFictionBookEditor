#!/usr/bin/env python3
"""Fails when tracked paths would break a Windows or macOS checkout.

Checks: names ending in '.' or ' ', reserved characters <>:"|?*, reserved device names,
paths that differ only in letter case (case-insensitive file systems), and non-NFC Unicode.
Run from the repository root: python3 tools/path-portability-check.py
"""
from __future__ import annotations

import collections
import os
import re
import subprocess
import sys
import unicodedata

RESERVED = re.compile(r'[<>:"|?*\x00-\x1f]')
# Shipped data paths (scripts/, resources/) additionally avoid characters that rpmbuild %files
# globbing, CMake lists and shells treat specially.
SHIPPED_UNSAFE = re.compile(r"[\[\]{}!~;&`$%'\\]")
DEVICES = {"CON", "PRN", "AUX", "NUL"} | {f"{p}{n}" for p in ("COM", "LPT") for n in range(1, 10)}


def main() -> int:
    out = subprocess.run(["git", "-c", "core.quotepath=off", "ls-files", "-z"], check=True,
                         capture_output=True).stdout.decode("utf-8")
    paths = [p for p in out.split("\0") if p]
    problems: list[str] = []
    seen: dict[str, set[str]] = collections.defaultdict(set)
    for path in paths:
        if unicodedata.normalize("NFC", path) != path:
            problems.append(f"{path}: not NFC-normalised")
        parts = path.split("/")
        if parts[0] in ("scripts", "resources") and SHIPPED_UNSAFE.search(path):
            problems.append(f"{path}: shipped path contains a shell/glob-special character")
        if parts[0] in ("scripts", "resources") and not path.isascii():
            # The Windows Installer database uses code page 1252: installed names must be ASCII.
            problems.append(f"{path}: shipped path is not ASCII")
        for i, part in enumerate(parts):
            if RESERVED.search(part) or part.endswith(".") or part.endswith(" "):
                problems.append(f"{path}: component '{part}' is invalid on Windows")
                break
            if part.split(".")[0].upper() in DEVICES:
                problems.append(f"{path}: component '{part}' is a reserved Windows device name")
                break
            prefix = "/".join(parts[: i + 1])
            seen[os.path.splitext(prefix)[0].lower() if i == len(parts) - 1 else prefix.lower()].add(prefix)
    for group in seen.values():
        stems = {os.path.splitext(p)[0] for p in group}
        if len(stems) > 1:
            problems.append("paths differ only in case (breaks macOS/Windows): " + ", ".join(sorted(group)))
    if problems:
        print("\n".join(sorted(set(problems))))
        print(f"path-portability-check: {len(set(problems))} problem(s)")
        return 1
    print(f"path-portability-check: OK ({len(paths)} tracked paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

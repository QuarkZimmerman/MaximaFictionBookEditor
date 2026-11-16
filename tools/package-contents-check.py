#!/usr/bin/env python3
"""Feature 016 (FR-088; tasks T069): no test tool ships with the editor.

  python3 tools/package-contents-check.py DIR [DIR ...]

Walks each folder - an installed tree (`cmake --install`), the web bundle `ui/dist` - and fails on any file of
the tools the tests read PDFs with: pdf.js, pypdf, veraPDF, Playwright. Names are checked, and the scripts'
contents for pdf.js's own markers, so that a bundler that inlined it is found too. Exit 0 when none is there.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

NAMES = re.compile(r"pdf\.worker|pdfjs|(^|/)pdf(\.min)?\.mjs$|pypdf|verapdf|\.jar$|playwright", re.IGNORECASE)
MARKERS = re.compile(rb"pdfjsVersion|GlobalWorkerOptions|pdfjs-dist")


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    found: list[str] = []
    for folder in map(Path, argv):
        if not folder.is_dir():
            print(f"package-contents-check: no folder {folder}", file=sys.stderr)
            return 2
        for path in folder.rglob("*"):
            if not path.is_file():
                continue
            name = path.relative_to(folder).as_posix()
            if NAMES.search(name):
                found.append(f"{folder}/{name}: a test tool's file")
            elif path.suffix in (".js", ".mjs", ".cjs") and MARKERS.search(path.read_bytes()):
                found.append(f"{folder}/{name}: holds pdf.js")
    for line in found:
        print(f"package-contents-check: {line}", file=sys.stderr)
    print(f"package-contents-check: {'FAIL' if found else 'OK'} ({', '.join(argv)})")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

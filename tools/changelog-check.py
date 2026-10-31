#!/usr/bin/env python3
"""The lint job's check of CHANGELOG.md's short lists (feature 007, FR-075): a thin wrapper of
`tools/changelog-in-short.py --check`, the one parser the Release workflow uses too."""

import runpy
import sys

if __name__ == "__main__":
    sys.argv = [sys.argv[0], "--check"]
    runpy.run_path(str(__import__("pathlib").Path(__file__).with_name("changelog-in-short.py")), run_name="__main__")

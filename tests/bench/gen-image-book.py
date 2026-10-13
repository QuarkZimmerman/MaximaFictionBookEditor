#!/usr/bin/env python3
"""Generate the 150 MB image-heavy benchmark book (T150, SC-002).

Thin wrapper around tests/fixtures/gen-large-book.py with the benchmark defaults: 300 sections,
each with a title, one block image and six paragraphs, plus 300 large binaries (200 noise PNGs
and 100 baseline JPEGs, 2:1) sized so the file reaches 150 MB. Deterministic for a given seed;
written to a temporary/work directory, never committed.

Usage: gen-image-book.py --out /path/images-150mb.fb2 [--size-mb 150] [--images 300] [--seed 1]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

GENERATOR = Path(__file__).resolve().parents[1] / "fixtures" / "gen-large-book.py"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="output .fb2 path")
    parser.add_argument("--size-mb", type=float, default=150.0)
    parser.add_argument("--images", type=int, default=300)
    parser.add_argument("--image-mix", default="2:1", help="PNG:JPEG ratio")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    command = [
        sys.executable,
        str(GENERATOR),
        "--out",
        args.out,
        "--size-mb",
        str(args.size_mb),
        "--images",
        str(args.images),
        "--image-mix",
        args.image_mix,
        "--seed",
        str(args.seed),
    ]
    return subprocess.call(command)


if __name__ == "__main__":
    sys.exit(main())

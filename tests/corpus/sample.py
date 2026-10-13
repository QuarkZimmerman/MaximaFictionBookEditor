#!/usr/bin/env python3
"""Deterministic sampler for the local FB2 test corpus.

The corpus at /book_disk/books/ is a large library laid out as
<range>/<sub-range>/<id>/<id>.fb2 (plus cover JPEGs, index.html and sometimes
<id>.fbd descriptor files). This tool never writes into the corpus; it only
produces a text file with one absolute path per line that other tools and the
corpus test consume.

Usage:
  tests/corpus/sample.py --count 500 --seed 1 [--include-fbd] [--root /book_disk/books]
Output: tests/corpus/sample-<seed>-<count>.txt (git-ignored) and a short summary.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from pathlib import Path

DEFAULT_ROOT = Path("/book_disk/books")


def iter_books(root: Path, include_fbd: bool):
    """Yield candidate files quickly without statting every file in the library."""
    exts = {".fb2"} | ({".fbd"} if include_fbd else set())
    with os.scandir(root) as ranges:
        for rng in sorted(ranges, key=lambda e: e.name):
            if not rng.is_dir():
                continue
            with os.scandir(rng.path) as subs:
                for sub in sorted(subs, key=lambda e: e.name):
                    if not sub.is_dir():
                        continue
                    with os.scandir(sub.path) as books:
                        for book in sorted(books, key=lambda e: e.name):
                            if not book.is_dir():
                                continue
                            try:
                                names = os.listdir(book.path)
                            except OSError:
                                continue
                            for name in names:
                                if os.path.splitext(name)[1].lower() in exts:
                                    yield os.path.join(book.path, name)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=500)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--include-fbd", action="store_true")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--max-scan", type=int, default=0,
                    help="stop scanning after this many candidate files (0 = whole library)")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    if not args.root.is_dir():
        print(f"corpus root not found: {args.root}", file=sys.stderr)
        return 2

    candidates = []
    for i, path in enumerate(iter_books(args.root, args.include_fbd)):
        candidates.append(path)
        if args.max_scan and i + 1 >= args.max_scan:
            break
    if not candidates:
        print("no books found", file=sys.stderr)
        return 1

    rnd = random.Random(args.seed)
    rnd.shuffle(candidates)
    chosen = sorted(candidates[: args.count])

    out = args.out or Path(__file__).resolve().parent / f"sample-{args.seed}-{args.count}.txt"
    out.write_text("\n".join(chosen) + "\n", encoding="utf-8")
    total_bytes = sum(os.path.getsize(p) for p in chosen)
    print(f"scanned {len(candidates)} candidates, wrote {len(chosen)} paths to {out} "
          f"({total_bytes / 1e6:.1f} MB total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

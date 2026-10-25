#!/usr/bin/env python3
"""Deterministic sampler for the local FB2 test corpus.

The corpus at /book_disk/books/ is a large library laid out as
<range>/<sub-range>/<id>/<id>.fb2 (plus cover JPEGs, index.html and sometimes
<id>.fbd descriptor files). This tool never writes into the corpus; it only
produces a text file with one absolute path per line that other tools and the
corpus test consume.

Whole-library mode (no --containing, --matching or --ids): lists every book
folder, shuffles the candidates with --seed and keeps --count of them.

Draw mode (--containing and/or --matching; feature 006, the corpus strata of
SC-004): book ids drawn from 1 to --max-id by random.Random(--seed) in a fixed
order, each path built from the id as the library lays it out
(<range of 250,000>/<range of 500>/<id, 8 digits>/<id>.fb2, each range
%08d-%08d), with no directory listing (the NFS mount is slow); ids without a
file are skipped. Each book is read once, by --threads reader threads, and kept
when its bytes hold TEXT (--containing; ASCII-compatible encodings and UTF-16
LE or BE alike) and its text, decoded by its BOM or XML declaration, matches
REGEX (--matching). The first --count matches in draw order are written sorted,
the same list whatever the number of threads.

Ids mode (--ids): the paths of the given ids; a missing one is reported.

Usage:
  tests/corpus/sample.py --count 500 --seed 1 [--include-fbd] [--root /book_disk/books]
  tests/corpus/sample.py --containing "<table" --count 300 --seed 6 --out LIST [--threads 8] [--max-id 652500]
  tests/corpus/sample.py --matching REGEX --count 5 --seed 6 --out LIST
  tests/corpus/sample.py --ids ID [ID ...] --out LIST
Output: the whole-library mode writes tests/corpus/sample-<seed>-<count>.txt by
default (git-ignored); the other modes write --out. A short summary goes to stdout.
See tests/corpus/README.md for the recipes of the strata.
"""
from __future__ import annotations

import argparse
import codecs
import collections
import os
import random
import re
import sys
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

DEFAULT_ROOT = Path("/book_disk/books")
DEFAULT_MAX_ID = 652500


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


# ------------------------------------------------------------------------------------------
# Draw and ids modes (feature 006)
# ------------------------------------------------------------------------------------------


def book_path(root: Path, book_id: int) -> Path:
    """The library's path of a book id, e.g. 6 ->
    <root>/00000001-00250000/00000001-00000500/00000006/6.fb2."""
    top = (book_id - 1) // 250_000 * 250_000 + 1
    sub = (book_id - 1) // 500 * 500 + 1
    return (
        root
        / f"{top:08d}-{top + 249_999:08d}"
        / f"{sub:08d}-{sub + 499:08d}"
        / f"{book_id:08d}"
        / f"{book_id}.fb2"
    )


def draw_order(seed: int, max_id: int) -> list[int]:
    """Every id from 1 to max_id, in the fixed order random.Random(seed) gives them."""
    ids = list(range(1, max_id + 1))
    random.Random(seed).shuffle(ids)
    return ids


_BOMS = (
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF32_LE, "utf-32-le"),  # before UTF-16 LE, whose BOM it starts with
    (codecs.BOM_UTF32_BE, "utf-32-be"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)
_XML_ENCODING = re.compile(rb"""^<\?xml[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']""")


def decode_book(data: bytes) -> str:
    """The text of a book, decoded by its BOM, else by its XML declaration (UTF-16 without a
    BOM recognised by the `<?` it starts with), else as UTF-8; undecodable bytes are replaced."""
    for bom, encoding in _BOMS:
        if data.startswith(bom):
            return data[len(bom) :].decode(encoding, errors="replace")
    if data.startswith(b"<\x00?\x00"):
        return data.decode("utf-16-le", errors="replace")
    if data.startswith(b"\x00<\x00?"):
        return data.decode("utf-16-be", errors="replace")
    declared = _XML_ENCODING.match(data.lstrip()[:512])
    encoding = declared.group(1).decode("ascii") if declared else "utf-8"
    try:
        return data.decode(encoding, errors="replace")
    except LookupError:  # an encoding Python does not know
        return data.decode("utf-8", errors="replace")


@dataclass(frozen=True)
class Probe:
    """What reading one candidate gave."""

    exists: bool
    size: int = 0
    matched: bool = False
    utf16: bool = False  # matched through the UTF-16 spelling of --containing


def make_check(
    root: Path, containing: str | None, matching: re.Pattern[str] | None
) -> Callable[[int], Probe]:
    needles = []
    if containing is not None:
        needles = [
            (containing.encode("utf-8"), False),  # every ASCII-compatible encoding for ASCII TEXT
            (containing.encode("utf-16-le"), True),
            (containing.encode("utf-16-be"), True),
        ]

    def check(book_id: int) -> Probe:
        try:
            with open(book_path(root, book_id), "rb") as fh:
                data = fh.read()
        except (FileNotFoundError, NotADirectoryError):
            return Probe(False)
        except OSError as error:
            print(f"id {book_id}: {error}", file=sys.stderr)
            return Probe(False)
        utf16 = False
        if needles:
            hit = next((wide for needle, wide in needles if needle in data), None)
            if hit is None:
                return Probe(True, len(data))
            utf16 = hit
        if matching is not None and not matching.search(decode_book(data)):
            return Probe(True, len(data))
        return Probe(True, len(data), True, utf16)

    return check


def draw_matches(
    ids: list[int], check: Callable[[int], Probe], count: int, threads: int
) -> tuple[list[int], dict[str, int]]:
    """The first `count` ids in draw order whose probe matched. The readers work ahead of the
    consumer in a bounded window; only the ids consumed in order are counted, so the result
    and the statistics do not depend on the number of threads."""
    stats = {"drawn": 0, "books": 0, "bytes": 0, "missing": 0, "utf16": 0}
    matches: list[int] = []
    window: collections.deque[tuple[int, Future[Probe]]] = collections.deque()
    pending = iter(ids)
    with ThreadPoolExecutor(max_workers=threads) as pool:

        def fill() -> None:
            while len(window) < threads * 4:
                book_id = next(pending, None)
                if book_id is None:
                    return
                window.append((book_id, pool.submit(check, book_id)))

        fill()
        while window and len(matches) < count:
            book_id, future = window.popleft()
            probe = future.result()
            stats["drawn"] += 1
            if not probe.exists:
                stats["missing"] += 1
            else:
                stats["books"] += 1
                stats["bytes"] += probe.size
                if probe.matched:
                    matches.append(book_id)
                    stats["utf16"] += probe.utf16
            if stats["drawn"] % 5000 == 0:
                print(
                    f"  {stats['drawn']} ids drawn, {stats['books']} books read"
                    f" ({stats['bytes'] / 1e9:.1f} GB), {len(matches)} matches",
                    file=sys.stderr,
                    flush=True,
                )
            fill()
        for _, future in window:
            future.cancel()
    return matches, stats


def write_list(out: Path, paths: list[str]) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(f"{p}\n" for p in paths), encoding="utf-8")


def run_draw(args: argparse.Namespace) -> int:
    matching = None
    if args.matching is not None:
        try:
            matching = re.compile(args.matching)
        except re.error as error:
            print(f"--matching: not a regular expression: {error}", file=sys.stderr)
            return 2
    check = make_check(args.root, args.containing, matching)
    matches, stats = draw_matches(
        draw_order(args.seed, args.max_id), check, args.count, max(1, args.threads)
    )
    paths = sorted(str(book_path(args.root, book_id)) for book_id in matches)
    write_list(args.out, paths)
    print(
        f"drew {stats['drawn']} ids (seed {args.seed}, 1 to {args.max_id}):"
        f" {stats['books']} books read ({stats['bytes'] / 1e9:.1f} GB),"
        f" {stats['missing']} ids without a file; {len(matches)} matches"
        f" ({stats['utf16']} in UTF-16), wrote {len(paths)} paths to {args.out}"
    )
    if len(matches) < args.count:
        print(f"only {len(matches)} of {args.count} matches up to id {args.max_id}", file=sys.stderr)
        return 1
    return 0


def run_ids(args: argparse.Namespace) -> int:
    paths: set[str] = set()
    missing = 0
    for book_id in args.ids:
        path = book_path(args.root, book_id)
        if path.is_file():
            paths.add(str(path))
        else:
            missing += 1
            print(f"id {book_id}: no file {path}", file=sys.stderr)
    chosen = sorted(paths)
    write_list(args.out, chosen)
    print(f"{len(args.ids)} ids: wrote {len(chosen)} paths to {args.out}, {missing} missing")
    return 1 if missing else 0


def positive_id(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError(f"a book id starts at 1, got {value}")
    return number


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=500)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--include-fbd", action="store_true")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--max-scan", type=int, default=0,
                    help="stop scanning after this many candidate files (0 = whole library)")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--containing", metavar="TEXT",
                    help="draw mode: keep books whose bytes hold TEXT (ASCII-compatible or UTF-16)")
    ap.add_argument("--matching", metavar="REGEX",
                    help="draw mode: keep books whose decoded text matches REGEX")
    ap.add_argument("--ids", type=positive_id, nargs="+", metavar="ID",
                    help="write the paths of these book ids")
    ap.add_argument("--max-id", type=positive_id, default=DEFAULT_MAX_ID,
                    help=f"draw mode: the highest id drawn (default {DEFAULT_MAX_ID})")
    ap.add_argument("--threads", type=int, default=8, help="draw mode: reader threads (default 8)")
    args = ap.parse_args()

    draw = args.containing is not None or args.matching is not None
    if args.ids and draw:
        ap.error("--ids cannot be combined with --containing or --matching")
    if args.containing == "":
        ap.error("--containing needs a non-empty TEXT")
    if (draw or args.ids) and args.out is None:
        ap.error("--containing, --matching and --ids need --out")

    if not args.root.is_dir():
        print(f"corpus root not found: {args.root}", file=sys.stderr)
        return 2
    if args.ids:
        return run_ids(args)
    if draw:
        return run_draw(args)

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

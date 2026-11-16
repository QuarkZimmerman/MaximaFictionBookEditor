#!/usr/bin/env python3
"""Feature 016 (DP-8, DP-9, SC-007; tasks T046): the local calibration of the PDF import on the library's
scanned books - never run by CI, it needs the library (MFBE_LIBRARY, default /book_disk/books).

    python3 tests/pdf/kinds-calibrate.py kinds [--reader <mfbe-pdf-reader>] [--report <file.json>]
    python3 tests/pdf/kinds-calibrate.py paragraphs [--reader <mfbe-pdf-reader>] [--report <file.json>]

kinds       The 24 OCR'd books of spec §4 (BOOKS): every page read by the reader. None of their pages may be
            called a picture of text: covers, title pages, blank pages and illustrations are fine (D19). The
            two whose recognition failed (UNREADABLE, plain words 0.43 and 0.51 in §4) are refused as
            garbled; every other one is read. Their kinds are reported per book.
paragraphs  The 20 prose pages of tests/pdf/paragraph-marks.json (10 of these books, two pages each), marked by
            hand on the pages drawn with the reader's render switch: where each paragraph begins, as the top
            of its first line in points - no book text is kept. The import's layout (ui/src/features/pdf/
            import/layout.ts, run by tests/pdf/layout-paragraphs.mjs) must find at least 90 % of them, and at
            most 10 % of its own paragraph starts may be wrong (SC-007).
Exits 0 when the calibration holds.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LIBRARY = Path(os.environ.get("MFBE_LIBRARY", "/book_disk/books"))
MARKS = REPO / "tests" / "pdf" / "paragraph-marks.json"
# Spec §4: the 12 books with an invisible text layer and the 12 with the text under the page pictures.
BOOKS = [578115, 467051, 630750, 483278, 321637, 619677, 463115, 404720, 501217, 651071, 308296, 503629,
         415943, 503776, 531280, 375680, 384272, 402769, 567569, 307624, 459613, 522080, 386926, 617081]
TOLERANCE = 3.0  # points: a mark and a paragraph start on the same line
# Spec §4: the two OCR layers that read as garbage - refused, as D19 wants them.
UNREADABLE = {321637, 503629}


def path_of(book: int) -> Path:
    r1 = (book - 1) // 250000 * 250000
    r2 = (book - 1) // 500 * 500
    p = lambda n: str(n).zfill(8)  # noqa: E731
    return LIBRARY / f"{p(r1 + 1)}-{p(r1 + 250000)}" / f"{p(r2 + 1)}-{p(r2 + 500)}" / p(book) / f"{book}.pdf"


def read(reader: Path, book: int, folder: Path) -> tuple[list[str], dict]:
    """The reader's page kinds of a book and its last event."""
    folder.mkdir(parents=True, exist_ok=True)
    out = subprocess.run([str(reader), "--pdf", str(path_of(book)), "--out", str(folder)],
                         stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=900)
    kinds, last = [], {}
    for line in out.stdout.splitlines():
        event = json.loads(line)
        if event.get("event") == "page":
            kinds.append(event.get("kind", ""))
        if event.get("event") in ("done", "failed"):
            last = event
    return kinds, last


def kinds_check(reader: Path) -> tuple[bool, list[dict]]:
    ok, report = True, []
    with tempfile.TemporaryDirectory(prefix="mfbe-kinds-") as tmp:
        for book in BOOKS:
            kinds, last = read(reader, book, Path(tmp) / str(book))
            counts = {k: kinds.count(k) for k in sorted(set(kinds))}
            showing = [n + 1 for n, kind in enumerate(kinds) if kind == "pictureShowingText"]
            if book in UNREADABLE:
                fine = last.get("event") == "failed" and last.get("reason") == "garbled" and not showing
            else:
                fine = last.get("event") == "done" and not showing
            ok = ok and fine
            report.append({"book": book, "pages": len(kinds), "kinds": counts, "end": last,
                           "picturesOfText": showing})
            print(f"{book}: {len(kinds)} pages {counts} -> {last.get('event')} "
                  f"{last.get('reason', last.get('garbledShare', ''))}" + ("" if fine else "  <-- FAILS"))
    return ok, report


def paragraphs_check(reader: Path) -> tuple[bool, list[dict]]:
    marks = json.loads(MARKS.read_text(encoding="utf-8"))
    found = wrong = total = starts = 0
    report = []
    with tempfile.TemporaryDirectory(prefix="mfbe-paragraphs-") as tmp:
        for entry in marks["pages"]:
            book, page = entry["book"], entry["page"]
            folder = Path(tmp) / str(book)
            if not (folder / "document.json").exists():
                read(reader, book, folder)
            runner = subprocess.run(["node", str(REPO / "tests" / "pdf" / "layout-paragraphs.mjs"),
                                     str(folder / f"page-{page}.json")],
                                    capture_output=True, text=True, timeout=300, cwd=REPO / "ui")
            if runner.returncode != 0:
                print(runner.stderr, file=sys.stderr)
                return False, report
            tops = json.loads(runner.stdout)["starts"]
            hits = [m for m in entry["starts"] if any(abs(m - t) <= TOLERANCE for t in tops)]
            false = [t for t in tops if not any(abs(m - t) <= TOLERANCE for m in entry["starts"])]
            found += len(hits)
            total += len(entry["starts"])
            wrong += len(false)
            starts += len(tops)
            report.append({"book": book, "page": page, "marks": len(entry["starts"]), "found": len(hits),
                           "starts": len(tops), "wrong": len(false)})
            print(f"{book} p{page}: {len(hits)}/{len(entry['starts'])} found, {len(false)} of {len(tops)} wrong")
    recall = found / total if total else 1.0
    false_share = wrong / starts if starts else 0.0
    print(f"paragraph starts found: {recall:.0%} (needs >= 90 %), wrong: {false_share:.0%} (needs <= 10 %)")
    return recall >= 0.9 and false_share <= 0.1, report


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] not in ("kinds", "paragraphs"):
        print(__doc__, file=sys.stderr)
        return 2
    reader = REPO / "build" / "linux-core-debug" / "bin" / "mfbe-pdf-reader"
    report_file = None
    for i, a in enumerate(args):
        if a == "--reader":
            reader = Path(args[i + 1])
        if a == "--report":
            report_file = Path(args[i + 1])
    if not LIBRARY.exists():
        print(f"kinds-calibrate: no library at {LIBRARY} (MFBE_LIBRARY)", file=sys.stderr)
        return 2
    ok, report = kinds_check(reader) if args[0] == "kinds" else paragraphs_check(reader)
    if report_file:
        report_file.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print("kinds-calibrate: " + ("holds" if ok else "FAILS"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Feature 012 (T065; DP-19; SC-022): the corpus gate's EPUB import run.

  tests/corpus/epub-import.py LIST [--out DIR] [--core PATH]

Every EPUB of LIST (as `sample.py --ext epub` writes it) is imported by the editor itself (the journey
ui/tests/e2e/corpus-epub.spec.ts; build ui/dist first), each within a time limit, and the new book's
bodies are validated. A book the core refuses - DRM, or not a readable EPUB - is listed with its
message and is no fault. DIR/report.txt and DIR/report.json give the outcome. The exit code is 0 only
when no import failed or hung and every new book's bodies are valid FB2 2.1.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import arguments, report, run_journey, timing  # noqa: E402


def main() -> int:
    args = arguments(__doc__, "epub-import")
    records = run_journey("import", args.list, args.out, args.core)
    failed = [record for record in records if record.get("failure")]
    refused = [record for record in records if record.get("refused")]
    imported = [record for record in records if "bodyErrors" in record]
    invalid = [record for record in imported if record["bodyErrors"]]
    lines = [
        f"EPUB import of {len(records)} book(s) from {args.list}: {len(imported)} imported"
        f" ({len(imported) - len(invalid)} with valid bodies, {len(invalid)} invalid),"
        f" {len(refused)} refused by the core, {len(failed)} failed or hung ({timing(records)})"
    ]
    lines += [f"  failed: {record['book']}: {record['failure']}" for record in failed]
    for record in invalid:
        lines.append(f"  invalid bodies: {record['book']}: {'; '.join(record['bodyErrors'][:3])}")
        if record.get("kept"):
            lines.append(f"    the new book: {record['kept']}")
    lines += [f"  refused: {record['book']}: {record['refused']}" for record in refused]
    report(args.out, lines, {"books": len(records), "imported": len(imported), "invalid": invalid,
                             "refused": refused, "failed": failed})
    return 0 if not failed and not invalid else 1


if __name__ == "__main__":
    raise SystemExit(main())

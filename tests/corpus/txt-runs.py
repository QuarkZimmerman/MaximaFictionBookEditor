#!/usr/bin/env python3
"""Feature 017 (T060, D42): the corpus gate's TXT runs - the journey ui/tests/e2e/corpus-txt.spec.ts over a list.

    tests/corpus/txt-runs.py export|round-trip|import LIST [--out DIR] [--core PATH]

export: every word of each FB2 book in its TXT, in order (SC-002). round-trip: the editor's own TXT in UTF-8 and
every encoding of the book's language read back with its title and notes (SC-003, SC-004, SC-007). import: each
text file imports or is refused with a message, never a crash or a hang (SC-006, SC-008). layouts: TXT files
written from the sample in the five layouts of SC-005 (make-fixtures.py --sample) come back paragraph by paragraph. Writes report.txt and
report.json in the out folder; exit 1 when any file fails. Build ui/dist first.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import REPO, report, run_journey  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=("export", "round-trip", "import", "layouts"))
    ap.add_argument("list", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--core", type=Path, default=REPO / "build" / "linux-core-release" / "bin" / "mfbe-core")
    args = ap.parse_args()
    out = args.out or REPO / "tests" / "corpus" / "out" / f"txt-{args.mode}"
    records = run_journey(args.mode, args.list, out, args.core, spec="corpus-txt")
    failed = [r for r in records if not r.get("ok")]
    lines = [f"TXT {args.mode}: {len(records) - len(failed)} of {len(records)} passed"]
    lines += [f"FAIL {r['file']}: {r.get('detail', '')}" for r in failed]
    report(out, lines, {"mode": args.mode, "records": records})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

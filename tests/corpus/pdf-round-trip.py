#!/usr/bin/env python3
"""Feature 016 (T065; D32; SC-002): the corpus gate's PDF round trip.

  tests/corpus/pdf-round-trip.py LIST [--out DIR] [--core PATH]

Every FB2 book of LIST is exported to PDF in A5 by the editor, imported again and compared with its original
(the journey ui/tests/e2e/us1-pdf-round-trip.spec.ts over the list; build ui/dist first). Apart from D6's
differences every valid book must come back equal; an invalid original is reported apart, and a valid book
that comes back invalid - or an invalid one that comes back with errors its original has not - is a failure
(SC-002, 012's rule). DIR/report.txt and DIR/report.json give the outcome; the exit
code is 0 only when every book came back so.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import REPO, arguments, report  # noqa: E402


def main() -> int:
    args = arguments(__doc__, "pdf-round-trip")
    args.out.mkdir(parents=True, exist_ok=True)
    results = args.out / "results.json"
    results.unlink(missing_ok=True)
    env = {**os.environ, "MFBE_ROUND_TRIP_BOOKS": str(args.list.resolve()),
           "MFBE_ROUND_TRIP_REPORT": str(results.resolve()), "MFBE_CORE_BIN": str(args.core.resolve())}
    npx = "npx.cmd" if os.name == "nt" else "npx"
    run = subprocess.run([npx, "playwright", "test", "us1-pdf-round-trip", "--reporter=line"], cwd=REPO / "ui",
                         env=env)
    if not results.is_file():
        sys.exit(f"us1-pdf-round-trip: the journey wrote no results (exit {run.returncode})")
    records = json.loads(results.read_text(encoding="utf-8"))
    failed = [r for r in records if r.get("failure")]
    # SC-002, the requester's rule from 012: a valid book in and an invalid one out is a bug; an invalid book in
    # tests the invalid case, and fails only when it comes back with errors its original has not.
    again_invalid = [r for r in records if not r.get("failure") and r.get("againInvalid")
                     and (not r.get("invalid") or r.get("againNew"))]
    invalid = [r for r in records if r.get("invalid")]
    differ = [r for r in records if not r.get("failure") and not r.get("invalid") and r["differences"]]
    equal = [r for r in records if not r.get("failure") and not r.get("invalid") and not r["differences"]
             and not r.get("againInvalid")]
    lines = [f"PDF round trip of {len(records)} book(s) from {args.list}: {len(equal)} came back equal apart from D6,"
             f" {len(differ)} differ, {len(again_invalid)} came back invalid, {len(failed)} failed;"
             f" {len(invalid)} invalid original(s) reported apart"]
    lines += [f"  failed: {r['book']}: {r['failure']}" for r in failed]
    lines += [f"  came back invalid: {r['book']}: {'; '.join(r['againInvalid'])}" for r in again_invalid]
    for r in differ:
        lines.append(f"  differs: {r['book']}: {len(r['differences'])} line(s): {' | '.join(r['differences'][:4])}")
    lines += [f"  invalid original: {r['book']}: {'; '.join(r['invalid'])}" for r in invalid]
    report(args.out, lines, {"books": len(records), "equal": len(equal), "differ": differ,
                             "againInvalid": again_invalid, "failed": failed, "invalid": invalid})
    return 0 if not failed and not again_invalid and not differ else 1


if __name__ == "__main__":
    raise SystemExit(main())

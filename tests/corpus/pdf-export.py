#!/usr/bin/env python3
"""Feature 014 (T059; DP-16): the corpus gate's PDF export run.

  tests/corpus/pdf-export.py LIST [--out DIR] [--core PATH]

Every FB2 book of LIST is exported to PDF in A5 by the editor itself (the journey
ui/tests/e2e/corpus-pdf.spec.ts, printed through the journeys' print seam; build ui/dist first) into
DIR. Each file is then checked with veraPDF against the PDF/A-2U profile (tools/ci/verapdf.sh, the
pinned release) and its text read back by pdf.js against the book's own (tests/pdf/text-compare.mjs).
DIR/report.txt and DIR/report.json give the outcome. The exit code is 0 only when every book was
exported - no crash, no hang - and every file passed both checks.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import REPO, arguments, report, run_journey, timing  # noqa: E402


def verapdf(files: list[str]) -> dict[str, str]:
    """veraPDF's verdict for each file that did not pass ("" for one that did)."""
    if not files:
        return {}
    run = subprocess.run(["bash", str(REPO / "tools" / "ci" / "verapdf.sh"), *files], capture_output=True, text=True)
    verdicts = {name: "no verdict" for name in files}
    for line in run.stdout.splitlines():
        for name in files:
            prefix = f"verapdf: {name}: "
            if line.startswith(prefix):
                verdict = line[len(prefix):]
                verdicts[name] = "" if verdict.endswith("no failed rule") else verdict
    return {name: verdict for name, verdict in verdicts.items() if verdict}


def text_compare(pairs: list[tuple[str, str]]) -> dict[str, str]:
    """pdf.js's reading of each file against the book's text: what differed, per file."""
    found: dict[str, str] = {}
    for pdf, expected in pairs:
        run = subprocess.run(["node", str(REPO / "tests" / "pdf" / "text-compare.mjs"), pdf, expected],
                             capture_output=True, text=True)
        if run.returncode != 0:
            found[pdf] = (run.stdout.strip() or run.stderr.strip())[:600]
    return found


def main() -> int:
    args = arguments(__doc__, "pdf-export")
    records = run_journey("pdf", args.list, args.out, args.core, spec="corpus-pdf")
    failed = [record for record in records if record.get("failure")]
    exported = [record for record in records if record.get("pdf")]
    files = [record["pdf"] for record in exported]
    invalid = verapdf(files)
    unread = text_compare([(record["pdf"], record["expected"]) for record in exported])
    lines = [
        f"PDF export of {len(records)} book(s) from {args.list}: {len(files)} exported, {len(failed)} failed;"
        f" veraPDF: {len(files) - len(invalid)} valid; text: {len(files) - len(unread)} read back whole"
        f" ({timing(records)})"
    ]
    lines += [f"  failed: {record['book']}: {record['failure']}" for record in failed]
    lines += [f"  veraPDF: {name}: {verdict}" for name, verdict in invalid.items()]
    lines += [f"  text: {name}: {what}" for name, what in unread.items()]
    report(args.out, lines, {"books": len(records), "exported": len(files), "failed": failed,
                             "verapdf": invalid, "text": unread})
    return 0 if not failed and not invalid and not unread else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Feature 012 (T065; DP-19; SC-022): the corpus gate's EPUB export run.

  tests/corpus/epub-export.py LIST [--out DIR] [--core PATH]

Every FB2 book of LIST is exported to EPUB by the editor itself (the journey
ui/tests/e2e/corpus-epub.spec.ts; build ui/dist first) into DIR, then each file is checked with
EPUBCheck (tools/ci/epubcheck.sh, the pinned release). DIR/report.txt and DIR/report.json give the
outcome. The exit code is 0 only when every book was exported and EPUBCheck reported no fatal error,
no error and no warning on any file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import REPO, arguments, report, run_journey, timing  # noqa: E402


def epubcheck(files: list[str]) -> dict[str, list[str]]:
    """EPUBCheck's findings for each file, [] for a file that passed."""
    findings: dict[str, list[str]] = {name: [] for name in files}
    if not files:
        return findings
    run = subprocess.run(["bash", str(REPO / "tools" / "ci" / "epubcheck.sh"), *files],
                         capture_output=True, text=True)
    if run.returncode not in (0, 1):
        sys.exit(f"epub-export: EPUBCheck did not run (exit {run.returncode}): {run.stderr.strip()[:400]}")
    for line in run.stdout.splitlines():
        for name in files:
            prefix = f"epubcheck: {name}: "
            if line.startswith(prefix):
                if line[len(prefix):] != "OK":
                    findings[name].append(line[len(prefix):])
                break
    return findings


def main() -> int:
    args = arguments(__doc__, "epub-export")
    records = run_journey("export", args.list, args.out, args.core)
    failed = [record for record in records if record.get("failure")]
    files = [record["epub"] for record in records if record.get("epub")]
    unclean = {name: messages for name, messages in epubcheck(files).items() if messages}
    lines = [
        f"EPUB export of {len(records)} book(s) from {args.list}: {len(files)} exported, {len(failed)} failed;"
        f" EPUBCheck: {len(files) - len(unclean)} clean, {len(unclean)} with findings ({timing(records)})"
    ]
    lines += [f"  failed: {record['book']}: {record['failure']}" for record in failed]
    for name, messages in unclean.items():
        lines.append(f"  EPUBCheck: {name}")
        lines += [f"    {message}" for message in messages[:10]]
    report(args.out, lines, {"books": len(records), "exported": len(files), "failed": failed, "epubcheck": unclean})
    return 0 if not failed and not unclean else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Feature 012 (T065; DP-19; SC-022): what the corpus gate's two EPUB runs share.

Both runs go through the editor itself: the journey ui/tests/e2e/corpus-epub.spec.ts drives the real
core and the built interface (ui/dist) over a list of books and writes one record per book to
<out>/results.json; tests/corpus/epub-export.py and epub-import.py judge those records.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def arguments(description: str | None, default_out: str) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list", type=Path, help="the books, one path per line (as sample.py writes it)")
    ap.add_argument("--out", type=Path, default=REPO / "tests" / "corpus" / "out" / default_out,
                    help=f"the results' folder (default tests/corpus/out/{default_out})")
    ap.add_argument("--core", type=Path, default=None,
                    help="mfbe-core (default: the release build, else the debug one)")
    args = ap.parse_args()
    if args.core is None:
        for candidate in ("build/linux-core-release/bin/mfbe-core", "build/linux-core-debug/bin/mfbe-core"):
            if (REPO / candidate).is_file():
                args.core = REPO / candidate
                break
    if args.core is None or not args.core.is_file():
        ap.error("no mfbe-core found: build it, or pass --core")
    if not (REPO / "ui" / "dist" / "index.html").is_file():
        ap.error("no built interface: run `npm run build` in ui/ first")
    if not args.list.is_file():
        ap.error(f"no list {args.list}")
    return args


def run_journey(mode: str, books: Path, out: Path, core: Path, spec: str = "corpus-epub") -> list[dict]:
    """Runs the journey `spec` in `mode` (export, import; pdf with corpus-pdf, feature 014) over
    `books`; the records it wrote."""
    out.mkdir(parents=True, exist_ok=True)
    results = out / "results.json"
    results.unlink(missing_ok=True)
    env = {
        **os.environ,
        "MFBE_CORPUS_MODE": mode,
        "MFBE_CORPUS_LIST": str(books.resolve()),
        "MFBE_CORPUS_OUT": str(out.resolve()),
        "MFBE_CORE_BIN": str(core.resolve()),
    }
    npx = "npx.cmd" if os.name == "nt" else "npx"
    # No shell: the arguments reach Playwright as they are.
    run = subprocess.run([npx, "playwright", "test", spec, "--reporter=line"], cwd=REPO / "ui", env=env)
    if not results.is_file():
        sys.exit(f"{spec}: the journey wrote no results (exit {run.returncode})")
    return json.loads(results.read_text(encoding="utf-8"))


def timing(records: list[dict]) -> str:
    ms = [record["ms"] for record in records]
    if not ms:
        return "no books"
    return (f"{sum(ms) / 1000:.0f} s in all, median {statistics.median(ms) / 1000:.1f} s,"
            f" longest {max(ms) / 1000:.1f} s")


def report(out: Path, lines: list[str], data: dict) -> None:
    """Writes out/report.txt and out/report.json, and prints the text."""
    text = "\n".join(lines) + "\n"
    (out / "report.txt").write_text(text, encoding="utf-8")
    (out / "report.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(text, end="")

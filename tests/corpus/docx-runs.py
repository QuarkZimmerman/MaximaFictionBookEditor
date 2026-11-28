#!/usr/bin/env python3
"""Feature 023 (T046, SC-001, SC-002, SC-003): Corpus gate DOCX runs.

    tests/corpus/docx-runs.py round-trip|import LIST [--out DIR] [--core PATH] [--limit N]

Modes:
  round-trip  Export reference-all-elements.fb2 + every FB2 book in LIST as DOCX, verify Calibre
              `ebook-convert` accepts the exported DOCX (or sample/full check), measure export
              duration, and re-import via MFBE verifying valid originals remain valid FB2 2.1.
  import      Import foreign DOCX files in LIST (if LIST points to .fb2 sources, first converts
              up to --limit diverse books with Calibre `ebook-convert` into <out>/calibre-foreign/),
              verifying valid FB2 2.1 output and zero crashes.

Writes report.txt and report.json in the output directory; exits 1 on any failure. Build ui/dist first.
"""
from __future__ import annotations

import argparse
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from epub_gate import REPO, report, run_journey, timing  # noqa: E402


def read_list(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def prepare_roundtrip_list(src_list: Path, out: Path) -> Path:
    items = read_list(src_list)
    ref = REPO / "tests" / "fixtures" / "books" / "reference-all-elements.fb2"
    picked: list[str] = [str(ref)] if ref.is_file() else []
    picked.extend(items)
    out.mkdir(parents=True, exist_ok=True)
    dst = out / "roundtrip-list.txt"
    dst.write_text("\n".join(picked) + "\n", encoding="utf-8")
    return dst


def prepare_foreign_list(src_list: Path, out: Path, limit: int = 10) -> Path:
    items = read_list(src_list)
    if items and all(Path(p).suffix.lower() == ".docx" for p in items):
        return src_list
    if not shutil.which("ebook-convert"):
        sys.exit("docx-runs: Calibre `ebook-convert` is required to generate foreign DOCX files")
    gen_dir = out / "calibre-foreign"
    gen_dir.mkdir(parents=True, exist_ok=True)
    generated: list[str] = []
    step = max(1, len(items) // max(1, limit))
    for idx in range(0, len(items), step):
        if len(generated) >= limit:
            break
        src = items[idx]
        dst = gen_dir / f"foreign-{len(generated):03d}.docx"
        if not dst.is_file() or dst.stat().st_size == 0:
            res = subprocess.run(
                ["ebook-convert", src, str(dst)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=120,
            )
            if res.returncode != 0 or not dst.is_file():
                continue
        generated.append(str(dst))
    dst_list = out / "foreign-list.txt"
    dst_list.write_text("\n".join(generated) + "\n", encoding="utf-8")
    return dst_list


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=("round-trip", "import"))
    ap.add_argument("list", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument(
        "--core",
        type=Path,
        default=REPO / "build" / "linux-core-release" / "bin" / "mfbe-core",
    )
    ap.add_argument(
        "--limit", type=int, default=10, help="max foreign books to convert in import mode"
    )
    args = ap.parse_args()

    out = args.out or (REPO / "tests" / "corpus" / "out" / f"docx-{args.mode}")
    if args.mode == "round-trip":
        run_list = prepare_roundtrip_list(args.list, out)
    else:
        run_list = prepare_foreign_list(args.list, out, limit=args.limit)

    records = run_journey(args.mode, run_list, out, args.core, spec="corpus-docx")
    failed = [r for r in records if not r.get("ok")]
    export_ms = [r["exportMs"] for r in records if isinstance(r.get("exportMs"), (int, float))]
    invalid_orig = [r for r in records if r.get("invalidOriginal")]

    lines = [
        f"DOCX {args.mode}: {len(records) - len(failed)} of {len(records)} passed ({timing(records)})"
    ]
    if export_ms:
        lines.append(
            f"  DOCX export time: median {statistics.median(export_ms):.0f} ms, "
            f"max {max(export_ms):.0f} ms"
        )
    if invalid_orig:
        lines.append(f"  invalid original FB2 books in sample: {len(invalid_orig)}")
    lines += [f"FAIL {r['file']}: {r.get('detail', '')}" for r in failed]
    report(out, lines, {"mode": args.mode, "records": records})
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

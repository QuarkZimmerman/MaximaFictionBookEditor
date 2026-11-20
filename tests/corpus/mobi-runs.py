#!/usr/bin/env python3
"""Feature 018 (T048, SC-001, SC-002, SC-003): Corpus gate MOBI runs.

    tests/corpus/mobi-runs.py export|round-trip|kf8-sample|import LIST [--out DIR] [--core PATH]

Modes:
  export      Export every FB2 book in LIST as MOBI 7, verify PalmDOC prose compression <= 80%
              and Calibre ebook-meta / ebook-convert acceptance (SC-001).
  round-trip  Export every FB2 book in LIST as MOBI 7 and re-import via MFBE, verifying valid
              originals stay valid FB2 2.1 and invalid originals reopen cleanly (SC-002).
  kf8-sample  Export and round-trip reference-all-elements.fb2 + up to 10 diverse books from LIST
              in both joint MOBI 7 + KF8 (.mobi) and standalone KF8 (.azw3) with Calibre checks.
  import      Import foreign MOBI/KF8 files in LIST (if LIST points to .fb2/.epub sources, first
              converts up to 50 of them with Calibre `ebook-convert` into <out>/calibre-foreign/
              alternating .mobi and .azw3), verifying valid FB2 2.1 output and zero crashes (SC-003).

Writes report.txt and report.json in the output directory; exits 1 on any failure. Build ui/dist first.
"""
from __future__ import annotations

import argparse
import shutil
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


def prepare_kf8_list(src_list: Path, out: Path, sample_count: int = 10) -> Path:
    items = read_list(src_list)
    ref = REPO / "tests" / "fixtures" / "books" / "reference-all-elements.fb2"
    picked: list[str] = [str(ref)] if ref.is_file() else []
    if items:
        step = max(1, len(items) // sample_count)
        for i in range(0, len(items), step):
            if len(picked) >= sample_count + 1:
                break
            picked.append(items[i])
    out.mkdir(parents=True, exist_ok=True)
    dst = out / "kf8-sample.txt"
    dst.write_text("\n".join(picked) + "\n", encoding="utf-8")
    return dst


def prepare_foreign_list(src_list: Path, out: Path, limit: int = 50) -> Path:
    items = read_list(src_list)
    mobi_exts = {".mobi", ".azw3", ".azw", ".prc"}
    if items and all(Path(p).suffix.lower() in mobi_exts for p in items):
        return src_list
    if not shutil.which("ebook-convert"):
        sys.exit("mobi-runs: Calibre `ebook-convert` is required to generate foreign MOBI/KF8 files")
    gen_dir = out / "calibre-foreign"
    gen_dir.mkdir(parents=True, exist_ok=True)
    generated: list[str] = []
    for idx, src in enumerate(items):
        if len(generated) >= limit:
            break
        ext = ".azw3" if (idx % 2 == 1) else ".mobi"
        dst = gen_dir / f"foreign-{idx:03d}{ext}"
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
    ap.add_argument("mode", choices=("export", "round-trip", "kf8-sample", "import"))
    ap.add_argument("list", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--core", type=Path, default=REPO / "build" / "linux-core-release" / "bin" / "mfbe-core")
    ap.add_argument("--limit", type=int, default=50, help="max foreign books to convert in import mode")
    args = ap.parse_args()

    out = args.out or (REPO / "tests" / "corpus" / "out" / f"mobi-{args.mode}")
    run_list = args.list
    if args.mode == "kf8-sample":
        run_list = prepare_kf8_list(args.list, out)
    elif args.mode == "import":
        run_list = prepare_foreign_list(args.list, out, limit=args.limit)

    records = run_journey(args.mode, run_list, out, args.core, spec="corpus-mobi")
    failed = [r for r in records if not r.get("ok")]
    ratios = [r["compressionRatio"] for r in records if isinstance(r.get("compressionRatio"), (int, float))]
    invalid_orig = [r for r in records if r.get("invalidOriginal")]

    lines = [
        f"MOBI {args.mode}: {len(records) - len(failed)} of {len(records)} passed ({timing(records)})"
    ]
    if ratios:
        lines.append(
            f"  PalmDOC prose compression ratio: median {sorted(ratios)[len(ratios)//2]*100:.1f}%, "
            f"max {max(ratios)*100:.1f}% (limit 80.0%)"
        )
    if invalid_orig:
        lines.append(f"  invalid original FB2 books in sample: {len(invalid_orig)}")
    lines += [f"FAIL {r['file']}: {r.get('detail', '')}" for r in failed]
    report(out, lines, {"mode": args.mode, "records": records})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

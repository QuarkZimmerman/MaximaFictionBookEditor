#!/usr/bin/env bash
# Corpus round-trip gate (T046, Constitution IV).
#
#   tests/corpus/run.sh SAMPLE_FILE [-j N] [--out DIR] [--core PATH] [--encoding ENC]
#
# Runs `mfbe-core roundtrip --json` for every book listed in SAMPLE_FILE (one path per line,
# as written by sample.py) in parallel (xargs -P), then aggregates:
#   opened / round-tripped (structurally identical) / validated / invalid-with-message /
#   crashed (must be 0) / image binaries not JPEG or PNG after save (reported; must be 0
#   once image conversion (US7) lands) / timing statistics.
# Writes <out>/report.txt (human-readable), <out>/report.json (aggregate) and keeps the
# per-book JSON results in <out>/results/. Exit code 0 when nothing crashed and every book
# that opened round-tripped identically; 1 otherwise.
set -u

usage() {
    echo "usage: $0 SAMPLE_FILE [-j N] [--out DIR] [--core PATH] [--encoding ENC]" >&2
    exit 2
}

[ $# -ge 1 ] || usage
SAMPLE="$1"
shift
[ -f "$SAMPLE" ] || { echo "sample list not found: $SAMPLE" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
JOBS="$(nproc 2>/dev/null || echo 4)"
OUT="$HERE/out"
CORE=""
ENCODING="utf-8"
while [ $# -gt 0 ]; do
    case "$1" in
        -j) JOBS="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --core) CORE="$2"; shift 2 ;;
        --encoding) ENCODING="$2"; shift 2 ;;
        *) usage ;;
    esac
done

if [ -z "$CORE" ]; then
    for candidate in "$REPO/build/linux-core-release/bin/mfbe-core" "$REPO/build/linux-core-debug/bin/mfbe-core"; do
        if [ -x "$candidate" ]; then
            CORE="$candidate"
            break
        fi
    done
fi
if [ -z "$CORE" ] || [ ! -x "$CORE" ]; then
  echo "mfbe-core not found; build a core preset or pass --core" >&2
  exit 2
fi

rm -rf "$OUT/results" "$OUT/books"
mkdir -p "$OUT/results" "$OUT/books"
export CORE OUT ENCODING

# One book ("<n><TAB><path>"): write <n>.json (the roundtrip JSON or a synthetic crash
# record) and <n>.exit.
run_one() {
    local line="$1"
    local n="${line%%$'\t'*}" path="${line#*$'\t'}"
    local json="$OUT/results/$n.json" err="$OUT/results/$n.err"
    local start end
    start=$(date +%s%N)
    "$CORE" roundtrip "$path" --out "$OUT/books/$n" --encoding "$ENCODING" --json > "$json" 2> "$err"
    local code=$?
    end=$(date +%s%N)
    echo "$code" > "$OUT/results/$n.exit"
    if [ "$code" -ge 125 ] || ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$json" 2>/dev/null; then
        python3 - "$json" "$path" "$code" "$err" "$(( (end - start) / 1000000 ))" <<'PY'
import json, sys
out, path, code, err, ms = sys.argv[1:6]
try:
    stderr = open(err, encoding="utf-8", errors="replace").read()[-2000:]
except OSError:
    stderr = ""
json.dump({"path": path, "crashed": True, "exitCode": int(code), "stderr": stderr,
           "timingsMs": {"total": int(ms)}}, open(out, "w"))
PY
    fi
}
export -f run_one

# shellcheck disable=SC2016  # $0 is expanded by the child bash, not here
grep -v '^\s*$' "$SAMPLE" | grep -v '^\s*#' | nl -ba -nln -w1 -s$'\t' | \
    xargs -P "$JOBS" -d '\n' -n 1 bash -c 'run_one "$0"'

python3 - "$OUT" "$SAMPLE" "$CORE" "$ENCODING" <<'PY'
import glob, json, os, statistics, sys
out, sample, core, encoding = sys.argv[1:5]
results = []
for f in sorted(glob.glob(os.path.join(out, "results", "*.json")), key=lambda p: int(os.path.basename(p).split(".")[0])):
    try:
        results.append(json.load(open(f)))
    except Exception as e:  # noqa: BLE001
        results.append({"path": f, "crashed": True, "exitCode": -1, "stderr": str(e)})

total = len(results)
crashed = [r for r in results if r.get("crashed")]
opened = [r for r in results if not r.get("crashed") and r.get("opened")]
not_opened = [r for r in results if not r.get("crashed") and not r.get("opened")]
identical = [r for r in opened if r.get("identical")]
different = [r for r in opened if r.get("reopened") and not r.get("identical")]
not_reopened = [r for r in opened if not r.get("reopened")]
valid = [r for r in identical if r.get("valid")]
invalid = [r for r in opened if r.get("reopened") and not r.get("valid")]
non_jpeg_png = sum(r.get("binaries", {}).get("nonJpegPng", 0) for r in opened)
undecodable = sum(r.get("binaries", {}).get("undecodable", 0) for r in opened)
binaries = sum(r.get("binaries", {}).get("count", 0) for r in opened)
timings = [r["timingsMs"]["total"] for r in results if "timingsMs" in r]
opens = [r["timingsMs"]["open"] for r in opened]
sizes = [r.get("bytes", {}).get("input", 0) for r in opened]
peaks = [r.get("peakRssBytes", 0) for r in opened]

def first_error(r):
    v = r.get("validation", {})
    for issue in v.get("issues", []):
        if issue.get("severity") == "error":
            msg = issue.get("params", {}).get("message") or issue.get("code", "")
            if issue.get("code") == "genre.unknown":
                msg = "genre.unknown " + issue.get("params", {}).get("code", "")
            line = issue.get("line")
            return (f"line {line}: " if line else "") + msg[:140]
    return f"{v.get('errorCount', '?')} errors"

lines = []
lines.append(f"Corpus round-trip report")
lines.append(f"  sample:    {sample} ({total} books)")
lines.append(f"  core:      {core}")
lines.append(f"  encoding:  {encoding}")
lines.append("")
lines.append(f"  opened:                 {len(opened)} / {total}")
lines.append(f"  not opened (parse/io):  {len(not_opened)}")
lines.append(f"  round-tripped (identical): {len(identical)} / {len(opened)}")
lines.append(f"  structurally different: {len(different)}")
lines.append(f"  not re-openable:        {len(not_reopened)}")
lines.append(f"  validated (output valid): {len(valid)}")
lines.append(f"  invalid with message:   {len(invalid)}")
lines.append(f"  crashed:                {len(crashed)}   (must be 0)")
lines.append(f"  binaries total:         {binaries}")
lines.append(f"  image binaries not JPEG/PNG after save: {non_jpeg_png}   (must be 0 once US7 image conversion lands)")
lines.append(f"  undecodable binaries (preserved verbatim): {undecodable}")
if timings:
    lines.append("")
    lines.append(f"  time per book: min {min(timings)} ms, median {int(statistics.median(timings))} ms, "
                 f"max {max(timings)} ms, total {sum(timings)} ms")
if opens:
    lines.append(f"  open time:     median {int(statistics.median(opens))} ms, max {max(opens)} ms")
if sizes:
    lines.append(f"  input size:    median {int(statistics.median(sizes))//1024} KB, max {max(sizes)//1024} KB")
if peaks and max(peaks) > 0:
    lines.append(f"  peak RSS:      max {max(peaks)//1048576} MB")
if not_opened:
    lines.append("")
    lines.append("Not opened:")
    for r in not_opened:
        f = r.get("failure", {})
        where = f" (line {f.get('line')}, column {f.get('column')})" if f.get("line") else ""
        lines.append(f"  {r['path']}: {f.get('message', '?')}{where}")
if different or not_reopened:
    lines.append("")
    lines.append("Round-trip differences:")
    for r in different + not_reopened:
        diffs = r.get("differences", [])
        lines.append(f"  {r['path']}: " + (diffs[0] if diffs else r.get("failure", {}).get("message", "?")))
if invalid:
    lines.append("")
    lines.append("Invalid after round trip (one line each):")
    for r in invalid:
        lines.append(f"  {os.path.basename(r['path'])}: {r['validation'].get('errorCount')} errors; {first_error(r)}")
if crashed:
    lines.append("")
    lines.append("CRASHED:")
    for r in crashed:
        lines.append(f"  {r['path']}: exit {r.get('exitCode')}: {r.get('stderr', '').strip()[-300:]}")
report = "\n".join(lines) + "\n"
open(os.path.join(out, "report.txt"), "w").write(report)
json.dump({"sample": sample, "total": total, "opened": len(opened), "notOpened": len(not_opened),
           "identical": len(identical), "different": len(different), "notReopened": len(not_reopened),
           "valid": len(valid), "invalid": len(invalid), "crashed": len(crashed), "binaries": binaries,
           "nonJpegPng": non_jpeg_png, "undecodable": undecodable,
           "timingsMs": {"total": sum(timings), "max": max(timings) if timings else 0}},
          open(os.path.join(out, "report.json"), "w"), indent=2)
print(report)
sys.exit(0 if not crashed and not different and not not_reopened else 1)
PY

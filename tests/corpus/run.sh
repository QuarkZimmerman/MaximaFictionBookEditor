#!/usr/bin/env bash
# Corpus round-trip gate (T046, Constitution IV).
#
#   tests/corpus/run.sh SAMPLE_FILE [-j N] [--out DIR] [--core PATH] [--encoding ENC]
#                       [--save-hashes FILE] [--check-hashes FILE]
#
# Runs `mfbe-core roundtrip --json` for every book listed in SAMPLE_FILE (one path per line,
# as written by sample.py) in parallel (xargs -P), then aggregates:
#   opened / round-tripped (structurally identical) / validated / invalid-with-message /
#   crashed (must be 0) / image binaries not JPEG or PNG after save (reported; must be 0
#   once image conversion (US7) lands) / timing statistics.
# Writes <out>/report.txt (human-readable), <out>/report.json (aggregate) and keeps the
# per-book JSON results in <out>/results/. Exit code 0 when nothing crashed and every book
# that opened round-tripped identically; 1 otherwise.
#
# Guard G10 (feature 011, research 2.3): --save-hashes writes the SHA-256 of every saved book (a
# save without any Description edit) to FILE, one "<sample path><TAB><sha256>" line per book;
# --check-hashes compares the saves with such a FILE - committed under tests/corpus/baselines/,
# recorded with the 0.0.8 writer - and fails on any book saved differently. Only hashes are
# committed: the library's books stay local.
set -u

usage() {
    echo "usage: $0 SAMPLE_FILE [-j N] [--out DIR] [--core PATH] [--encoding ENC] [--save-hashes FILE] [--check-hashes FILE] [--markdown]" >&2
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
SAVE_HASHES=""
CHECK_HASHES=""
# Feature 011 (FR-081): --markdown also exports every book as Markdown and imports it again.
MARKDOWN=0
while [ $# -gt 0 ]; do
    case "$1" in
        -j) JOBS="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --core) CORE="$2"; shift 2 ;;
        --markdown) MARKDOWN=1; shift ;;
        --encoding) ENCODING="$2"; shift 2 ;;
        --save-hashes) SAVE_HASHES="$2"; shift 2 ;;
        --check-hashes) CHECK_HASHES="$2"; shift 2 ;;
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
# G10 compares saves byte for byte: the document details a save fills in get fixed values.
FIXED=""
if [ -n "$SAVE_HASHES" ] || [ -n "$CHECK_HASHES" ]; then FIXED="--fixed-details"; fi
export CORE OUT ENCODING FIXED

# One book ("<n><TAB><path>"): write <n>.json (the roundtrip JSON or a synthetic crash
# record) and <n>.exit.
run_one() {
    local line="$1"
    local n="${line%%$'\t'*}" path="${line#*$'\t'}"
    local json="$OUT/results/$n.json" err="$OUT/results/$n.err"
    local start end
    start=$(date +%s%N)
    "$CORE" roundtrip "$path" --out "$OUT/books/$n" --encoding "$ENCODING" --json $FIXED > "$json" 2> "$err"
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

python3 - "$OUT" "$SAMPLE" "$CORE" "$ENCODING" "$SAVE_HASHES" "$CHECK_HASHES" <<'PY'
import glob, hashlib, json, os, statistics, sys
out, sample, core, encoding, save_hashes, check_hashes = sys.argv[1:7]
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
def saved_hash(n):
    """SHA-256 of book n's save: the file, or every file of the folder in name order."""
    target = os.path.join(out, "books", str(n))
    files = []
    if os.path.isfile(target):
        files = [target]
    elif os.path.isdir(target):
        for root, _, names in os.walk(target):
            files += [os.path.join(root, name) for name in names]
        files.sort()
    if not files:
        return None
    digest = hashlib.sha256()
    for f in files:
        digest.update(os.path.relpath(f, target).encode("utf-8") + b"\0")
        with open(f, "rb") as handle:
            digest.update(handle.read())
    return digest.hexdigest()

hash_failures = []
if save_hashes or check_hashes:
    hashes = {}
    for f in glob.glob(os.path.join(out, "results", "*.json")):
        n = int(os.path.basename(f).split(".")[0])
        try:
            path = json.load(open(f)).get("path")
        except Exception:  # noqa: BLE001
            continue
        value = saved_hash(n)
        if path and value:
            hashes[path] = value
    if save_hashes:
        with open(save_hashes, "w", encoding="utf-8") as handle:
            for path in sorted(hashes):
                handle.write(f"{path}\t{hashes[path]}\n")
        lines.append("")
        lines.append(f"  saves hashed:  {len(hashes)} -> {save_hashes}")
    if check_hashes:
        baseline = {}
        for line in open(check_hashes, encoding="utf-8"):
            if "\t" in line:
                path, value = line.rstrip("\n").split("\t", 1)
                baseline[path] = value
        for path in sorted(baseline):
            if hashes.get(path) != baseline[path]:
                hash_failures.append(path)
        lines.append("")
        lines.append(f"  saves as recorded (G10): {len(baseline) - len(hash_failures)} / {len(baseline)}   (must be all)")
        for path in hash_failures:
            lines.append(f"    saved differently: {path}")
report = "\n".join(lines) + "\n"
open(os.path.join(out, "report.txt"), "w").write(report)
json.dump({"sample": sample, "total": total, "opened": len(opened), "notOpened": len(not_opened),
           "identical": len(identical), "different": len(different), "notReopened": len(not_reopened),
           "valid": len(valid), "invalid": len(invalid), "crashed": len(crashed), "binaries": binaries,
           "nonJpegPng": non_jpeg_png, "undecodable": undecodable,
           "timingsMs": {"total": sum(timings), "max": max(timings) if timings else 0}},
          open(os.path.join(out, "report.json"), "w"), indent=2)
print(report)
sys.exit(0 if not crashed and not different and not not_reopened and not hash_failures else 1)
PY
status=$?
# Feature 011 (FR-081): the sample exported as Markdown and imported again (ui/tests/corpus/).
if [ "$MARKDOWN" = 1 ]; then
    (cd "$(dirname "$0")/../../ui" && MFBE_CORPUS_LIST="$(realpath "$SAMPLE")" \
        MFBE_CORE_BIN="$(realpath "${CORE:-build/linux-core-release/bin/mfbe-core}")" \
        npx vitest run --config vitest.corpus.config.ts) || status=1
fi
exit $status

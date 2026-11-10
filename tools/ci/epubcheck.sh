#!/usr/bin/env bash
# Feature 012 (D4, FR-081, SC-001, SC-022): every EPUB the editor writes must pass EPUBCheck, the
# W3C's conformance checker for EPUB publications, with no fatal error, no error and no warning.
#
# EPUBCheck is a test tool and never shipped. The pinned release and its SHA-256 are the digest
# GitHub publishes for the asset (https://github.com/w3c/epubcheck/releases/tag/v5.4.0,
# published 2026-09-15). It needs a Java runtime (11 or newer; CI uses Temurin 21).
#
# Usage: tools/ci/epubcheck.sh --fetch            download and verify the pinned release only
#        tools/ci/epubcheck.sh <file.epub> [...]  check each file; exit 1 when any reports a
#                                                 FATAL, ERROR or WARNING message
# The download is kept in ${MFBE_EPUBCHECK_CACHE:-~/.cache/mfbe-epubcheck}, outside the repository.
set -euo pipefail

version="5.4.0"
sha256="33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c"
url="https://github.com/w3c/epubcheck/releases/download/v${version}/epubcheck-${version}.zip"
cache="${MFBE_EPUBCHECK_CACHE:-${HOME}/.cache/mfbe-epubcheck}"
zip="${cache}/epubcheck-${version}.zip"
jar="${cache}/epubcheck-${version}/epubcheck.jar"

fetch() {
  mkdir -p "$cache"
  if [ ! -f "$zip" ]; then
    curl -sSfL --retry 3 -o "${zip}.part" "$url"
    mv "${zip}.part" "$zip"
  fi
  if ! echo "${sha256}  ${zip}" | sha256sum -c --status; then
    echo "epubcheck: ${zip} does not match the pinned SHA-256; removed" >&2
    rm -f "$zip"
    exit 1
  fi
  if [ ! -f "$jar" ]; then
    (cd "$cache" && unzip -q -o "$zip")
  fi
}

fetch
[ "${1:-}" = "--fetch" ] && exit 0
if [ "$#" -eq 0 ]; then
  echo "usage: tools/ci/epubcheck.sh --fetch | <file.epub> [...]" >&2
  exit 2
fi

status=0
report="$(mktemp)"
trap 'rm -f "$report"' EXIT
for epub in "$@"; do
  # EPUBCheck exits non-zero on errors but not on warnings, so the JSON report is read instead.
  java -jar "$jar" --json "$report" "$epub" >/dev/null 2>&1 || true
  if ! python3 - "$report" "$epub" <<'PY'
import json, sys
path, epub = sys.argv[1], sys.argv[2]
try:
    messages = json.load(open(path, encoding="utf-8")).get("messages", [])
except (OSError, ValueError) as error:
    print(f"epubcheck: {epub}: no report ({error})")
    sys.exit(1)
bad = [m for m in messages if m.get("severity") in ("FATAL", "ERROR", "WARNING")]
for m in bad:
    where = ", ".join(f"{l.get('path')}:{l.get('line')}" for l in m.get("locations", [])[:3])
    print(f"epubcheck: {epub}: {m.get('severity')} {m.get('ID')} {m.get('message')} [{where}]")
if not bad:
    print(f"epubcheck: {epub}: OK")
sys.exit(1 if bad else 0)
PY
  then
    status=1
  fi
done
exit "$status"

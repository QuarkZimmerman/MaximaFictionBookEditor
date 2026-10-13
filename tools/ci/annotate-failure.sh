#!/usr/bin/env bash
# Prints the tail of a step log as one GitHub Actions error annotation so a failure's cause is
# visible in the public job summary (job logs need admin rights, annotations do not).
# Usage: tools/ci/annotate-failure.sh <logfile> [title]
set -uo pipefail
log="${1:-}"
title="${2:-step failed}"
if [[ -z "$log" || ! -f "$log" ]]; then
  echo "::error title=${title}::no log captured"
  exit 0
fi
# Keep the most informative part: lines mentioning errors first, then the raw tail.
{
  grep -iE -A6 "FAILED:|^\s*[0-9]+/[0-9]+ Test.*\*\*\*" "$log" | tail -n 60
  echo "----- errors -----"
  grep -iE "error|fatal|failed|exception|not found|denied" "$log" | grep -v "Test #" | tail -n 20
  echo "----- tail -----"
  tail -n 30 "$log"
} | cut -c1-400 | head -c 3800 | python3 -c '
import sys
text = sys.stdin.read().replace("%", "%25").replace("\r", "").replace("\n", "%0A")
sys.stdout.write(text)
' > "$log.annotation"
printf '::error title=%s::%s\n' "$title" "$(cat "$log.annotation")"

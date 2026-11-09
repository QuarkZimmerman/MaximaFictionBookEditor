#!/usr/bin/env bash
# Feature 011 (D48, FR-087, SC-020): the warnings recorded at release 0.0.8 must not come back.
#
# Fails when a build log holds MSVC's C4611 (setjmp next to C++ objects with destructors) or GCC's
# -Wmissing-field-initializers. Node's deprecation warnings are not made fatal job-wide: a
# job-level NODE_OPTIONS=--throw-deprecation also reached third-party actions (actions/setup-node
# itself loads the deprecated punycode module) and stopped every job before it ran.
#
# Usage: tools/ci/warning-scan.sh <log> [<log> ...]
set -euo pipefail

status=0
for log in "$@"; do
  [ -f "$log" ] || continue
  for pattern in 'C4611' 'Wmissing-field-initializers' 'DeprecationWarning'; do
    if grep -q -- "$pattern" "$log"; then
      echo "warning-scan: ${log}: $(grep -c -- "$pattern" "$log") line(s) with ${pattern}:" >&2
      grep -- "$pattern" "$log" | head -10 >&2
      status=1
    fi
  done
done
[ "$status" -eq 0 ] && echo "warning-scan: OK - none of the recorded warnings in $# log(s)"
exit "$status"

#!/usr/bin/env bash
# Feature 015 (FR-001, FR-006): the user's genre file, script and template are in effect in the
# macOS application - in the per-user data folder and in the portable user folder next to a copy of
# mfbe.app. Starts the bundle's executable with DevTools, runs tools/user-folders-check.mjs and ends
# the editor's processes.
#
#   tools/ci/macos-user-folders-smoke.sh <path to mfbe.app>
set -euo pipefail
app=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
fixtures="$root/tests/fixtures/user-folders"
port=9336

seed() {
  mkdir -p "$1/genres" "$1/scripts"
  cp "$fixtures/my.genres.tsv" "$fixtures/genres.txt" "$1/genres/"
  cp -R "$fixtures/my-test-script" "$1/scripts/"
  cp "$fixtures/blank.fb2" "$1/"
}

run_check() {
  local bundle=$1
  "$bundle/Contents/MacOS/mfbe" --remote-debugging-port="$port" >/dev/null 2>&1 &
  local pid=$!
  local shown=""
  for _ in $(seq 1 120); do
    if curl -s "http://127.0.0.1:$port/json/list" | grep -q ' - Maxima Fiction Book Editor'; then
      shown=1
      break
    fi
    sleep 1
  done
  local status=0
  if [[ -z "$shown" ]]; then
    echo "macos-user-folders-smoke: the editor interface did not appear in $bundle" >&2
    status=1
  else
    node "$root/tools/user-folders-check.mjs" "$port" || status=1
  fi
  kill "$pid" 2>/dev/null || true
  pkill -f "$bundle/Contents/" 2>/dev/null || true
  sleep 2
  return "$status"
}

# 1. The per-user data folder of the installed application.
seed "$HOME/Library/Application Support/Maxima Fiction Book Editor"
run_check "$app"
rm -rf "$HOME/Library/Application Support/Maxima Fiction Book Editor/genres" \
  "$HOME/Library/Application Support/Maxima Fiction Book Editor/scripts" \
  "$HOME/Library/Application Support/Maxima Fiction Book Editor/blank.fb2"

# 2. A portable copy: a user folder next to a copy of the bundle.
portable="${RUNNER_TEMP:-/tmp}/mfbe-portable-user-folders"
rm -rf "$portable"
mkdir -p "$portable/user"
cp -R "$app" "$portable/"
seed "$portable/user"
run_check "$portable/$(basename "$app")"
echo "macos-user-folders-smoke: the user's genre file, script and template are in effect: OK"

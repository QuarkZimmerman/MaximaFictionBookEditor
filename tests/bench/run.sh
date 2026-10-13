#!/usr/bin/env bash
# Performance budgets (T150, SC-002, Constitution IV) - wrapper around bench.mjs.
#
#   tests/bench/run.sh [--skip-150] [--json] [--core PATH] [--ui-dist DIR] [--work-dir DIR]
#
# Needs: node >= 24 with ui/node_modules installed (Playwright + Chromium), python3, a built
# mfbe-core (MFBE_CORE_BIN, --core, or build/linux-core-{release,debug}/bin/mfbe-core) and the
# built UI bundle (ui/dist). Generated books live in the work directory (default build/bench,
# git-ignored), results in tests/bench/results/ (git-ignored). Exit code 1 = a budget was
# exceeded, 2 = the benchmark could not run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "bench: node is required" >&2
    exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "bench: python3 is required (book generator)" >&2
    exit 2
fi
if [ ! -d "$REPO/ui/node_modules/@playwright/test" ]; then
    echo "bench: run 'npm ci' in ui/ first (Playwright is a devDependency)" >&2
    exit 2
fi
if [ ! -f "${MFBE_UI_DIST:-$REPO/ui/dist}/index.html" ]; then
    echo "bench: UI bundle not found; run 'npm run build' in ui/ (or set MFBE_UI_DIST)" >&2
    exit 2
fi

exec node "$HERE/bench.mjs" "$@"

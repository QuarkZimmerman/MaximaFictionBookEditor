#!/usr/bin/env bash
# Runs the script equivalence suite (tests/scripts/run-all.mjs) from any working directory.
#
#   MFBE_CORE_BIN=build/linux-core-release/bin/mfbe-core MFBE_UI_DIST=ui/dist tests/scripts/run-all.sh
#   tests/scripts/run-all.sh --group 17 --verbose
#
# Needs the built UI bundle (cd ui && npm run build), the core binary (MFBE_CORE_BIN or the
# default build/linux-core-debug/bin/mfbe-core) and Playwright's Chromium (cd ui && npm ci &&
# npx playwright install chromium). Every option is passed on to run-all.mjs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here/../.."
# Feature 007: bundled packages and groups without Ukrainian names and descriptions are reported,
# not failed, until the recheck of its US4 has given every one of them (T089 removes the flag).
exec node tests/scripts/run-all.mjs --allow-missing-uk "$@"

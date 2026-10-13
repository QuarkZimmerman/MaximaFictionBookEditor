#!/usr/bin/env bash
# Format C++ (clang-format) and UI (prettier + eslint --fix) sources.
# Usage: tools/format.sh [--check]
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

cxx_files=$(git ls-files 'core/**/*.cpp' 'core/**/*.hpp' 'core/**/*.h' 'app/**/*.cpp' 'app/**/*.h' 'app/**/*.mm' 2>/dev/null || true)
if command -v clang-format >/dev/null 2>&1 && [[ -n "$cxx_files" ]]; then
  if [[ $CHECK -eq 1 ]]; then
    echo "$cxx_files" | xargs clang-format --dry-run --Werror
  else
    echo "$cxx_files" | xargs clang-format -i
  fi
else
  echo "clang-format not found or no C++ files; skipping C++ formatting" >&2
fi

if [[ -f ui/package.json && -d ui/node_modules ]]; then
  if [[ $CHECK -eq 1 ]]; then
    (cd ui && npm run --silent format:check && npm run --silent lint)
  else
    (cd ui && npm run --silent format && npx eslint . --fix)
  fi
fi

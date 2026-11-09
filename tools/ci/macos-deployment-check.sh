#!/usr/bin/env bash
# Feature 011 (D47, FR-086, SC-019): every macOS binary must run on macOS 13.0.
#
# Fails when the build log holds a linker warning that an object or library was built for a newer
# macOS version than the one being linked, or when a Mach-O file under the given folders requires a
# macOS newer than 13.0 (its LC_BUILD_VERSION minos, or the older LC_VERSION_MIN_MACOSX). Prebuilt
# files that ask for less (CEF's framework targets 12.0) pass: they run on 13.0.
#
# Usage: tools/ci/macos-deployment-check.sh <build-log> [<folder> ...]
set -euo pipefail
# An unexpected failure names its line instead of ending the step without a word.
trap 'echo "macos-deployment-check: failed at line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

expected="${MFBE_MACOS_MIN:-13.0}"
log="${1:?usage: macos-deployment-check.sh <build-log> [<folder> ...]}"
shift
status=0
pattern='built for newer (macOS|OSX) version'

if grep -Eq "$pattern" "$log"; then
  count=$(grep -Ec "$pattern" "$log")
  echo "macos-deployment-check: ${count} linker warning(s) about objects built for a newer macOS:" >&2
  grep -E "$pattern" "$log" | head -20 >&2
  status=1
fi

newer_than_expected() {
  # True when $1 is a newer version than $expected.
  [ "$1" != "$expected" ] && [ "$(printf '%s\n%s\n' "$expected" "$1" | sort -V | tail -n 1)" = "$1" ]
}

# Xcode's otool wrapper splits a file name at a parenthesis (CEF's helpers are named
# "mfbe Helper (GPU)" and the like), so otool reads each file through a link with a plain name.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
checked=0
for root in "$@"; do
  while IFS= read -r -d '' file; do
    # Not `file | grep -q`: under pipefail grep's early exit can fail the pipeline and skip the file.
    [[ "$(file -b "$file")" == *Mach-O* ]] || continue
    checked=$((checked + 1))
    case "$file" in
      /*) target="$file" ;;
      *) target="$PWD/$file" ;;
    esac
    ln -sf "$target" "$work/macho"
    if ! commands=$(otool -l "$work/macho" 2>&1); then
      echo "macos-deployment-check: otool cannot read ${file}: ${commands%%$'\n'*}" >&2
      status=1
      continue
    fi
    versions=$(printf '%s\n' "$commands" |
      awk '/LC_BUILD_VERSION/ {b=1} b && /minos/ {print $2; b=0}
           /LC_VERSION_MIN_MACOSX/ {v=1} v && /version/ {print $2; v=0}' | sort -u)
    for version in $versions; do
      if newer_than_expected "$version"; then
        echo "macos-deployment-check: ${file} requires macOS ${version} (the editor targets ${expected})" >&2
        status=1
      fi
    done
  done < <(find "$root" -type f -print0)
done

if [ "$status" -eq 0 ]; then
  echo "macos-deployment-check: OK - no newer-macOS warning; ${checked} Mach-O file(s) run on macOS ${expected}"
fi
exit "$status"

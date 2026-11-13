#!/usr/bin/env bash
# Unmounts the disk image a macOS package smoke mounted (CI and Release workflows). For a moment
# after the smoke ran the editor from it, a process may still hold the volume ("Resource busy",
# as on the x86_64 leg of v0.0.11-rc.1): the detach is retried, then forced as the last resort -
# the volume is a read-only copy of the package, nothing on it can be lost.
# Usage: tools/ci/detach-dmg.sh <mount point>
set -u
mount_point="$1"
for attempt in 1 2 3 4 5; do
  if hdiutil detach "$mount_point"; then
    exit 0
  fi
  echo "detach-dmg: $mount_point is busy (attempt $attempt of 5), retrying in 3 s" >&2
  sleep 3
done
hdiutil detach -force "$mount_point"

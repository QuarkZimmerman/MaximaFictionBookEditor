#!/usr/bin/env bash
# Feature 015 (FR-001, FR-006): the user's genre file, script and template are in effect in the
# editor installed from the rpm. A Fedora container installs the package with its dependencies,
# Xvfb, a window manager, xdotool and Node, then runs the shell smoke's user-folder mode against
# the installed program; the repository is mounted read-only, the smoke works in a copy of it
# without the build tree, the node modules and the git data.
#
#   tools/ci/rpm-user-folders-smoke.sh <path to the .rpm>
set -euo pipefail
rpm_file=$(realpath "$1")
root=$(cd "$(dirname "$0")/../.." && pwd)
docker run --rm --shm-size=1g \
  -v "$root:/repo:ro" -v "$rpm_file:/tmp/mfbe.rpm:ro" \
  fedora:42 bash -euo pipefail -c '
    dnf install -y -q /tmp/mfbe.rpm xorg-x11-server-Xvfb xdotool openbox xprop ImageMagick curl python3 \
      nodejs npm findutils procps-ng tar >/dev/null
    mkdir -p /work
    tar -C /repo --exclude=./build --exclude=./ui/node_modules --exclude=./.git -cf - . | tar -C /work -xf -
    cd /work/ui && npm ci --ignore-scripts --no-audit --no-fund >/dev/null
    # The editor, as Chromium, does not run as root: a user of its own runs the smoke.
    useradd -m smoke
    chown -R smoke /work
    su smoke -c "cd /work && MFBE_APP_BIN=/usr/bin/mfbe MFBE_SMOKE_REAL_UI=1 MFBE_SMOKE_USER_FOLDERS=1 \
      MFBE_SMOKE_SCREENSHOT=build/shell-smoke-rpm-user.png tools/shell-smoke.sh"
  '

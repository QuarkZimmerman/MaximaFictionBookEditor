#!/usr/bin/env bash
# Feature 015 (FR-001, FR-006): the user's genre file, script and template are in effect in the
# editor installed from the rpm. A Fedora container installs the package with its dependencies,
# Xvfb, a window manager, xdotool, binutils and Node, then runs the shell smoke's user-folder mode
# against the installed program; the repository is mounted read-only, the smoke works in a copy of
# it without the build tree and the git data.
#
#   tools/ci/rpm-user-folders-smoke.sh <path to the .rpm>
set -euo pipefail
rpm_file=$(realpath "$1")
root=$(cd "$(dirname "$0")/../.." && pwd)
# Docker's default seccomp profile refuses the user namespaces of Chromium's sandbox; this throwaway
# test container lifts it, so the editor runs with its sandbox as on a desktop.
docker run --rm --shm-size=1g --security-opt seccomp=unconfined \
  -v "$root:/repo:ro" -v "$rpm_file:/tmp/mfbe.rpm:ro" \
  fedora:42 bash -euo pipefail -c '
    dnf install -y -q /tmp/mfbe.rpm xorg-x11-server-Xvfb xdotool openbox xprop ImageMagick curl python3 \
      nodejs binutils findutils procps-ng tar >/dev/null
    mkdir -p /work
    # The node modules of the runner come along (the check needs only the DevTools client of
    # Playwright), so nothing is installed with the older Node of the container.
    tar -C /repo --exclude=./build --exclude=./.git -cf - . | tar -C /work -xf -
    # The editor, as Chromium, does not run as root: a user of its own runs the smoke.
    useradd -m smoke
    chown -R smoke /work
    su smoke -c "cd /work && MFBE_APP_BIN=/usr/bin/mfbe MFBE_SMOKE_REAL_UI=1 MFBE_SMOKE_USER_FOLDERS=1 \
      MFBE_SMOKE_SCREENSHOT=build/shell-smoke-rpm-user.png tools/shell-smoke.sh"
  '

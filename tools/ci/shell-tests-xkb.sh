#!/usr/bin/env bash
# Runs a command - the shell unit tests, `ctest -L shell` - on a virtual X display that has two
# keyboard layout groups (feature 004 US11, FR-093; research R4.4): Xvfb is started with
# `-noreset`, so the keymap `setxkbmap -layout us,ru` installs survives the exit of the setxkbmap
# client (with the default reset the server reverts to one group as soon as its last client
# disconnects); the group names are exported as MFBE_TEST_XKB_GROUPS ("English (US);Russian",
# xkeyboard-config's names) for tests/shell/test_keyboard_layout.cpp, which lists the groups,
# locks the second one and the first again; the command then runs on that display. The script
# never touches a real session: it always starts a display of its own (the CI app job's Linux
# "Shell unit tests" step; locally the same command works on a headless host).
#
# Usage: tools/ci/shell-tests-xkb.sh ctest --preset linux-app-release -L shell --output-on-failure
set -euo pipefail

if [[ "${MFBE_XKB_WRAPPED:-}" != "1" ]]; then
  for tool in xvfb-run setxkbmap; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "shell-tests-xkb: $tool is not installed (xvfb and x11-xkb-utils are needed)" >&2
      exit 2
    fi
  done
  MFBE_XKB_WRAPPED=1 exec xvfb-run -a -s "-noreset -screen 0 1280x800x24" "$0" "$@"
fi

# Inside the virtual display: two groups, Alt+Shift as the switch the session would offer.
setxkbmap -layout us,ru -option grp:alt_shift_toggle
echo "shell-tests-xkb: display $DISPLAY, layouts $(setxkbmap -query | awk '/^layout:/ {print $2}')"
export MFBE_TEST_XKB_GROUPS="English (US);Russian"
exec "$@"

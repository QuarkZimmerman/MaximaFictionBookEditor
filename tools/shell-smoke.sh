#!/usr/bin/env bash
# CEF shell smoke test under Xvfb + CDP (T035). Builds nothing.
#
# Starts the shell under a virtual X display with --remote-debugging-port, waits for the CDP
# endpoint (/json/version), then runs tools/shell-smoke.mjs (Playwright connectOverCDP) which
# asserts the page title and a visible selector and saves a screenshot.
#
# Every run also makes GTK decode a PNG inside the shell (a user stylesheet with a PNG
# background, as many desktop themes have) and checks that the shell exports no symbols of its
# statically linked libraries.
#
# Usage: tools/shell-smoke.sh
# Environment:
#   MFBE_APP_BIN                shell executable   (default build/linux-app-debug/bin/mfbe)
#   MFBE_SMOKE_URL              URL to load; default: a tiny local page (<title>mfbe-smoke</title>,
#                               <div id="menubar">) served by `python3 -m http.server`.
#                               Set it to a running core (http://127.0.0.1:<port>/?token=...) with
#                               MFBE_SMOKE_EXPECT_TITLE / MFBE_SMOKE_EXPECT_SELECTOR
#                               ('[data-testid="menu-file"]') to smoke the real UI.
#   MFBE_SMOKE_EXPECT_TITLE     expected document title (default mfbe-smoke)
#   MFBE_SMOKE_EXPECT_SELECTOR  selector that must be visible (default #menubar)
#   MFBE_SMOKE_SCREENSHOT       screenshot path (default build/shell-smoke.png)
#   MFBE_SMOKE_CDP_PORT         fixed CDP port (default: a free port)
#   MFBE_SMOKE_TIMEOUT_S        seconds to wait for /json/version (default 60)
#   MFBE_SMOKE_KEEP_LOGS        1 = print the shell's stderr log at the end even on success
#   MFBE_SMOKE_MESSAGEBOX       1 = also exercise the native message box (dev/test builds with
#                               MFBE_TEST_HOOKS: the shell shows one via MFBE_SHELL_SELFTEST,
#                               the script clicks OK over CDP and checks the shell's answer)
#   MFBE_SMOKE_OPEN_FILE        document passed as FILE argument (real UI only, T137): the window
#                               title must start with its name and the Body must show text
#                               (MFBE_SMOKE_EXPECT_TEXT = text that must appear)
#   MFBE_SMOKE_ABOUT            1 = open Help > About and check [data-testid="dialog-about"]
#                               (skipped with a note when the UI has no About dialog yet): it
#                               must show the version label and the build id of the shell's
#                               own `--version` (feature 006, FR-055), read from its first line
#                               "Maxima Fiction Book Editor <label> (build <build id>, <date>)" -
#                               an AppImage runs with APPIMAGE_EXTRACT_AND_RUN=1 for it
#   MFBE_SMOKE_EXPECT_VERSION   the version label About must show (with MFBE_SMOKE_ABOUT=1;
#                               default: from `"$MFBE_APP_BIN" --version`), e.g. 0.0.6-rc
#   MFBE_SMOKE_EXPECT_BUILD     the build id About must show (with MFBE_SMOKE_ABOUT=1; default:
#                               from `"$MFBE_APP_BIN" --version`), e.g. 0.0.6-rc+1a2b3c4d5e
#   MFBE_SMOKE_CLIPBOARD        1 = clipboard image check (dev/test builds, Linux): a small GTK
#                               program (python3-gi) puts a PNG on the X clipboard of the virtual
#                               display, the shell reads it through the core's clipboard provider
#                               (MFBE_SHELL_SELFTEST=clipboard) and prints
#                               "selftest: clipboard <bytes> image/png"; exclusive with
#                               MFBE_SMOKE_MESSAGEBOX
#   MFBE_SMOKE_OPENFILE         1 = file dialog check (dev/test builds, Linux; feature 002): the
#                               shell shows the Open dialog through GTK 3
#                               (MFBE_SHELL_SELFTEST=openfile), prints the file types and the
#                               active type GTK received and cancels the dialog from code after
#                               2 s; the script checks the editor's Open types, "FictionBook
#                               files (*.fb2)" active and the dialog on the screen. Exclusive
#                               with MFBE_SMOKE_MESSAGEBOX and MFBE_SMOKE_CLIPBOARD
#   MFBE_SMOKE_PORTABLE         1 = portable copy (real UI only, feature 002): a `user` folder
#                               created next to the shell (and removed afterwards) must receive
#                               the browser profile (cef/) and the logs (logs/), and no per-user
#                               folder of the editor may appear in the isolated HOME
#   (real UI, always)           View > Status Bar hides the status bar and the run's settings.json
#                               (per-user folder or the portable `user` folder) records it within
#                               10 s - also when the core reports the settings right after the
#                               click (settings.changed after another settings.set, as the
#                               start-up version check's record) - then shown and recorded again:
#                               the step of tools/ci/windows-russian-journey.ps1 on this host
#   MFBE_SMOKE_NO_SANDBOX       1 = pass --no-sandbox explicitly. By default the shell decides
#                               itself (T140, app/src/sandbox_check.cpp): the sandbox stays on
#                               when unprivileged user namespaces or the SUID chrome-sandbox
#                               work and is switched off with a logged warning otherwise
#                               (containers, root); the decision line is echoed at the end.
#   MFBE_SMOKE_RESTART          1 = the editor's restart of itself (feature 003 US3, SC-005; real
#                               UI with MFBE_SMOKE_OPEN_FILE): the language is switched in
#                               Settings and Yes answered in the restart prompt; the old process
#                               must exit, a new `mfbe` process must come up on the same CDP port
#                               within 15 s with the book open, the interface in the chosen
#                               language and the window where it was (+-2 px); the run is made
#                               twice - with a normal window (--window-geometry 40,30,1000,650)
#                               and with a maximised one (..., max), which must come back
#                               maximised (MFBE_SMOKE_RESTART_VARIANTS=normal|max picks one). A
#                               window manager (openbox, when installed) runs on the display so
#                               maximising is real; the display outlives the first process; the
#                               shell's "shelltest: argv" log lines tell what each instance was
#                               started with (Chromium rewrites /proc/<pid>/cmdline).
#   MFBE_SMOKE_RESTART_FAIL     1 = the failure path of the restart (with MFBE_SMOKE_RESTART=1):
#                               MFBE_RELAUNCH_PROGRAM=/nonexistent/mfbe (honoured by test-hook
#                               builds only) makes the spawn fail; the page must report it
#                               (msg.restartFailed) and the old process must stay alive.
#   MFBE_SMOKE_CLOSE            1 = the window's close button (feature 003 FR-017; real UI with
#                               MFBE_SMOKE_OPEN_FILE; needs openbox and xdotool): the document
#                               is modified, then the window manager is asked to close the
#                               window (Alt+F4 under openbox sends WM_DELETE_WINDOW, as the
#                               title-bar X does) - the "Save changes?" prompt must appear and
#                               the editor stay; Cancel keeps it open and modified; a second
#                               close request asks again at once; No ends the process.
#   MFBE_SMOKE_SAVE_AS          1 = the native GTK Save dialog with a proposed and a typed
#                               Cyrillic name (feature 004 US6, FR-050/FR-051; real UI; needs
#                               openbox and xdotool): the pre-seeded settings remember a
#                               Cyrillic folder as the one last used by the file dialogs
#                               (session.lastFileDialogFolder); File > New, the author
#                               "Толстой Лев Николаевич" and the title "Война и мир" typed into
#                               the Description view, Save As - the GTK dialog opens with
#                               "Толстой Лев - Война и мир.fb2" proposed, Return (xdotool)
#                               accepts it and the file must exist under exactly that name in
#                               the remembered folder; a second Save As with Ctrl+A, "Новая
#                               книга.fb2" typed with xdotool and Return must write that file
#   (every run)                 The browser engine's own spell checking is off (feature 004 US9,
#                               FR-081): the shell sets browser.enable_spellchecking=false at
#                               every start and a test-hook build prints "shelltest: spellcheck
#                               engine=off" ("engine=error <text>" when the preference was
#                               refused). An "engine=error" line fails the run whatever the
#                               build; a test-hook shell (it prints "shelltest: argv" at start)
#                               must have printed "engine=off"; a shell without test hooks (the
#                               release presets, the AppImage) prints no shelltest line, which
#                               is reported - the page attributes are the e2e journey's check.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

MFBE_APP_BIN="${MFBE_APP_BIN:-$ROOT/build/linux-app-debug/bin/mfbe}"
TIMEOUT_S="${MFBE_SMOKE_TIMEOUT_S:-60}"

if [[ ! -x "$MFBE_APP_BIN" ]]; then
  echo "shell-smoke: $MFBE_APP_BIN is not an executable (build a linux-app-* preset or set MFBE_APP_BIN)" >&2
  exit 1
fi
for tool in xvfb-run node python3 curl setsid nm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "shell-smoke: required tool '$tool' not found" >&2
    exit 1
  fi
done
if [[ ! -d "$ROOT/ui/node_modules/playwright" && ! -d "$ROOT/ui/node_modules/@playwright/test" ]]; then
  echo "shell-smoke: playwright is not installed in ui/node_modules (run: cd ui && npm ci)" >&2
  exit 1
fi

# The shell exports nothing but C++ runtime symbols: an exported symbol of a statically linked
# library (libpng, zlib, ...) replaces the system copy for every library in the process.
if [[ "$MFBE_APP_BIN" != *.AppImage ]]; then
  LEAKED=$(nm -D --defined-only "$MFBE_APP_BIN" | awk '{print $3}' |
    grep -vE '^(_ZN?K?St|_IO_stdin_used$|__bss_start$|_edata$|_end$)' || true)
  if [[ -n "$LEAKED" ]]; then
    echo "shell-smoke: $MFBE_APP_BIN exports symbols of its statically linked libraries:" >&2
    head -n 20 <<<"$LEAKED" >&2
    exit 1
  fi
fi

# Help > About must show the shell's own version label and build id (feature 006, FR-055),
# unless given: the first line of `--version` reads
# "Maxima Fiction Book Editor <label> (build <build id>, <date>)".
if [[ "${MFBE_SMOKE_ABOUT:-0}" == "1" ]] &&
   [[ -z "${MFBE_SMOKE_EXPECT_VERSION:-}" || -z "${MFBE_SMOKE_EXPECT_BUILD:-}" ]]; then
  if [[ "$MFBE_APP_BIN" == *.AppImage ]]; then
    VERSION_OUTPUT=$(APPIMAGE_EXTRACT_AND_RUN=1 "$MFBE_APP_BIN" --version)
  else
    VERSION_OUTPUT=$("$MFBE_APP_BIN" --version)
  fi
  VERSION_LINE=${VERSION_OUTPUT%%$'\n'*}
  VERSION_RE='^.+ ([^ ]+) \(build ([^ ,]+), [^)]*\)$'
  if [[ ! "$VERSION_LINE" =~ $VERSION_RE ]]; then
    echo "shell-smoke: no version label in the first line of '$MFBE_APP_BIN --version': $VERSION_LINE" >&2
    exit 1
  fi
  : "${MFBE_SMOKE_EXPECT_VERSION:=${BASH_REMATCH[1]}}"
  : "${MFBE_SMOKE_EXPECT_BUILD:=${BASH_REMATCH[2]}}"
  export MFBE_SMOKE_EXPECT_VERSION MFBE_SMOKE_EXPECT_BUILD
  echo "shell-smoke: About must show the version $MFBE_SMOKE_EXPECT_VERSION and the build $MFBE_SMOKE_EXPECT_BUILD"
fi

TMP=$(mktemp -d -t mfbe-smoke.XXXXXX)
HTTP_PID=""
APP_PID=""
CDP_PORT=""
PORTABLE_DIR=""
# Ends the shell started by start_shell (and, in the restart scenario, the instance it started,
# which runs in a session of its own and is found by its debugging port). Best effort: the
# restart scenario calls it between its variants under `set -e`, and a group that TERM already
# emptied makes the KILL fail with "No such process" - that is success, not an error.
stop_shell() {
  if [[ -n "$APP_PID" ]]; then
    # xvfb-run was started in its own session: terminate the whole group (Xvfb + shell +
    # Chromium sub-processes).
    kill -TERM -- "-$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
  if [[ -n "$CDP_PORT" ]]; then
    pkill -TERM -f -- "mfbe.*--remote-debugging-port=$CDP_PORT" 2>/dev/null || true
    sleep 0.5
    pkill -KILL -f -- "mfbe.*--remote-debugging-port=$CDP_PORT" 2>/dev/null || true
  fi
}
cleanup() {
  local status=$?
  set +e
  stop_shell
  if [[ -n "$HTTP_PID" ]]; then
    kill "$HTTP_PID" 2>/dev/null
  fi
  if [[ -n "$PORTABLE_DIR" ]]; then
    rm -rf "$PORTABLE_DIR"
  fi
  if [[ $status -ne 0 || "${MFBE_SMOKE_KEEP_LOGS:-0}" == "1" ]]; then
    if [[ -s "$TMP/mfbe.log" ]]; then
      echo "----- mfbe log ($TMP/mfbe.log) -----"
      tail -n 60 "$TMP/mfbe.log"
      echo "----- end of mfbe log -----"
    fi
  fi
  rm -rf "$TMP"
  exit $status
}
trap cleanup EXIT INT TERM

pick_free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

# --- smoke page -------------------------------------------------------------------------------
# MFBE_SMOKE_REAL_UI=1: no --url; the shell starts its in-process core and serves the real UI
# (the mode CI uses once ui/dist exists). Otherwise a tiny stub page is served.
URL_ARGS=()
if [[ "${MFBE_SMOKE_REAL_UI:-0}" == "1" ]]; then
  : "${MFBE_SMOKE_EXPECT_TITLE:=Maxima Fiction Book Editor}"
  : "${MFBE_SMOKE_EXPECT_SELECTOR:=[data-testid="menu-file"]}"
  MFBE_SMOKE_URL="(in-process core)"
elif [[ -z "${MFBE_SMOKE_URL:-}" ]]; then
  PAGE_PORT=$(pick_free_port)
  mkdir -p "$TMP/www"
  cat >"$TMP/www/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>mfbe-smoke</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; background: #f3f3f3; color: #1e1e1e; }
  #menubar { display: flex; gap: 18px; padding: 6px 12px; background: #e9e9e9; border-bottom: 1px solid #c8c8c8; }
  #menubar span { padding: 2px 4px; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
</style>
</head>
<body>
<div id="menubar" data-testid="menubar">
  <span data-testid="menu-file">File</span><span>Edit</span><span>View</span><span>Add</span>
  <span>Style</span><span>Tools</span><span>Scripts</span><span>Help</span>
</div>
<main>
  <h1>Maxima Fiction Book Editor - shell smoke page</h1>
  <p id="status">Rendered inside the CEF shell. Проверка отрисовки кириллицы.</p>
</main>
</body>
</html>
HTML
  python3 -m http.server --bind 127.0.0.1 "$PAGE_PORT" --directory "$TMP/www" >"$TMP/http.log" 2>&1 &
  HTTP_PID=$!
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:$PAGE_PORT/" >/dev/null 2>&1 && break
    sleep 0.2
  done
  MFBE_SMOKE_URL="http://127.0.0.1:$PAGE_PORT/"
  : "${MFBE_SMOKE_EXPECT_TITLE:=mfbe-smoke}"
  : "${MFBE_SMOKE_EXPECT_SELECTOR:=#menubar}"
fi
if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" ]]; then
  URL_ARGS=(--url "$MFBE_SMOKE_URL")
fi
export MFBE_SMOKE_EXPECT_TITLE MFBE_SMOKE_EXPECT_SELECTOR
export MFBE_SMOKE_SCREENSHOT="${MFBE_SMOKE_SCREENSHOT:-$ROOT/build/shell-smoke.png}"

# --- shell under Xvfb -------------------------------------------------------------------------
SANDBOX_ARGS=()
if [[ "${MFBE_SMOKE_NO_SANDBOX:-0}" == "1" ]]; then
  SANDBOX_ARGS=(--no-sandbox)
fi
FILE_ARGS=()
if [[ -n "${MFBE_SMOKE_OPEN_FILE:-}" ]]; then
  if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" ]]; then
    echo "shell-smoke: MFBE_SMOKE_OPEN_FILE needs MFBE_SMOKE_REAL_UI=1" >&2
    exit 1
  fi
  if [[ ! -f "$MFBE_SMOKE_OPEN_FILE" ]]; then
    echo "shell-smoke: MFBE_SMOKE_OPEN_FILE '$MFBE_SMOKE_OPEN_FILE' does not exist" >&2
    exit 1
  fi
  MFBE_SMOKE_OPEN_FILE="$(cd "$(dirname "$MFBE_SMOKE_OPEN_FILE")" && pwd)/$(basename "$MFBE_SMOKE_OPEN_FILE")"
  FILE_ARGS=("$MFBE_SMOKE_OPEN_FILE")
  export MFBE_SMOKE_OPEN_FILE
fi
if [[ "${MFBE_SMOKE_PORTABLE:-0}" == "1" ]]; then
  if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" || "$MFBE_APP_BIN" == *.AppImage ]]; then
    echo "shell-smoke: MFBE_SMOKE_PORTABLE needs MFBE_SMOKE_REAL_UI=1 and an unpacked shell" >&2
    exit 1
  fi
  if [[ -e "$(dirname "$MFBE_APP_BIN")/user" ]]; then
    echo "shell-smoke: $(dirname "$MFBE_APP_BIN")/user exists already" >&2
    exit 1
  fi
  PORTABLE_DIR="$(dirname "$MFBE_APP_BIN")/user"
  mkdir "$PORTABLE_DIR"
  # Offline like the per-user scenarios: no start-up version check (feature 003).
  printf '{ "schemaVersion": 1, "other": { "versionCheck": "never" } }\n' \
    >"$PORTABLE_DIR/settings.json"
fi
SELFTEST=""
if [[ "${MFBE_SMOKE_MESSAGEBOX:-0}" == "1" ]]; then
  SELFTEST="messagebox"
fi
if [[ "${MFBE_SMOKE_OPENFILE:-0}" == "1" ]]; then
  if [[ -n "$SELFTEST" || "${MFBE_SMOKE_CLIPBOARD:-0}" == "1" ]]; then
    echo "shell-smoke: MFBE_SMOKE_OPENFILE is exclusive with MFBE_SMOKE_MESSAGEBOX and MFBE_SMOKE_CLIPBOARD" >&2
    exit 1
  fi
  SELFTEST="openfile"
fi
RESTART="${MFBE_SMOKE_RESTART:-0}"
RESTART_FAIL="${MFBE_SMOKE_RESTART_FAIL:-0}"
if [[ "$RESTART" == "1" ]]; then
  if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" || -z "${MFBE_SMOKE_OPEN_FILE:-}" ]]; then
    echo "shell-smoke: MFBE_SMOKE_RESTART needs MFBE_SMOKE_REAL_UI=1 and MFBE_SMOKE_OPEN_FILE" >&2
    exit 1
  fi
  if [[ -n "$SELFTEST" || "${MFBE_SMOKE_CLIPBOARD:-0}" == "1" ]]; then
    echo "shell-smoke: MFBE_SMOKE_RESTART is exclusive with the self-test scenarios" >&2
    exit 1
  fi
  for tool in pgrep pkill; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "shell-smoke: required tool '$tool' not found" >&2
      exit 1
    fi
  done
elif [[ "$RESTART_FAIL" == "1" ]]; then
  echo "shell-smoke: MFBE_SMOKE_RESTART_FAIL needs MFBE_SMOKE_RESTART=1" >&2
  exit 1
fi
CLOSE="${MFBE_SMOKE_CLOSE:-0}"
if [[ "$CLOSE" == "1" ]]; then
  if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" || -z "${MFBE_SMOKE_OPEN_FILE:-}" ]]; then
    echo "shell-smoke: MFBE_SMOKE_CLOSE needs MFBE_SMOKE_REAL_UI=1 and MFBE_SMOKE_OPEN_FILE" >&2
    exit 1
  fi
  if [[ "$RESTART" == "1" || -n "$SELFTEST" || "${MFBE_SMOKE_CLIPBOARD:-0}" == "1" ]]; then
    echo "shell-smoke: MFBE_SMOKE_CLOSE is exclusive with the restart and self-test scenarios" >&2
    exit 1
  fi
  # The close request must come from a window manager, as the title-bar button's does.
  for tool in openbox xdotool; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "shell-smoke: MFBE_SMOKE_CLOSE needs '$tool' (apt-get install openbox xdotool)" >&2
      exit 1
    fi
  done
fi
SAVE_AS="${MFBE_SMOKE_SAVE_AS:-0}"
if [[ "$SAVE_AS" == "1" ]]; then
  if [[ "${MFBE_SMOKE_REAL_UI:-0}" != "1" || -n "$PORTABLE_DIR" ]]; then
    echo "shell-smoke: MFBE_SMOKE_SAVE_AS needs MFBE_SMOKE_REAL_UI=1 and the per-user folders (not MFBE_SMOKE_PORTABLE)" >&2
    exit 1
  fi
  if [[ "$RESTART" == "1" || "$CLOSE" == "1" || -n "$SELFTEST" || "${MFBE_SMOKE_CLIPBOARD:-0}" == "1" ]]; then
    echo "shell-smoke: MFBE_SMOKE_SAVE_AS is exclusive with the close, restart and self-test scenarios" >&2
    exit 1
  fi
  # The GTK dialog is driven through the X server (xdotool) under a window manager that gives
  # it the focus (openbox).
  for tool in openbox xdotool; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "shell-smoke: MFBE_SMOKE_SAVE_AS needs '$tool' (apt-get install openbox xdotool)" >&2
      exit 1
    fi
  done
fi
# Clipboard check: a GTK clipboard owner must live on the same virtual display as the shell,
# so both are started by one wrapper script under xvfb-run.
LAUNCHER="$MFBE_APP_BIN"
if [[ "${MFBE_SMOKE_CLIPBOARD:-0}" == "1" ]]; then
  if [[ -n "$SELFTEST" ]]; then
    echo "shell-smoke: MFBE_SMOKE_CLIPBOARD and MFBE_SMOKE_MESSAGEBOX are exclusive" >&2
    exit 1
  fi
  if ! python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null; then
    echo "shell-smoke: MFBE_SMOKE_CLIPBOARD needs python3-gi with GTK 3" >&2
    exit 1
  fi
  SELFTEST="clipboard"
  cat >"$TMP/clipboard-owner.py" <<'PY'
import sys
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
clipboard.set_image(GdkPixbuf.Pixbuf.new_from_file(sys.argv[1]))
GLib.timeout_add_seconds(120, Gtk.main_quit)
Gtk.main()
PY
  cat >"$TMP/launch.sh" <<SH
#!/bin/bash
python3 "$TMP/clipboard-owner.py" "$ROOT/resources/icons/app/mfbe-64.png" >"$TMP/clipboard-owner.log" 2>&1 &
sleep 1
exec "$MFBE_APP_BIN" "\$@"
SH
  chmod +x "$TMP/launch.sh"
  LAUNCHER="$TMP/launch.sh"
fi
# Close and Save As scenarios: a window manager must run on the display - to turn Alt+F4 into
# the close request of the title-bar button (WM_DELETE_WINDOW), to give the GTK Save dialog the
# focus; the wrapper starts openbox and writes the display's address (DISPLAY, XAUTHORITY of
# xvfb-run) for shell-smoke.mjs, which drives xdotool.
if [[ "$CLOSE" == "1" || "$SAVE_AS" == "1" ]]; then
  export MFBE_SMOKE_DISPLAY_FILE="$TMP/display.env"
  cat >"$TMP/launch.sh" <<SH
#!/bin/bash
openbox >"$TMP/wm.log" 2>&1 &
sleep 0.5
printf 'DISPLAY=%s\nXAUTHORITY=%s\n' "\$DISPLAY" "\${XAUTHORITY:-}" >"$MFBE_SMOKE_DISPLAY_FILE"
exec "$MFBE_APP_BIN" "\$@"
SH
  chmod +x "$TMP/launch.sh"
  LAUNCHER="$TMP/launch.sh"
fi
# Restart scenario: the display must outlive the first process, and a window manager must run on
# it so that a maximised window is really maximised and comes back so. The wrapper starts openbox
# (when installed), the shell, and after the shell ended keeps the display up while the instance
# it started (same debugging port, a session of its own) is running.
if [[ "$RESTART" == "1" ]]; then
  WM=""
  if command -v openbox >/dev/null 2>&1; then
    WM="openbox"
  else
    echo "shell-smoke: note: no window manager (openbox) installed - the maximised state cannot be real on this display"
  fi
  cat >"$TMP/launch.sh" <<SH
#!/bin/bash
if [[ -n "$WM" ]]; then
  "$WM" >"$TMP/wm.log" 2>&1 &
  sleep 0.5
fi
"$MFBE_APP_BIN" "\$@" &
SHELL_PID=\$!
echo "smoke-launcher: shell pid \$SHELL_PID"
wait "\$SHELL_PID"
echo "smoke-launcher: shell pid \$SHELL_PID ended with \$?"
port=""
for arg in "\$@"; do
  case "\$arg" in --remote-debugging-port=*) port="\${arg#--remote-debugging-port=}" ;; esac
done
while [[ -n "\$port" ]] && pgrep -f -- "^[^ ]*mfbe .*--remote-debugging-port=\$port" >/dev/null; do
  sleep 0.5
done
SH
  chmod +x "$TMP/launch.sh"
  LAUNCHER="$TMP/launch.sh"
fi
# The smoke stays offline: a fresh settings file would make the start-up version check due
# (feature 003, default monthly), so the schedule is preset to "never" - in the per-user
# config folder, or in the portable copy's own settings file (preset above; the per-user
# folders must stay untouched in that scenario). The Save As scenario also seeds the folder
# the file dialogs last used (session.lastFileDialogFolder, feature 002) with a Cyrillic folder
# of this run, where the GTK dialog then opens and the files land.
if [[ -z "$PORTABLE_DIR" ]]; then
  mkdir -p "$TMP/home/.config/maxfbeditor"
  if [[ "$SAVE_AS" == "1" ]]; then
    export MFBE_SMOKE_SAVE_AS_FOLDER="$TMP/home/Книги"
    mkdir -p "$MFBE_SMOKE_SAVE_AS_FOLDER"
    # JSON with \u escapes: valid whatever the locale of this shell.
    python3 -c '
import json, os
print(json.dumps({"schemaVersion": 1, "other": {"versionCheck": "never"},
                  "session": {"lastFileDialogFolder": os.environ["MFBE_SMOKE_SAVE_AS_FOLDER"]}}))' \
      >"$TMP/home/.config/maxfbeditor/settings.json"
  else
    printf '{ "schemaVersion": 1, "other": { "versionCheck": "never" } }\n' \
      >"$TMP/home/.config/maxfbeditor/settings.json"
  fi
fi
# The real UI's View > Status Bar must reach that settings file (shell-smoke.mjs,
# MFBE_SMOKE_SETTINGS_FILE): the step of the Windows journey (tools/ci/windows-russian-journey.ps1)
# on this host.
if [[ "${MFBE_SMOKE_REAL_UI:-0}" == "1" ]]; then
  export MFBE_SMOKE_SETTINGS_FILE="${PORTABLE_DIR:-$TMP/home/.config/maxfbeditor}/settings.json"
fi
# GTK decodes this PNG while the shell starts, as it does for the images of many desktop themes.
mkdir -p "$TMP/home/.config/gtk-3.0"
printf '* { background-image: url("%s"); }\n' "$ROOT/resources/icons/app/mfbe-64.png" \
  >"$TMP/home/.config/gtk-3.0/gtk.css"
# The shell's log of this run, for shell-smoke.mjs: the "shelltest: argv" lines of the restart
# check and the engine's spell-check line of every run (feature 004 US9).
export MFBE_SMOKE_LOG="$TMP/mfbe.log"

# Starts the shell under Xvfb with the common arguments plus "$@" and waits for its CDP endpoint.
start_shell() {
  CDP_PORT="${MFBE_SMOKE_CDP_PORT:-$(pick_free_port)}"
  echo "shell-smoke: $MFBE_APP_BIN --remote-debugging-port=$CDP_PORT ${SANDBOX_ARGS[*]:-} ${URL_ARGS[*]:-} $* ${FILE_ARGS[*]:-} (page: $MFBE_SMOKE_URL)"
  # Isolated HOME/XDG so a developer's real profile is never touched even outside --url mode.
  HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/home/.config" XDG_DATA_HOME="$TMP/home/.local/share" \
  XDG_STATE_HOME="$TMP/home/.local/state" MFBE_SHELL_SELFTEST="$SELFTEST" \
  setsid xvfb-run -a -s "-screen 0 1280x800x24" "$LAUNCHER" \
    --remote-debugging-port="$CDP_PORT" "${SANDBOX_ARGS[@]}" "${URL_ARGS[@]}" "$@" "${FILE_ARGS[@]}" \
    >>"$TMP/mfbe.log" 2>&1 &
  APP_PID=$!

  local version_json=""
  local deadline=$((SECONDS + TIMEOUT_S))
  while (( SECONDS < deadline )); do
    if version_json=$(curl -sf "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null) && [[ -n "$version_json" ]]; then
      break
    fi
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "shell-smoke: the shell exited before the CDP endpoint came up" >&2
      exit 1
    fi
    sleep 0.5
  done
  if [[ -z "$version_json" ]]; then
    echo "shell-smoke: CDP endpoint 127.0.0.1:$CDP_PORT not reachable after ${TIMEOUT_S}s" >&2
    exit 1
  fi
  printf '%s' "$version_json" | python3 -c '
import json, sys
info = json.load(sys.stdin)
print("CDP Browser:    ", info.get("Browser"))
print("CDP User-Agent: ", info.get("User-Agent"))
print("CDP Protocol:   ", info.get("Protocol-Version"))
'
}

# The browser engine's own spell checking is off (feature 004 US9, FR-081; shell.md §1): the
# shell's "shelltest: spellcheck engine=off" line, printed by a test-hook build once the browser
# context is initialised. "engine=error <text>" fails whatever the build; a test-hook shell
# (recognised by its "shelltest: argv" line) must have printed "engine=off"; a shell without test
# hooks prints no shelltest line and is reported as such. Called after every CDP scenario, when
# the line is long in the log (it precedes the window).
check_spellcheck_engine() {
  local log="$TMP/mfbe.log"
  if grep -q "^shelltest: spellcheck engine=error" "$log" 2>/dev/null; then
    echo "shell-smoke: the shell could not switch the engine's spell checking off: $(grep -o "shelltest: spellcheck engine=error.*" "$log" | head -n1)" >&2
    exit 1
  fi
  if grep -qxF "shelltest: spellcheck engine=off" "$log" 2>/dev/null; then
    echo "shell-smoke: engine spell checking: off (shelltest: spellcheck engine=off)"
  elif grep -q "^shelltest: argv " "$log" 2>/dev/null; then
    echo "shell-smoke: a test-hook shell did not report 'shelltest: spellcheck engine=off'" >&2
    exit 1
  else
    echo "shell-smoke: engine spell checking: no shelltest line (a shell without test hooks); the page attributes are checked by the e2e journey"
  fi
}

if [[ "$RESTART" == "1" ]]; then
  # --- restart of the editor by itself (feature 003 US3) ----------------------------------------
  if [[ "$RESTART_FAIL" == "1" ]]; then
    VARIANTS=(normal)
    # Honoured by test-hook builds only: the relaunch tries this program instead of its own.
    export MFBE_RELAUNCH_PROGRAM="/nonexistent/folder/mfbe"
    export MFBE_SMOKE_RESTART_FAIL=1
  else
    # MFBE_SMOKE_RESTART_VARIANTS=normal|max|normal,max (default both) narrows a diagnosis.
    IFS=',' read -r -a VARIANTS <<<"${MFBE_SMOKE_RESTART_VARIANTS:-normal,max}"
  fi
  for variant in "${VARIANTS[@]}"; do
    geometry="40,30,1000,650"
    if [[ "$variant" == "max" ]]; then
      geometry="40,30,1000,650,max"
    fi
    echo "shell-smoke: restart scenario '$variant' (--window-geometry $geometry)"
    start_shell --window-geometry "$geometry"
    MFBE_SMOKE_RESTART="$variant" MFBE_SMOKE_SCREENSHOT="${MFBE_SMOKE_SCREENSHOT%.png}-restart-$variant.png" \
      node "$ROOT/tools/shell-smoke.mjs" "$CDP_PORT"
    check_spellcheck_engine
    stop_shell
  done
  if grep -q "mfbe: sandbox available" "$TMP/mfbe.log"; then
    echo "shell-smoke: sandbox: on ($(grep -o "sandbox available ([^)]*)" "$TMP/mfbe.log" | head -n1))"
  elif grep -q "mfbe: Chromium sandbox unavailable" "$TMP/mfbe.log"; then
    echo "shell-smoke: sandbox: off - $(grep -o "Chromium sandbox unavailable ([^;]*;[^;]*;[^)]*)" "$TMP/mfbe.log" | head -n1)"
  fi
  exit 0
fi

start_shell

# --- Playwright over CDP ----------------------------------------------------------------------
node "$ROOT/tools/shell-smoke.mjs" "$CDP_PORT"
check_spellcheck_engine

if [[ "$CLOSE" == "1" ]]; then
  # The scenario ended with the editor closing itself (No in the save prompt): the shell - and
  # with it xvfb-run - must have exited cleanly.
  status=""
  for _ in $(seq 1 40); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  if kill -0 "$APP_PID" 2>/dev/null; then
    echo "shell-smoke: the shell is still running after the close scenario" >&2
    exit 1
  fi
  wait "$APP_PID" && status=0 || status=$?
  APP_PID=""
  if [[ "$status" != "0" ]]; then
    echo "shell-smoke: the shell exited with status $status after the close scenario" >&2
    exit 1
  fi
  echo "shell-smoke: close: the shell exited cleanly (status 0)"
fi

if [[ -n "$PORTABLE_DIR" ]]; then
  for sub in cef logs; do
    if [[ ! -d "$PORTABLE_DIR/$sub" ]]; then
      echo "shell-smoke: the portable copy has no $sub/ in $PORTABLE_DIR" >&2
      exit 1
    fi
  done
  for folder in "$TMP/home/.config/maxfbeditor" "$TMP/home/.local/share/maxfbeditor" \
                "$TMP/home/.local/state/maxfbeditor"; do
    if [[ -e "$folder" ]]; then
      echo "shell-smoke: the portable copy wrote into the per-user folder $folder" >&2
      exit 1
    fi
  done
  echo "shell-smoke: portable copy keeps its data in $PORTABLE_DIR:" \
    "$(find "$PORTABLE_DIR" -mindepth 1 -maxdepth 1 -printf '%f ')"
fi

# Sandbox decision of the shell (T140): "sandbox available (...)" or "Chromium sandbox
# unavailable (...); running without the sandbox".
if grep -q "mfbe: sandbox available" "$TMP/mfbe.log"; then
  echo "shell-smoke: sandbox: on ($(grep -o "sandbox available ([^)]*)" "$TMP/mfbe.log" | head -n1))"
elif grep -q "mfbe: Chromium sandbox unavailable" "$TMP/mfbe.log"; then
  echo "shell-smoke: sandbox: off - $(grep -o "Chromium sandbox unavailable ([^;]*;[^;]*;[^)]*)" "$TMP/mfbe.log" | head -n1)"
elif [[ "${MFBE_SMOKE_NO_SANDBOX:-0}" == "1" ]]; then
  echo "shell-smoke: sandbox: off (--no-sandbox requested)"
fi

if [[ "$SELFTEST" == "messagebox" ]]; then
  # The shell prints the answer of the native message box once the OK click arrives.
  for _ in $(seq 1 40); do
    grep -q "selftest: messagebox button=ok" "$TMP/mfbe.log" 2>/dev/null && break
    sleep 0.25
  done
  if grep -q "selftest: messagebox button=ok" "$TMP/mfbe.log"; then
    echo "shell-smoke: native message box answered: button=ok"
  else
    echo "shell-smoke: the shell did not report the message box answer" >&2
    exit 1
  fi
elif [[ "$SELFTEST" == "openfile" ]]; then
  # The shell prints the dialog's types after 1 s and "cancelled" once it closed it after 2 s.
  for _ in $(seq 1 60); do
    grep -q "selftest: openfile cancelled" "$TMP/mfbe.log" 2>/dev/null && break
    sleep 0.25
  done
  expected="selftest: openfile types=FictionBook files (*.fb2)|FictionBook descriptors (*.fbd)|All files (*.*) active=FictionBook files (*.fb2) shown=yes"
  if grep -qxF "$expected" "$TMP/mfbe.log" && grep -q "selftest: openfile cancelled" "$TMP/mfbe.log"; then
    echo "shell-smoke: GTK Open dialog: $(grep -o "selftest: openfile types=.*" "$TMP/mfbe.log" | head -n1)"
  else
    echo "shell-smoke: the GTK Open dialog did not show the editor's file types ($(grep -o "selftest: openfile.*" "$TMP/mfbe.log" | tr '\n' ' '))" >&2
    exit 1
  fi
elif [[ "$SELFTEST" == "clipboard" ]]; then
  for _ in $(seq 1 60); do
    grep -q "selftest: clipboard" "$TMP/mfbe.log" 2>/dev/null && break
    sleep 0.25
  done
  if grep -q "selftest: clipboard [0-9]* image/png" "$TMP/mfbe.log"; then
    echo "shell-smoke: clipboard image read by the shell: $(grep -o "selftest: clipboard.*" "$TMP/mfbe.log" | head -n1)"
  else
    echo "shell-smoke: the shell did not read the clipboard image ($(grep -o "selftest: clipboard.*" "$TMP/mfbe.log" | head -n1))" >&2
    exit 1
  fi
fi

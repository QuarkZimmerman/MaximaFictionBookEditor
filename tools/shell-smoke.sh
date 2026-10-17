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
#                               (skipped with a note when the UI has no About dialog yet)
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

TMP=$(mktemp -d -t mfbe-smoke.XXXXXX)
HTTP_PID=""
APP_PID=""
CDP_PORT=""
PORTABLE_DIR=""
# Ends the shell started by start_shell (and, in the restart scenario, the instance it started,
# which runs in a session of its own and is found by its debugging port).
stop_shell() {
  if [[ -n "$APP_PID" ]]; then
    # xvfb-run was started in its own session: terminate the whole group (Xvfb + shell +
    # Chromium sub-processes).
    kill -TERM -- "-$APP_PID" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$APP_PID" 2>/dev/null
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
# folders must stay untouched in that scenario).
if [[ -z "$PORTABLE_DIR" ]]; then
  mkdir -p "$TMP/home/.config/maxfbeditor"
  printf '{ "schemaVersion": 1, "other": { "versionCheck": "never" } }\n' \
    >"$TMP/home/.config/maxfbeditor/settings.json"
fi
# GTK decodes this PNG while the shell starts, as it does for the images of many desktop themes.
mkdir -p "$TMP/home/.config/gtk-3.0"
printf '* { background-image: url("%s"); }\n' "$ROOT/resources/icons/app/mfbe-64.png" \
  >"$TMP/home/.config/gtk-3.0/gtk.css"

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

if [[ "$RESTART" == "1" ]]; then
  # --- restart of the editor by itself (feature 003 US3) ----------------------------------------
  export MFBE_SMOKE_LOG="$TMP/mfbe.log"
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

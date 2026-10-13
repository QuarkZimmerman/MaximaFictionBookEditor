#!/usr/bin/env bash
# CEF shell smoke test under Xvfb + CDP (T035). Builds nothing.
#
# Starts the shell under a virtual X display with --remote-debugging-port, waits for the CDP
# endpoint (/json/version), then runs tools/shell-smoke.mjs (Playwright connectOverCDP) which
# asserts the page title and a visible selector and saves a screenshot.
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
#   MFBE_SMOKE_NO_SANDBOX       1 = pass --no-sandbox explicitly. By default the shell decides
#                               itself (T140, app/src/sandbox_check.cpp): the sandbox stays on
#                               when unprivileged user namespaces or the SUID chrome-sandbox
#                               work and is switched off with a logged warning otherwise
#                               (containers, root); the decision line is echoed at the end.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

MFBE_APP_BIN="${MFBE_APP_BIN:-$ROOT/build/linux-app-debug/bin/mfbe}"
TIMEOUT_S="${MFBE_SMOKE_TIMEOUT_S:-60}"

if [[ ! -x "$MFBE_APP_BIN" ]]; then
  echo "shell-smoke: $MFBE_APP_BIN is not an executable (build a linux-app-* preset or set MFBE_APP_BIN)" >&2
  exit 1
fi
for tool in xvfb-run node python3 curl setsid; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "shell-smoke: required tool '$tool' not found" >&2
    exit 1
  fi
done
if [[ ! -d "$ROOT/ui/node_modules/playwright" && ! -d "$ROOT/ui/node_modules/@playwright/test" ]]; then
  echo "shell-smoke: playwright is not installed in ui/node_modules (run: cd ui && npm ci)" >&2
  exit 1
fi

TMP=$(mktemp -d -t mfbe-smoke.XXXXXX)
HTTP_PID=""
APP_PID=""
cleanup() {
  local status=$?
  set +e
  if [[ -n "$APP_PID" ]]; then
    # xvfb-run was started in its own session: terminate the whole group (Xvfb + shell +
    # Chromium sub-processes).
    kill -TERM -- "-$APP_PID" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$APP_PID" 2>/dev/null
  fi
  if [[ -n "$HTTP_PID" ]]; then
    kill "$HTTP_PID" 2>/dev/null
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
CDP_PORT="${MFBE_SMOKE_CDP_PORT:-$(pick_free_port)}"
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
echo "shell-smoke: $MFBE_APP_BIN --remote-debugging-port=$CDP_PORT ${SANDBOX_ARGS[*]:-} ${URL_ARGS[*]:-} ${FILE_ARGS[*]:-} (page: $MFBE_SMOKE_URL)"
SELFTEST=""
if [[ "${MFBE_SMOKE_MESSAGEBOX:-0}" == "1" ]]; then
  SELFTEST="messagebox"
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
# Isolated HOME/XDG so a developer's real profile is never touched even outside --url mode.
HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/home/.config" XDG_DATA_HOME="$TMP/home/.local/share" \
XDG_STATE_HOME="$TMP/home/.local/state" MFBE_SHELL_SELFTEST="$SELFTEST" \
setsid xvfb-run -a -s "-screen 0 1280x800x24" "$LAUNCHER" \
  --remote-debugging-port="$CDP_PORT" "${SANDBOX_ARGS[@]}" "${URL_ARGS[@]}" "${FILE_ARGS[@]}" \
  >"$TMP/mfbe.log" 2>&1 &
APP_PID=$!

VERSION_JSON=""
deadline=$((SECONDS + TIMEOUT_S))
while (( SECONDS < deadline )); do
  if VERSION_JSON=$(curl -sf "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null) && [[ -n "$VERSION_JSON" ]]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "shell-smoke: the shell exited before the CDP endpoint came up" >&2
    exit 1
  fi
  sleep 0.5
done
if [[ -z "$VERSION_JSON" ]]; then
  echo "shell-smoke: CDP endpoint 127.0.0.1:$CDP_PORT not reachable after ${TIMEOUT_S}s" >&2
  exit 1
fi
printf '%s' "$VERSION_JSON" | python3 -c '
import json, sys
info = json.load(sys.stdin)
print("CDP Browser:    ", info.get("Browser"))
print("CDP User-Agent: ", info.get("User-Agent"))
print("CDP Protocol:   ", info.get("Protocol-Version"))
'

# --- Playwright over CDP ----------------------------------------------------------------------
node "$ROOT/tools/shell-smoke.mjs" "$CDP_PORT"

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

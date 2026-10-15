#!/usr/bin/env bash
# Start of the macOS editor in a Russian environment (feature 002, best effort in CI): Russian as
# the system language (AppleLanguages, restored afterwards) and the bundle from the .dmg copied
# into a folder with Cyrillic letters next to a "user" folder, the portable folder beside the
# bundle (<bundle>.app/../user), where the copy keeps all of its data. The editor is started as
# from Finder, without LANG, LC_ALL or LC_MESSAGES (the variables it reads on macOS), with its
# DevTools port open. Fails when no editor window (page title over the DevTools protocol)
# appears or the browser profile is not in the portable folder; a window whose interface is not
# Russian is reported as a warning.
# Usage: tools/ci/macos-russian-start.sh <.dmg>
set -euo pipefail

dmg=${1:?usage: tools/ci/macos-russian-start.sh <.dmg>}
work="${RUNNER_TEMP:-/tmp}/mfbe-russian-start"
folder="$work/Книги"
rm -rf "$work"
mkdir -p "$folder/user"
hdiutil attach "$dmg" -mountpoint "$work/dmg" -nobrowse -readonly
ditto "$work/dmg/mfbe.app" "$folder/mfbe.app"
hdiutil detach "$work/dmg"

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
# Title of the editor's page in the DevTools target list (stdin), when it shows a document.
page_title='
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
for target in json.load(sys.stdin):
    title = target.get("title", "")
    if target.get("type") == "page" and title.endswith(" - Maxima Fiction Book Editor"):
        print(title)
        break
'

languages=$(defaults read -g AppleLanguages 2>/dev/null || true)
pid=
restore() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  if [ -n "$languages" ]; then
    defaults write -g AppleLanguages "$languages"
  else
    defaults delete -g AppleLanguages 2>/dev/null || true
  fi
}
trap restore EXIT
defaults write -g AppleLanguages '(ru)'

env -u LANG -u LC_ALL -u LC_MESSAGES "$folder/mfbe.app/Contents/MacOS/mfbe" --remote-debugging-port="$port" \
  >"$work/stdout.txt" 2>"$work/stderr.txt" &
pid=$!
title=
deadline=$((SECONDS + 120))
while [ -z "$title" ] && [ "$SECONDS" -lt "$deadline" ] && kill -0 "$pid" 2>/dev/null; do
  title=$(curl -fsS --max-time 5 "http://127.0.0.1:$port/json/list" 2>/dev/null | python3 -c "$page_title" 2>/dev/null || true)
  if [ -z "$title" ]; then
    sleep 1
  fi
done

if [ -z "$title" ]; then
  echo "No editor window within 120 s (editor process $pid $(kill -0 "$pid" 2>/dev/null && echo running || echo ended))"
  for log in "$work/stdout.txt" "$work/stderr.txt" "$folder/user/logs/cef-debug.log"; do
    if [ -f "$log" ]; then
      echo "----- $log (last 40 lines) -----"
      tail -n 40 "$log"
    fi
  done
  exit 1
fi
echo "Editor window: $title"
if [ ! -d "$folder/user/cef" ]; then
  echo "The portable copy did not keep its browser profile in $folder/user"
  exit 1
fi
# A new document is "Без имени" (untitled) in the Russian interface (ui/src/i18n/ru.json).
case "$title" in
  "Без имени - "*) echo "The interface is Russian." ;;
  *) echo "::warning title=Russian environment (macOS)::the interface is not Russian with AppleLanguages (ru): $title" ;;
esac

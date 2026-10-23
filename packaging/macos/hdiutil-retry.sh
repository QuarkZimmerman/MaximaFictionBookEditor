#!/bin/sh
# hdiutil wrapper for CPack's DragNDrop generator (CPACK_COMMAND_HDIUTIL).
#
# On the GitHub macOS runners `hdiutil convert` sometimes fails with
# "Resource temporarily unavailable" (EAGAIN) right after the image was created, while the
# same command succeeds a moment later. CPack runs hdiutil once and gives up, so the dmg of
# an otherwise green build is lost. This wrapper retries the invocation a few times with a
# pause in between and fails only when every attempt failed; a success on any attempt is a
# success. Arguments are passed through unchanged.
attempts=5
delay=10
n=1
while :; do
  if /usr/bin/hdiutil "$@"; then
    exit 0
  fi
  status=$?
  if [ "$n" -ge "$attempts" ]; then
    echo "hdiutil-retry: giving up after $n attempts (last exit status $status)" >&2
    exit "$status"
  fi
  echo "hdiutil-retry: attempt $n of $attempts failed (exit status $status); retrying in ${delay}s" >&2
  n=$((n + 1))
  sleep "$delay"
done

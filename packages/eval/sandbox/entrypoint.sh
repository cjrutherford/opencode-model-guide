#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

sentinel="/workspace/.eval-ready"
for _ in $(seq 1 600); do
  if [ -e "$sentinel" ]; then
    rm -f "$sentinel"
    exec opencode serve \
      --hostname "${OPENCODE_HOSTNAME:-0.0.0.0}" \
      --port "${OPENCODE_PORT:-4096}"
  fi
  sleep 0.1
done

echo "timed out waiting for ${sentinel}" >&2
exit 1

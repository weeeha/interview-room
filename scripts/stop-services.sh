#!/usr/bin/env bash
# Stop only the processes listening on the three local service ports (8942, 8943, 8944).
set -uo pipefail
for port in 8942 8943 8944; do
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    echo "port $port: nothing listening"
    continue
  fi
  # shellcheck disable=SC2086
  kill $pids && echo "port $port: stopped $pids"
done

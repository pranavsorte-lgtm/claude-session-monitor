#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PID_FILE=".server.pid"

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Already running (pid $(cat "${PID_FILE}"))."
  exit 0
fi

nohup bun run server.ts > server.log 2>&1 < /dev/null &
echo $! > "${PID_FILE}"
sleep 0.5

if kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Started (pid $(cat "${PID_FILE}")). Dashboard: http://127.0.0.1:7317"
else
  echo "Failed to start. Check server.log:"
  tail -20 server.log
  exit 1
fi

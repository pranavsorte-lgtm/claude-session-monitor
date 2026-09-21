#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PID_FILE=".server.pid"

if [[ ! -f "${PID_FILE}" ]] || ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Not running."
  rm -f "${PID_FILE}"
  exit 0
fi

kill "$(cat "${PID_FILE}")"
rm -f "${PID_FILE}"
echo "Stopped."

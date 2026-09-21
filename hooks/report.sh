#!/usr/bin/env bash
# Reports one Claude Code hook event to the local session-monitor server.
# Must never block or fail the calling hook, so every exit path is 0 and the
# curl call has a short timeout.
#
# Works in any terminal: walks the process tree to find the long-lived
# `claude` CLI process pid, so the server can later check liveness with
# `kill -0` regardless of which terminal app or multiplexer is in use.
# ITERM_SESSION_ID/TERM_PROGRAM are included too, only to unlock the iTerm2
# bonus features (nicer window title, click-to-focus) when present.
set -u

PORT="${CLAUDE_SESSION_MONITOR_PORT:-7317}"
MONITOR_DIR="$HOME/claude-session-monitor"
payload="$(cat)"

server_up() {
  curl -s -m 1 -o /dev/null "http://127.0.0.1:${PORT}/api/sessions"
}

# Auto-start the monitor on a fresh Claude Code session if it isn't already
# running. start.sh is idempotent (no-ops if a live pid file exists), so this
# is safe even if several sessions start at once.
event_name="$(jq -r '.hook_event_name // empty' <<<"${payload}" 2>/dev/null)"
if [[ "${event_name}" == "SessionStart" ]] && [[ -x "${MONITOR_DIR}/start.sh" ]] && ! server_up; then
  "${MONITOR_DIR}/start.sh" >/dev/null 2>&1
  for _ in 1 2 3 4 5; do
    server_up && break
    sleep 0.2
  done
fi

find_claude_pid() {
  local pid="$$"
  local ppid comm
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ppid="$(ps -o ppid= -p "${pid}" 2>/dev/null | tr -d ' ')"
    [[ -n "${ppid}" && "${ppid}" -gt 1 ]] || break
    comm="$(ps -o comm= -p "${ppid}" 2>/dev/null)"
    if [[ "${comm}" == *claude* ]]; then
      echo "${ppid}"
      return 0
    fi
    pid="${ppid}"
  done
  return 1
}

claude_pid="$(find_claude_pid || true)"

body="$(jq -c \
  --arg iterm_session_id "${ITERM_SESSION_ID:-}" \
  --arg term_program "${TERM_PROGRAM:-}" \
  --arg claude_pid "${claude_pid:-}" \
  '. + {iterm_session_id: $iterm_session_id, term_program: $term_program, claude_pid: $claude_pid}' \
  <<<"${payload}" 2>/dev/null)"

if [[ -n "${body}" ]]; then
  curl -s -m 1 -X POST "http://127.0.0.1:${PORT}/api/event" \
    -H 'Content-Type: application/json' \
    -d "${body}" >/dev/null 2>&1
fi

exit 0

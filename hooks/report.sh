#!/usr/bin/env bash
# Reports one Claude Code hook event to the local session-monitor server.
# Must never block or fail the calling hook, so every exit path is 0 and the
# curl call has a short timeout.
#
# Works in any terminal: walks the process tree to find the long-lived
# `claude` CLI process pid, so the server can later check liveness with
# `kill -0` regardless of which terminal app or multiplexer is in use.
# ITERM_SESSION_ID/tty/TERM_PROGRAM are included too, only to unlock
# per-terminal bonus features (nicer window title, click-to-focus) for
# iTerm2 and Terminal.app.
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

# Terminal.app has no session-id equivalent to iTerm2's, but its AppleScript
# dictionary exposes each tab's tty, which we can match against the claude
# process's controlling terminal to focus the right window/tab.
tty_path=""
if [[ -n "${claude_pid:-}" ]]; then
  tty_short="$(ps -o tty= -p "${claude_pid}" 2>/dev/null | tr -d ' ')"
  [[ -n "${tty_short}" && "${tty_short}" != "??" ]] && tty_path="/dev/${tty_short}"
fi

# Only SessionStart carries a `model` field directly. Every other event can
# still recover the current model by reading the last assistant turn's
# recorded model out of the transcript file, so already-running sessions get
# the badge too, not just ones restarted after this code existed.
transcript_path="$(jq -r '.transcript_path // empty' <<<"${payload}" 2>/dev/null)"
model_from_transcript=""
if [[ -n "${transcript_path}" && -f "${transcript_path}" ]]; then
  model_from_transcript="$(tail -n 200 "${transcript_path}" 2>/dev/null \
    | jq -r 'select(.type == "assistant") | .message.model // empty' 2>/dev/null \
    | tail -1)"
fi

body="$(jq -c \
  --arg iterm_session_id "${ITERM_SESSION_ID:-}" \
  --arg term_program "${TERM_PROGRAM:-}" \
  --arg claude_pid "${claude_pid:-}" \
  --arg tty "${tty_path:-}" \
  --arg model_from_transcript "${model_from_transcript:-}" \
  '. + {iterm_session_id: $iterm_session_id, term_program: $term_program, claude_pid: $claude_pid, tty: $tty}
   | if $model_from_transcript != "" then .model = $model_from_transcript else . end' \
  <<<"${payload}" 2>/dev/null)"

if [[ -n "${body}" ]]; then
  curl -s -m 1 -X POST "http://127.0.0.1:${PORT}/api/event" \
    -H 'Content-Type: application/json' \
    -d "${body}" >/dev/null 2>&1
fi

exit 0

# Claude Session Monitor

A local dashboard for tracking several parallel Claude Code sessions at once.
Each card shows one session's status, so you know at a glance which window
needs your attention: orange pulsing = needs input, green = finished (go
check it), blue = working, grey = closed.

## Requirements

- macOS.
- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`).
- `jq`, `curl` — both ship with macOS or are already on your machine if
  you've used other dev tooling.
- iTerm2 or Terminal.app unlock window title enrichment and click-to-focus.
  Any other terminal still gets full status tracking, just without those two
  bonuses (see [Limitations](#limitations)).

## Setup

1. Clone this repo to **exactly** `~/claude-session-monitor`. The hook script
   hardcodes that path to find the server:

   ```bash
   git clone https://github.com/pranavsorte-lgtm/claude-session-monitor.git ~/claude-session-monitor
   ```

2. Add this to your `~/.claude/settings.json`. If you already have a `hooks`
   key, merge these event arrays into it instead of replacing the whole file:

   ```json
   {
     "hooks": {
       "SessionStart": [
         { "hooks": [{ "type": "command", "command": "\"$HOME/claude-session-monitor/hooks/report.sh\"" }] }
       ],
       "UserPromptSubmit": [
         { "hooks": [{ "type": "command", "command": "\"$HOME/claude-session-monitor/hooks/report.sh\"" }] }
       ],
       "Notification": [
         { "hooks": [{ "type": "command", "command": "\"$HOME/claude-session-monitor/hooks/report.sh\"" }] }
       ],
       "Stop": [
         { "hooks": [{ "type": "command", "command": "\"$HOME/claude-session-monitor/hooks/report.sh\"" }] }
       ],
       "SessionEnd": [
         { "hooks": [{ "type": "command", "command": "\"$HOME/claude-session-monitor/hooks/report.sh\"" }] }
       ]
     }
   }
   ```

3. Open a new Claude Code session. Its `SessionStart` hook auto-starts the
   monitor server if it isn't already running — nothing else to do.

   To start it by hand instead (e.g. before opening any session):

   ```bash
   ~/claude-session-monitor/start.sh
   ```

4. Open the dashboard: **http://127.0.0.1:7317**

### Optional: shell aliases

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
alias start-session-monitor='cd "$HOME/claude-session-monitor" && ./start.sh'
alias stop-session-monitor='cd "$HOME/claude-session-monitor" && ./stop.sh'
```

## Usage

- **Card color / status**: orange and pulsing = Claude needs your input
  (permission prompt or similar); green = finished its turn, waiting on you;
  blue = actively working; grey = the session's window closed.
- **Model badge**: the model that session's last turn ran on (Sonnet 5,
  Opus 5, Haiku 4.5, etc.).
- **Click a card**: in iTerm2 or Terminal.app, jumps straight to that
  window/tab/pane. In any other terminal, clicking does nothing yet — there's
  no equivalent focus API to hook into.
- The dashboard tab's browser title shows a `(N)` count of sessions that need
  attention, so you can spot it from a backgrounded tab or the taskbar.

## Commands

```bash
~/claude-session-monitor/start.sh   # start (safe to re-run; no-ops if already running)
~/claude-session-monitor/stop.sh    # stop
```

Logs go to `server.log` in this folder; the running server's pid is tracked
in `.server.pid`. Both are gitignored.

## Configuration

Change the port if `7317` conflicts with something on your machine:

```bash
CLAUDE_SESSION_MONITOR_PORT=8123 ~/claude-session-monitor/start.sh
```

Set the same value in your shell environment (or export it globally) so the
hook script posts to the same port.

## How it works

- **Status signal**: Claude Code hooks (`SessionStart`, `UserPromptSubmit`,
  `Notification`, `Stop`, `SessionEnd`) POST an event to a local Bun server
  every time they fire. The server keeps an in-memory map of session →
  status. Nothing is ever written to disk or sent anywhere off your machine.
- **Model badge**: every hook payload includes the session's `transcript_path`.
  The hook script reads the last `assistant` entry in that file to recover
  the model the session is currently running on.
- **"Closed" detection**: the hook script walks the process tree to find the
  long-lived `claude` CLI pid and reports it. The server periodically checks
  that pid with `kill -0` (a POSIX liveness check) — this is what makes
  "closed" detection terminal-agnostic instead of tied to any one terminal
  app.
- **iTerm2/Terminal.app bonuses**: when a session reports `TERM_PROGRAM`
  `iTerm.app` or `Apple_Terminal`, the server also polls that terminal over
  AppleScript for the pane/tab's live title (matched by iTerm2's session id,
  or by tty for Terminal.app), and can select that exact window/tab on click.

## Limitations

- Click-to-focus and rich window titles only work in iTerm2 and Terminal.app.
- The model badge reflects the model as of the last completed turn; a
  mid-session `/model` switch won't show until the next turn finishes.
- Everything is local to one machine — this isn't a shared/team dashboard.
  Each person who wants it runs their own copy against their own sessions.
- Must be cloned to `~/claude-session-monitor` (or edit the hardcoded path in
  `hooks/report.sh` and your hook commands to match wherever you put it).

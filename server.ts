// Local dashboard for tracking multiple parallel Claude Code sessions.
// Primary signal: Claude Code hooks (Notification/Stop/SessionStart/
// SessionEnd/UserPromptSubmit) POSTed here by hooks/report.sh.
// Liveness ("is this window still open") uses `kill -0` on the claude CLI
// pid the hook script found, so it works in any terminal or multiplexer.
// iTerm2 AppleScript is an optional bonus layer: nicer window titles and a
// click-to-focus action, used only when a session reports TERM_PROGRAM
// "iTerm.app".

const PORT = Number(process.env.CLAUDE_SESSION_MONITOR_PORT ?? 7317);

type Status = "working" | "needs_input" | "done" | "closed";

interface SessionRecord {
  sessionId: string;
  cwd: string;
  termProgram: string;
  itermSessionId: string | null; // uuid only, no window/tab/pane prefix
  claudePid: string | null;
  model: string | null; // only SessionStart carries this; stale after a mid-session /model switch
  title: string | null; // filled in from iTerm2 poll when available
  status: Status;
  lastEventName: string;
  lastMessage: string;
  updatedAt: number;
  closedAt: number | null;
}

const sessions = new Map<string, SessionRecord>();

function truncate(s: unknown, n = 200): string {
  const str = typeof s === "string" ? s : "";
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

const MODEL_DISPLAY_NAMES: Array<[RegExp, string]> = [
  [/^claude-opus-5/, "Opus 5"],
  [/^claude-sonnet-5/, "Sonnet 5"],
  [/^claude-fable-5/, "Fable 5"],
  [/^claude-haiku-4-5/, "Haiku 4.5"],
];

function displayModel(modelId: string | null): string | null {
  if (!modelId) return null;
  for (const [pattern, label] of MODEL_DISPLAY_NAMES) {
    if (pattern.test(modelId)) return label;
  }
  return modelId; // unrecognized id: show it raw rather than hide it
}

function upsert(body: Record<string, unknown>) {
  const sessionId = String(body.session_id ?? "");
  if (!sessionId) return;

  const existing = sessions.get(sessionId);
  const itermFull = typeof body.iterm_session_id === "string" ? body.iterm_session_id : "";
  const itermUuid = itermFull ? itermFull.split(":").pop() ?? null : existing?.itermSessionId ?? null;
  const claudePid = typeof body.claude_pid === "string" && body.claude_pid ? body.claude_pid : existing?.claudePid ?? null;
  const model = typeof body.model === "string" && body.model ? body.model : existing?.model ?? null;

  let status: Status = existing?.status ?? "working";
  let lastMessage = existing?.lastMessage ?? "";
  const eventName = String(body.hook_event_name ?? "");

  switch (eventName) {
    case "SessionStart":
    case "UserPromptSubmit":
      status = "working";
      lastMessage = ""; // clear any stale Notification/Stop text from the prior turn
      break;
    case "Notification":
      status = "needs_input";
      lastMessage = truncate(body.message);
      break;
    case "Stop":
      status = "done";
      lastMessage = truncate(body.last_assistant_message);
      break;
    case "SessionEnd":
      status = "closed";
      break;
    default:
      break;
  }

  sessions.set(sessionId, {
    sessionId,
    cwd: typeof body.cwd === "string" && body.cwd ? body.cwd : existing?.cwd ?? "",
    termProgram: typeof body.term_program === "string" && body.term_program ? body.term_program : existing?.termProgram ?? "",
    itermSessionId: itermUuid,
    claudePid,
    model,
    title: existing?.title ?? null,
    status,
    lastEventName: eventName || existing?.lastEventName || "",
    lastMessage,
    updatedAt: Date.now(),
    closedAt: status === "closed" ? existing?.closedAt ?? Date.now() : null,
  });
}

function isAlive(pid: string): boolean {
  try {
    // kill -0 signals nothing; it just checks whether the pid exists and is
    // ours to signal. This is the generic, terminal-agnostic liveness check.
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function checkLiveness() {
  const now = Date.now();
  for (const rec of sessions.values()) {
    if (rec.status === "closed") continue;
    if (!rec.claudePid) continue;
    if (!isAlive(rec.claudePid)) {
      rec.status = "closed";
      rec.closedAt = now;
      rec.updatedAt = now;
    }
  }
  // Drop closed sessions from the board after a short grace period so a
  // closed card is visible for a moment instead of vanishing instantly.
  for (const [key, rec] of sessions) {
    if (rec.status === "closed" && rec.closedAt && now - rec.closedAt > 20_000) {
      sessions.delete(key);
    }
  }
}

const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

async function pollIterm2() {
  const hasItermSessions = Array.from(sessions.values()).some(
    (rec) => rec.termProgram === "iTerm.app" && rec.itermSessionId && rec.status !== "closed",
  );
  if (!hasItermSessions) return;

  const script = `
tell application "iTerm2"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set out to out & (unique id of s) & "\t" & (name of s) & linefeed
      end repeat
    end repeat
  end repeat
  return out
end tell`;

  try {
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    const live = new Map<string, string>();
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      live.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim());
    }
    for (const rec of sessions.values()) {
      if (!rec.itermSessionId) continue;
      const liveName = live.get(rec.itermSessionId);
      if (liveName !== undefined) rec.title = liveName;
    }
  } catch {
    // iTerm2 not running or not scriptable this cycle; skip silently.
  }
}

async function focusIterm2Session(itermSessionId: string): Promise<boolean> {
  if (!UUID_RE.test(itermSessionId)) return false;
  const script = `
tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (unique id of s) is equal to "${itermSessionId}" then
          select w
          tell w to select t
          tell t to select s
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
  return "not_found"
end tell`;
  const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  return out.trim() === "ok";
}

setInterval(checkLiveness, 4000);
setInterval(() => void pollIterm2(), 4000);

const indexHtml = await Bun.file(new URL("./public/index.html", import.meta.url)).text();

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/api/event") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        upsert(body);
      } catch {
        // malformed payload; drop it, never break the caller
      }
      return new Response("ok");
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const list = Array.from(sessions.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((rec) => ({ ...rec, modelDisplay: displayModel(rec.model) }));
      return Response.json(list);
    }

    if (req.method === "POST" && url.pathname === "/api/focus") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const itermSessionId = String(body.itermSessionId ?? "");
      const ok = await focusIterm2Session(itermSessionId);
      return Response.json({ ok });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`claude-session-monitor listening on http://127.0.0.1:${PORT}`);

// Logging the TV in to Deezer from a phone: the TV can't type, so the Music tab shows a QR code
// for /music-login/, where the phone's keyboard (and password manager) fills in a form. The Hub
// keeps what was typed in memory for two minutes, tells the TV it's there, and hands it over
// once; the box fills in Deezer's own login page with it. Nothing is written to disk or logged.
// The TV then says how it went (logged in, or what Deezer said), and the phone page shows that.

import { randomUUID } from "node:crypto";
import type { WebAppLoginReport } from "@ultimatetv/shared";

const TTL_MS = 2 * 60_000;
const STATUS_TTL_MS = 10 * 60_000;

/** Where a login from the phone is: waiting for the TV, with the TV, or done (how it went). */
export type MusicLoginStatus = { state: "waiting" | "working" | "gone" } | ({ state: "done" } & WebAppLoginReport);

export interface PendingLogin {
  email: string;
  password: string;
}

export class MusicLogins {
  private pending = new Map<string, PendingLogin & { expires: number }>();
  private statuses = new Map<string, { status: MusicLoginStatus; expires: number }>();

  add(login: PendingLogin, now = Date.now()): string {
    for (const [id, p] of this.pending) if (p.expires < now) this.pending.delete(id);
    for (const [id, s] of this.statuses) if (s.expires < now) this.statuses.delete(id);
    const id = randomUUID();
    this.pending.set(id, { ...login, expires: now + TTL_MS });
    this.statuses.set(id, { status: { state: "waiting" }, expires: now + STATUS_TTL_MS });
    return id;
  }

  /** Once only: the login is gone after the TV has fetched it. */
  take(id: string, now = Date.now()): PendingLogin | null {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (!p || p.expires < now) return null;
    this.setStatus(id, { state: "working" }, now);
    return { email: p.email, password: p.password };
  }

  /** The TV's answer: how the login went. */
  report(id: string, report: WebAppLoginReport, now = Date.now()): boolean {
    if (!this.statuses.has(id)) return false;
    this.setStatus(id, { state: "done", result: report.result, ...(report.message ? { message: report.message.slice(0, 300) } : {}) }, now);
    return true;
  }

  status(id: string, now = Date.now()): MusicLoginStatus {
    const s = this.statuses.get(id);
    if (!s || s.expires < now) return { state: "gone" };
    // Never taken by the TV and now too old to be.
    if (s.status.state === "waiting" && !this.pending.has(id)) return { state: "gone" };
    if (s.status.state === "waiting" && (this.pending.get(id)?.expires ?? 0) < now) return { state: "gone" };
    return s.status;
  }

  private setStatus(id: string, status: MusicLoginStatus, now: number): void {
    this.statuses.set(id, { status, expires: now + STATUS_TTL_MS });
  }
}

export const MUSIC_LOGIN_PAGE = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070b14">
<title>Log in to Deezer on the TV</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #070b14; color: #f3f6fb; font: 17px/1.4 Inter, "Noto Sans", Roboto, system-ui, sans-serif; display: grid; place-items: center; padding: 24px 18px; }
  main { width: 100%; max-width: 420px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .brand { display: inline-block; padding: 4px 10px; border-radius: 8px; background: linear-gradient(135deg, #a238ff, #5a1fc2); font-weight: 800; font-size: 14px; letter-spacing: .04em; margin-bottom: 14px; }
  p { color: #9aa6bd; margin: 0 0 22px; }
  label { display: block; font-size: 14px; color: #9aa6bd; margin: 0 0 6px; }
  input { width: 100%; height: 52px; padding: 0 14px; margin: 0 0 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: #121b2e; color: inherit; font: inherit; }
  input:focus { outline: 2px solid #3d8bff; border-color: transparent; }
  button { width: 100%; height: 54px; border: 0; border-radius: 14px; background: #a238ff; color: #fff; font: inherit; font-weight: 700; }
  button:disabled { opacity: .6; }
  #status { margin-top: 18px; min-height: 1.4em; text-align: center; }
  .ok { color: #35c27a; } .bad { color: #ff5468; }
  small { display: block; margin-top: 26px; color: #66728a; font-size: 13px; }
</style>
<script src="/remote/pair.js"></script>
</head>
<body>
<main>
  <span class="brand">DEEZER</span>
  <h1>Log in on the TV</h1>
  <p>Type your Deezer email and password here. The TV fills them in on Deezer's own login page.</p>
  <form id="f">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" autocapitalize="off" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button id="go">Log in on the TV</button>
  </form>
  <div id="status"></div>
  <small>Sent only to the TV on your home network, and forgotten within two minutes. If Deezer asks you to tick a box or enter a code, do that on the TV with the remote.</small>
  <small><b>Signed up with Google, Apple or Facebook?</b> Deezer's page on the TV can't use those. Set a Deezer password first: on deezer.com choose Log in › Forgot your password, enter the email of your Google, Apple or Facebook account, and use the new password here.</small>
</main>
<script>
  const f = document.getElementById("f"), go = document.getElementById("go"), status = document.getElementById("status");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    status.className = "";
    status.textContent = "Sending to the TV…";
    try {
      const res = await fetch("/api/music/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "deezer", email: f.email.value.trim(), password: f.password.value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The Hub said no");
      f.password.value = "";
      status.className = "";
      status.textContent = "Sent. Deezer is opening on the TV…";
      if (data.id) await follow(data.id);
    } catch (err) {
      status.className = "bad";
      status.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });
  // What the TV says happened (it takes up to half a minute).
  const SAYS = {
    "signed-in": ["ok", "Logged in. Deezer is ready on the TV."],
    rejected: ["bad", "Deezer didn't take that email and password."],
    check: ["", "Nearly there: finish on the TV."],
    submitted: ["", "Sent to Deezer. Look at the TV: if it isn't logged in, Deezer may want something on the page."],
    partial: ["bad", "Deezer's page only asked for part of it. Finish on the TV with the remote."],
    "no-form": ["bad", "The TV couldn't find Deezer's login boxes. Log in on the TV with the phone remote's keyboard."],
  };
  async function follow(id) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const s = await fetch("/api/music/login/" + encodeURIComponent(id) + "/status").then((r) => r.json()).catch(() => null);
      if (!s) continue;
      if (s.state === "working") status.textContent = "The TV is logging in to Deezer…";
      if (s.state === "gone") {
        status.className = "bad";
        status.textContent = "The TV didn't pick it up. Is the TV app open? Try again.";
        return;
      }
      if (s.state === "done") {
        const [cls, text] = SAYS[s.result] || ["", s.result];
        status.className = cls;
        status.textContent = text + (s.message ? " Deezer says: “" + s.message + "”" : "");
        return;
      }
    }
    status.textContent = "No answer from the TV yet. Look at the TV.";
  }
</script>
</body>
</html>`;

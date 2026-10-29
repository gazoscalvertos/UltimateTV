// Logging the TV in to Deezer from a phone: the TV can't type, so the Music tab shows a QR code
// for /music-login/, where the phone's keyboard (and password manager) fills in a form. The Hub
// keeps what was typed in memory for two minutes, tells the TV it's there, and hands it over
// once; the box fills in Deezer's own login page with it. Nothing is written to disk or logged.

import { randomUUID } from "node:crypto";

const TTL_MS = 2 * 60_000;

export interface PendingLogin {
  email: string;
  password: string;
}

export class MusicLogins {
  private pending = new Map<string, PendingLogin & { expires: number }>();

  add(login: PendingLogin, now = Date.now()): string {
    for (const [id, p] of this.pending) if (p.expires < now) this.pending.delete(id);
    const id = randomUUID();
    this.pending.set(id, { ...login, expires: now + TTL_MS });
    return id;
  }

  /** Once only: the login is gone after the TV has fetched it. */
  take(id: string, now = Date.now()): PendingLogin | null {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (!p || p.expires < now) return null;
    return { email: p.email, password: p.password };
  }
}

export const MUSIC_LOGIN_PAGE = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070b14">
<script src="/theme.js"></script>
<title>Log in to Deezer on the TV</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg, #070b14); color: var(--fg, #f3f6fb); font: 17px/1.4 Inter, "Noto Sans", Roboto, system-ui, sans-serif; display: grid; place-items: center; padding: 24px 18px; }
  main { width: 100%; max-width: 420px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .brand { display: inline-block; padding: 4px 10px; border-radius: 8px; background: linear-gradient(135deg, #a238ff, #5a1fc2); font-weight: 800; font-size: 14px; letter-spacing: .04em; margin-bottom: 14px; }
  p { color: #9aa6bd; margin: 0 0 22px; }
  label { display: block; font-size: 14px; color: #9aa6bd; margin: 0 0 6px; }
  input { width: 100%; height: 52px; padding: 0 14px; margin: 0 0 16px; border-radius: 12px; border: 1px solid var(--line, rgba(255,255,255,.14)); background: var(--panel, #121b2e); color: inherit; font: inherit; }
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
      status.className = "ok";
      status.textContent = "Sent. Watch the TV: Deezer opens and logs in.";
    } catch (err) {
      status.className = "bad";
      status.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  });
</script>
</body>
</html>`;

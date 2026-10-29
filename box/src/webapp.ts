// Music services that only exist as a website (Deezer): their web player in a view over the TV
// UI, in its own browser profile so the sign-in lasts. Back (or Home) on the remote hides it and
// the music carries on; the Music tab shows what's playing and can pause it. The remote is made
// to work on the page by webapp-preload.ts.

import { session, WebContentsView, type BrowserWindow, type Input, type WebContents } from "electron";
import path from "node:path";
import type { Action, WebAppCommand, WebAppId, WebAppLoginReport, WebAppState } from "@ultimatetv/shared";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Log = (line: string) => void;

const APPS: Record<WebAppId, { url: string; login: string; cookie: string; hosts: RegExp }> = {
  // "arl" is the cookie Deezer keeps you signed in with.
  deezer: { url: "https://www.deezer.com/", login: "https://www.deezer.com/login", cookie: "arl", hosts: /(^|\.)deezer\.com$/ },
};

/**
 * Runs in the page: one step of a login form. Waits for the email and password boxes it hasn't
 * filled yet, fills in those it finds the way typing would (so the site's own scripts see it) and
 * presses the form's button. Answers with what it filled; the next step may be a new page.
 */
function fillStep(email: string, password: string, skip: string[]): Promise<string[]> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const find = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLInputElement>(sel)).find((el) => shown(el) && !el.disabled);
  const type = (el: HTMLInputElement, value: string) => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };
  const submit = (el: HTMLInputElement) => {
    const scope: ParentNode = el.form ?? document;
    const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button[type="submit"],input[type="submit"],button:not([type])')).filter(shown);
    const button = buttons.find((b) => /log ?in|sign ?in|continue|next|connexion|weiter|suivant|anmelden/i.test(b.textContent ?? (b as HTMLInputElement).value ?? "")) ?? buttons[0];
    if (button) button.click();
    else if (el.form) el.form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  };
  const emailBox = () =>
    find('input[type="email"],input[name="email"],input[name="mail"],input[name="login"],input[name="username"],input[autocomplete="username"],input[autocomplete="email"],input[id*="mail" i]') ??
    // A plain text box in the same form as the password, as some sites have.
    (() => {
      const pw = find('input[type="password"]');
      return pw?.form ? find('input[type="text"]', pw.form) : undefined;
    })();
  return (async () => {
    for (let i = 0; i < 20; i++) {
      const em = skip.includes("email") ? undefined : emailBox();
      const pw = skip.includes("password") ? undefined : find('input[type="password"]');
      const filled: string[] = [];
      if (em && !(em.value && em.value.toLowerCase() === email.toLowerCase())) type(em, email);
      if (em) filled.push("email");
      if (pw) {
        type(pw, password);
        filled.push("password");
      }
      if (filled.length) {
        await sleep(500);
        submit(pw ?? em!);
        return filled;
      }
      await sleep(500);
    }
    return [];
  })();
}

/** Runs in the page: says yes to a cookie banner in the way, if there is one. */
function acceptCookies(): boolean {
  const ids = ["onetrust-accept-btn-handler", "didomi-notice-agree-button", "gdpr-btn-accept-all"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.click();
      return true;
    }
  }
  const button = Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) => /^(accept( all)?( cookies)?|agree( and close)?|tout accepter|accepter|alle akzeptieren|ok)$/i.test((b.textContent ?? "").trim()) && b.getBoundingClientRect().width > 0);
  button?.click();
  return Boolean(button);
}

/**
 * Runs in the page after a login was sent: what the page says now, if it says something wrong
 * (an error under the form), or wants more (a puzzle, a tick box, or a code sent by email).
 */
function loginProbe(): { error?: string; check?: string } {
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const puzzle = Array.from(document.querySelectorAll("iframe")).find((f) => shown(f) && /captcha|challenge|arkose|funcaptcha/i.test(`${f.src} ${f.title}`));
  if (puzzle) return { check: "Deezer wants you to prove you're not a robot. Do the puzzle on the TV with the remote." };
  const code = Array.from(document.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"],input[name*="code" i],input[inputmode="numeric"]')).find(shown);
  if (code) return { check: "Deezer sent a code to check it's you. Type it on the TV with the phone remote's keyboard." };
  const error = Array.from(document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error" i],[data-testid*="error" i],[class*="invalid" i]'))
    .filter((el) => shown(el) && text(el).length > 3 && text(el).length < 300)
    .map(text)[0];
  return error ? { error } : {};
}

/** Phone remote keys, as key presses on the page. */
const KEYS: Partial<Record<Action, string>> = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Enter" };

export class WebApps {
  private view: WebContentsView | null = null;
  private id: WebAppId | null = null;
  private shown = false;
  private nowPlaying: WebAppState["nowPlaying"];
  private listeners = new Set<(s: WebAppState) => void>();
  private poll: NodeJS.Timeout | undefined;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly log: Log,
  ) {}

  private signedIn: boolean | undefined;

  state(): WebAppState {
    return { open: this.shown, ...(this.id ? { app: this.id } : {}), ...(this.signedIn !== undefined ? { signedIn: this.signedIn } : {}), ...(this.nowPlaying ? { nowPlaying: this.nowPlaying } : {}) };
  }

  /** Whether the service's sign-in cookie is in its browser profile (looked at without loading the page). */
  async checkSignedIn(id: WebAppId = "deezer"): Promise<void> {
    const cookies = await session.fromPartition(`persist:${id}`).cookies.get({ name: APPS[id].cookie }).catch(() => []);
    const signedIn = cookies.some((c) => c.value && (!c.expirationDate || c.expirationDate * 1000 > Date.now()));
    if (signedIn !== this.signedIn) {
      this.signedIn = signedIn;
      this.emit();
    }
  }

  /**
   * A login typed on the phone: show the page, go to its login form if it isn't there, fill it in
   * (email and password together, or one page after the other), then watch what the site says.
   */
  async login(id: WebAppId, login: { email: string; password: string }): Promise<WebAppLoginReport> {
    await this.open(id);
    const wc = this.view!.webContents;
    const js = <T>(code: string, fallback: T, ms = 15_000): Promise<T> =>
      Promise.race([wc.executeJavaScript(code) as Promise<T>, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]).catch(() => fallback);
    const hasForm = await js(`!!document.querySelector('input[type="password"],input[type="email"]')`, false, 3000);
    if (!hasForm) {
      const loaded = new Promise<void>((resolve) => {
        wc.once("did-finish-load", () => resolve());
        setTimeout(resolve, 15_000);
      });
      void wc.loadURL(APPS[id].login).catch(() => undefined);
      await loaded;
    }
    await js(`(${acceptCookies.toString()})()`, false, 3000);
    const done = new Set<string>();
    for (let step = 0; step < 3 && !done.has("password"); step++) {
      if (step) await sleep(2500);
      const filled = await js<string[]>(`(${fillStep.toString()})(${JSON.stringify(login.email)}, ${JSON.stringify(login.password)}, ${JSON.stringify([...done])})`, []);
      if (!filled.length) {
        // A cookie banner may have come late and covered the form.
        if (await js(`(${acceptCookies.toString()})()`, false, 3000)) continue;
        break;
      }
      for (const f of filled) done.add(f);
    }
    const report = await this.watchLogin(id, done);
    this.log(`${id} login from the phone: ${report.result}${report.message ? ` (${report.message})` : ""}`);
    return report;
  }

  /** After the login was sent: signed in, turned down (with the site's words), or wanting more. */
  private async watchLogin(id: WebAppId, done: Set<string>): Promise<WebAppLoginReport> {
    if (!done.size) return { result: "no-form" };
    if (!done.has("password")) return { result: "partial" };
    const wc = this.view?.webContents;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      await this.checkSignedIn(id);
      if (this.signedIn) return { result: "signed-in" };
      if (i < 2 || !wc || wc.isDestroyed()) continue;
      const probe = (await Promise.race([wc.executeJavaScript(`(${loginProbe.toString()})()`), sleep(3000).then(() => ({}))]).catch(() => ({}))) as { error?: string; check?: string };
      if (probe.check) return { result: "check", message: probe.check };
      if (probe.error) return { result: "rejected", message: probe.error };
    }
    setTimeout(() => void this.checkSignedIn(id), 10_000);
    return { result: "submitted" };
  }

  onState(listener: (s: WebAppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  /** Whether a page may go to this address (the TV UI only goes to the Hub). */
  allows(wc: WebContents, url: string): boolean {
    if (!this.view || wc !== this.view.webContents || !this.id) return false;
    try {
      const u = new URL(url);
      return u.protocol === "https:" && APPS[this.id].hosts.test(u.hostname);
    } catch {
      return false;
    }
  }

  async open(id: WebAppId): Promise<void> {
    const win = this.window();
    if (!win) throw new Error("No TV window");
    if (this.view && this.id !== id) this.unload();
    if (!this.view) this.load(win, id);
    const view = this.view!;
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
    view.setVisible(true);
    view.webContents.setZoomFactor(Math.max(1, width / 1280));
    view.webContents.focus();
    this.shown = true;
    this.emit();
  }

  private load(win: BrowserWindow, id: WebAppId): void {
    const partition = `persist:${id}`;
    const ses = session.fromPartition(partition);
    // An ordinary Chrome, not "Electron": some sites turn unknown browsers away.
    ses.setUserAgent(`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"));
    const view = new WebContentsView({
      webPreferences: { partition, preload: path.join(__dirname, "webapp-preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    });
    view.setBackgroundColor("#121216");
    win.contentView.addChildView(view);
    const wc = view.webContents;
    wc.on("before-input-event", (e, input) => this.onKey(e, input));
    wc.on("did-finish-load", () => wc.setZoomFactor(Math.max(1, win.getContentBounds().width / 1280)));
    wc.on("render-process-gone", (_e, d) => {
      this.log(`${id} page crashed (${d.reason})`);
      this.unload();
      this.emit();
    });
    void wc.loadURL(APPS[id].url).catch((e: Error) => this.log(`${id} didn't load: ${e.message}`));
    this.view = view;
    this.id = id;
    this.log(`Opened ${id}`);
    clearInterval(this.poll);
    this.poll = setInterval(() => {
      void this.readNowPlaying();
      void this.checkSignedIn(id);
    }, 2000);
  }

  private unload(): void {
    clearInterval(this.poll);
    const view = this.view;
    this.view = null;
    this.id = null;
    this.shown = false;
    this.nowPlaying = undefined;
    if (!view) return;
    this.window()?.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  /** Back and Home leave the page; everything else is the page's. */
  private onKey(e: Electron.Event, input: Input): void {
    if (input.type !== "keyDown" || !this.shown) return;
    if (input.key === "Escape" || input.key === "BrowserBack" || input.key === "GoBack" || input.key === "Home" || input.key === "BrowserHome") {
      e.preventDefault();
      void this.close();
    }
  }

  async close(): Promise<void> {
    if (!this.view) return;
    this.view.setVisible(false);
    this.shown = false;
    this.window()?.webContents.focus();
    this.emit();
  }

  async key(action: Action): Promise<void> {
    if (!this.view || !this.shown) return;
    if (action === "back" || action === "home") return this.close();
    if (action === "playPause" || action === "play" || action === "pause") return this.control("playPause");
    if (action === "fastForward") return this.control("next");
    if (action === "rewind") return this.control("prev");
    const keyCode = KEYS[action];
    if (!keyCode) return;
    const wc = this.view.webContents;
    wc.sendInputEvent({ type: "keyDown", keyCode });
    if (keyCode === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r" });
    wc.sendInputEvent({ type: "keyUp", keyCode });
  }

  async text(text: string): Promise<void> {
    if (this.view && this.shown) await this.view.webContents.insertText(text);
  }

  async control(cmd: WebAppCommand): Promise<void> {
    if (!this.view) return;
    await this.view.webContents.executeJavaScript(`window.__utv && window.__utv.control(${JSON.stringify(cmd)})`).catch(() => undefined);
    setTimeout(() => void this.readNowPlaying(), 400);
  }

  private async readNowPlaying(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const np = (await wc.executeJavaScript("window.__utv ? window.__utv.state() : null").catch(() => null)) as WebAppState["nowPlaying"] | null;
    const next = np && typeof np.title === "string" ? np : undefined;
    if (JSON.stringify(next) !== JSON.stringify(this.nowPlaying)) {
      this.nowPlaying = next;
      this.emit();
    }
  }

  stop(): void {
    clearInterval(this.poll);
  }
}

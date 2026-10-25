// Music services that only exist as a website (Deezer): their web player in a view over the TV
// UI, in its own browser profile so the sign-in lasts. Back (or Home) on the remote hides it and
// the music carries on; the Music tab shows what's playing and can pause it. The remote is made
// to work on the page by webapp-preload.ts.

import { session, WebContentsView, type BrowserWindow, type Input, type WebContents } from "electron";
import path from "node:path";
import type { Action, WebAppCommand, WebAppId, WebAppLoginResult, WebAppState } from "@ultimatetv/shared";

type Log = (line: string) => void;

const APPS: Record<WebAppId, { url: string; login: string; cookie: string; hosts: RegExp }> = {
  // "arl" is the cookie Deezer keeps you signed in with.
  deezer: { url: "https://www.deezer.com/", login: "https://www.deezer.com/login", cookie: "arl", hosts: /(^|\.)deezer\.com$/ },
};

/**
 * Runs in the page: fills in the email and password boxes (one step or two, as the page asks)
 * the way typing would, so the site's own scripts see it, and presses the page's submit button.
 */
function fillLogin(email: string, password: string): Promise<WebAppLoginResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const find = (sel: string) => Array.from(document.querySelectorAll<HTMLInputElement>(sel)).find(shown);
  const type = (el: HTMLInputElement, value: string) => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const submit = (el: HTMLInputElement) => {
    const scope: ParentNode = el.form ?? document;
    const button = Array.from(scope.querySelectorAll<HTMLElement>('button[type="submit"],input[type="submit"]')).find(shown);
    if (button) button.click();
    else if (el.form) el.form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  };
  return (async () => {
    const done = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const pw = find('input[type="password"]');
      const em = find('input[type="email"],input[name="email"],input[name="login"],input[autocomplete="username"],input[autocomplete="email"]');
      let typed: HTMLInputElement | undefined;
      if (em && !done.has("email")) {
        type(em, email);
        done.add("email");
        typed = em;
      }
      if (pw && !done.has("password")) {
        type(pw, password);
        done.add("password");
        typed = pw;
      }
      if (typed) {
        await sleep(400);
        submit(typed);
        if (done.has("password")) return "submitted";
      }
      await sleep(500);
    }
    return done.size ? "partial" : "no-form";
  })();
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

  /** A login typed on the phone: show the page, go to its login form if it isn't there, fill it in. */
  async login(id: WebAppId, login: { email: string; password: string }): Promise<WebAppLoginResult> {
    await this.open(id);
    const wc = this.view!.webContents;
    const run = () => wc.executeJavaScript(`(${fillLogin.toString()})(${JSON.stringify(login.email)}, ${JSON.stringify(login.password)})`) as Promise<WebAppLoginResult>;
    const hasForm = await wc.executeJavaScript(`!!document.querySelector('input[type="password"],input[type="email"]')`).catch(() => false);
    if (!hasForm) {
      const loaded = new Promise<void>((resolve) => {
        wc.once("did-finish-load", () => resolve());
        setTimeout(resolve, 15_000);
      });
      void wc.loadURL(APPS[id].login).catch(() => undefined);
      await loaded;
    }
    const result = await run().catch((e: Error) => {
      this.log(`${id} login didn't run: ${e.message}`);
      return "no-form" as const;
    });
    this.log(`${id} login from the phone: ${result}`);
    setTimeout(() => void this.checkSignedIn(id), 6000);
    return result;
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

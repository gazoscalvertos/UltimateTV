// Music services that only exist as a website (Deezer): their web player in a view over the TV
// UI, in its own browser profile so the sign-in lasts. Back (or Home) on the remote hides it and
// the music carries on; the Music tab shows what's playing and can pause it. The remote is made
// to work on the page by webapp-preload.ts.

import { session, WebContentsView, type BrowserWindow, type Input, type WebContents } from "electron";
import path from "node:path";
import type { Action, WebAppCommand, WebAppId, WebAppState } from "@ultimatetv/shared";

type Log = (line: string) => void;

const APPS: Record<WebAppId, { url: string; hosts: RegExp }> = {
  deezer: { url: "https://www.deezer.com/", hosts: /(^|\.)deezer\.com$/ },
};

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

  state(): WebAppState {
    return { open: this.shown, ...(this.id ? { app: this.id } : {}), ...(this.nowPlaying ? { nowPlaying: this.nowPlaying } : {}) };
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
    this.poll = setInterval(() => void this.readNowPlaying(), 2000);
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

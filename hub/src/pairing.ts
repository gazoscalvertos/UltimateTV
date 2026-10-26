// Who may control the TV. A phone pairs by scanning the QR code the TV shows (or typing the code
// under it) and gets a token, kept in a cookie by the phone's browser or sent as X-Device-Token by
// the Android apps. The first screen to ask is trusted (the box, straight after the Hub update);
// any other screen waits until a paired phone or TV lets it in. Scripts such as Home Assistant use
// a separate API key that can only send pop-ups, news flashes and key presses.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { PairedDevice, PairingCode, PendingScreen } from "@ultimatetv/shared";
import type { Db } from "./db.js";

interface StoredDevice extends PairedDevice {
  hash: string;
}

interface Pending extends PendingScreen {
  secretHash: string;
  /** Filled in when it's let in, until the screen collects it. */
  token?: string;
}

/** Without look-alikes (0/O, 1/I/L), so it can be read off the TV and typed. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_MS = 10 * 60_000;
const PENDING_MS = 15 * 60_000;
/** Wrong codes in a row before the code on screen is thrown away. */
const MAX_FAILURES = 8;
/** How often a device's last-seen time is saved; it's only shown as "today" or a date. */
const SEEN_SAVE_MS = 10 * 60_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");
const randomCode = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
/** "abcd efgh", "ABCD-EFGH" and a pasted address with ?pair= in it all mean ABCDEFGH. */
export const cleanCode = (raw: unknown): string => {
  const s = String(raw ?? "");
  const fromUrl = /[?&#]pair=([^&#\s]+)/.exec(s)?.[1];
  return (fromUrl ?? s).toUpperCase().replace(/[^A-Z0-9]/g, "");
};
const cleanName = (raw: unknown, fallback: string) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || fallback;

export class PairingError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class Pairing {
  private code: { code: string; expiresAt: number } | null = null;
  private failures = 0;
  private pending = new Map<string, Pending>();
  private seenSaved = new Map<string, number>();
  /** Last seen times newer than the saved ones. */
  private seen = new Map<string, { at: number; ip?: string }>();

  constructor(
    private readonly db: Db,
    readonly enforced = true,
    private readonly onChange: () => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): StoredDevice[] {
    return this.db.getKv<StoredDevice[]>("paired-devices") ?? [];
  }

  private save(list: StoredDevice[]): void {
    this.db.setKv("paired-devices", list);
  }

  devices(): PairedDevice[] {
    return this.load().map(({ hash: _h, ...d }) => {
      const s = this.seen.get(d.id);
      return s && s.at > d.lastSeenAt ? { ...d, lastSeenAt: s.at, ...(s.ip ? { ip: s.ip } : {}) } : d;
    });
  }

  pendingScreens(): PendingScreen[] {
    this.expire();
    return [...this.pending.values()].filter((p) => !p.token).map(({ secretHash: _s, token: _t, ...p }) => p);
  }

  /** The device a token belongs to, noting when it was last seen. */
  authenticate(token: string | undefined, ip?: string): PairedDevice | undefined {
    if (!token) return undefined;
    const h = hash(token);
    const list = this.load();
    const found = list.find((d) => safeEqual(d.hash, h));
    if (!found) return undefined;
    const now = this.now();
    found.lastSeenAt = now;
    if (ip) found.ip = ip;
    this.seen.set(found.id, { at: now, ...(ip ? { ip } : {}) });
    if (now - (this.seenSaved.get(found.id) ?? 0) > SEEN_SAVE_MS) {
      this.seenSaved.set(found.id, now);
      this.save(list);
    }
    const { hash: _h, ...device } = found;
    return device;
  }

  private add(name: string, kind: PairedDevice["kind"], ip?: string): { token: string; device: PairedDevice } {
    const token = newToken();
    const now = this.now();
    const device: PairedDevice = { id: randomBytes(6).toString("hex"), name, kind, pairedAt: now, lastSeenAt: now, ...(ip ? { ip } : {}) };
    this.save([...this.load(), { ...device, hash: hash(token) }]);
    this.onChange();
    return { token, device };
  }

  /** The code the TV shows; the same one until it runs out or is used. */
  currentCode(baseUrl: string): PairingCode {
    const now = this.now();
    if (!this.code || this.code.expiresAt - now < 60_000) {
      this.code = { code: randomCode(8), expiresAt: now + CODE_MS };
      this.failures = 0;
    }
    return { code: this.code.code, url: `${baseUrl}/remote/?pair=${this.code.code}`, expiresAt: this.code.expiresAt };
  }

  /** A phone pairs with the code from the TV. The code works once. */
  pair(rawCode: unknown, rawName: unknown, ip?: string): { token: string; device: PairedDevice } {
    const code = cleanCode(rawCode);
    const live = this.code && this.code.expiresAt > this.now() ? this.code : null;
    if (!live || code.length !== live.code.length || !safeEqual(code, live.code)) {
      if (live && ++this.failures >= MAX_FAILURES) {
        // Someone may be guessing: the TV gets a fresh code.
        this.code = null;
        this.onChange();
      }
      throw new PairingError(live ? "That code doesn't match the one on the TV. Check it and try again." : "That code has run out. Open Settings › Phones and remotes on the TV for a new one.", 403);
    }
    this.code = null;
    return this.add(cleanName(rawName, "Phone"), "phone", ip);
  }

  /**
   * A screen running the TV app asks to join. The first one is let in at once; later ones wait
   * for a paired device to let them in and collect their token with `collect`.
   */
  requestScreen(rawName: unknown, ip?: string): { token: string; device: PairedDevice } | { pending: PendingScreen; secret: string } {
    const name = cleanName(rawName, "TV");
    if (!this.load().some((d) => d.kind === "tv")) return this.add(name, "tv", ip);
    this.expire();
    const secret = newToken();
    const pending: Pending = { id: randomBytes(6).toString("hex"), name, code: randomCode(4), at: this.now(), secretHash: hash(secret), ...(ip ? { ip } : {}) };
    // One wait per address: a screen that reloads replaces its own request.
    for (const [id, p] of this.pending) if (ip && p.ip === ip && !p.token) this.pending.delete(id);
    this.pending.set(pending.id, pending);
    while (this.pending.size > 10) this.pending.delete(this.pending.keys().next().value as string);
    this.onChange();
    const { secretHash: _s, ...shown } = pending;
    return { pending: shown, secret };
  }

  /** The waiting screen asks whether it has been let in. */
  collect(id: string, secret: unknown): { token: string; device: PairedDevice } | "waiting" | "gone" {
    this.expire();
    const p = this.pending.get(id);
    if (!p || !safeEqual(p.secretHash, hash(String(secret ?? "")))) return "gone";
    if (!p.token) return "waiting";
    this.pending.delete(id);
    const device = this.authenticate(p.token);
    return device ? { token: p.token, device } : "gone";
  }

  approve(id: string): PairedDevice | undefined {
    this.expire();
    const p = this.pending.get(id);
    if (!p || p.token) return undefined;
    const { token, device } = this.add(p.name, "tv", p.ip);
    p.token = token;
    return device;
  }

  deny(id: string): boolean {
    const had = this.pending.delete(id);
    if (had) this.onChange();
    return had;
  }

  revoke(id: string): boolean {
    const list = this.load();
    const kept = list.filter((d) => d.id !== id);
    if (kept.length === list.length) return false;
    this.save(kept);
    this.onChange();
    return true;
  }

  rename(id: string, rawName: unknown): PairedDevice | undefined {
    const list = this.load();
    const d = list.find((x) => x.id === id);
    if (!d) return undefined;
    d.name = cleanName(rawName, d.name);
    this.save(list);
    this.onChange();
    const { hash: _h, ...device } = d;
    return device;
  }

  /** The key for scripts and Home Assistant, made the first time it's asked for. */
  apiKey(): string {
    const key = this.db.getKv<string>("api-key");
    if (key) return key;
    return this.newApiKey();
  }

  newApiKey(): string {
    const key = `utv_${randomBytes(24).toString("base64url")}`;
    this.db.setKv("api-key", key);
    return key;
  }

  checkApiKey(key: string | undefined): boolean {
    const real = this.db.getKv<string>("api-key");
    return Boolean(key && real && key.length === real.length && safeEqual(key, real));
  }

  /** Forgets every device and the API key (tools: reset-pairing). */
  reset(): void {
    this.save([]);
    this.db.setKv("api-key", "");
    this.pending.clear();
    this.code = null;
  }

  private expire(): void {
    const cutoff = this.now() - PENDING_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

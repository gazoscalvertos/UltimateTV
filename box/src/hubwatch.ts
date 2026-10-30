// Keeps an eye on the Hub. The TV app comes from the Hub, so when the Hub is down (the server is
// rebooting, the Docker LXC stopped, the box is away from home) the box shows its own screen instead
// (box/offline): the time, what's wrong, and what still works without the Hub (downloads on the box,
// games, AirPlay). It goes back to the TV app as soon as the Hub answers again.
//
// While the TV app shows, the Hub is asked every 20 seconds; after three misses in a row (a minute),
// and only while nothing is playing, the box switches to its own screen. While that shows, it asks
// every 5 seconds, and goes back once nothing is playing.

export type HubMode = "app" | "offline";

export interface HubWatchOptions {
  /** True when the Hub answers. */
  probe: () => Promise<boolean>;
  /** Show the box's own screen. */
  showOffline: (reason: string) => void;
  /** Show the TV app again. */
  showApp: () => void;
  /** Something is playing (or a game or AirPlay has the screen): don't pull the rug. */
  busy: () => boolean;
  log: (line: string) => void;
  missesBeforeOffline?: number;
  now?: () => number;
}

export class HubWatch {
  mode: HubMode = "app";
  private misses = 0;
  private downSince: number | undefined;
  private timer: NodeJS.Timeout | undefined;
  private checking = false;

  constructor(private readonly o: HubWatchOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** When the Hub stopped answering, while it isn't. */
  get since(): number | undefined {
    return this.downSince;
  }

  /** The box has put its own screen up (the TV app didn't load). */
  wentOffline(): void {
    this.mode = "offline";
    this.downSince ??= this.now();
    this.schedule();
  }

  /** The TV app is showing. */
  wentToApp(): void {
    this.mode = "app";
    this.misses = 0;
    this.downSince = undefined;
    this.schedule();
  }

  start(): void {
    this.schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check().finally(() => this.schedule()), this.mode === "offline" ? 5_000 : 20_000);
    this.timer.unref?.();
  }

  /** Asks the Hub once and acts on the answer. */
  async check(): Promise<boolean> {
    if (this.checking) return this.misses === 0;
    this.checking = true;
    try {
      const up = await this.o.probe().catch(() => false);
      if (up) {
        this.misses = 0;
        // A download playing from the box's screen carries on; the TV app comes back after it.
        if (this.mode === "offline" && !this.o.busy()) {
          this.o.log("The Hub is back: showing the TV app");
          this.o.showApp();
          this.wentToApp();
        }
        this.downSince = undefined;
        return true;
      }
      this.misses++;
      this.downSince ??= this.now();
      if (this.mode === "app" && this.misses >= (this.o.missesBeforeOffline ?? 3) && !this.o.busy()) {
        this.o.log(`The Hub hasn't answered ${this.misses} times: showing the box's own screen`);
        this.mode = "offline";
        this.o.showOffline("The Hub stopped answering");
      }
      return false;
    } finally {
      this.checking = false;
    }
  }
}

/** Asks the Hub's /api/health, giving up after a few seconds. */
export async function hubAnswers(hubUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetchImpl(`${hubUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

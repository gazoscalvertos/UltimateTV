// Looking at the TV app itself, not just at the Hub.
//
// The TV app comes from the Hub, so a Hub that answers is not the same as a TV app that works. On
// 2 November the app threw while it was loading and drew nothing at all, while `/api/health`
// answered fine the whole time. Nothing noticed: the Hub was up, so `HubWatch` never stepped in, the
// window just sat there black, and nothing on the box or in the Hub's logs showed a fault. The TV
// stayed black until things were restarted by hand.
//
// So after each page load the box waits a few seconds and looks at whether the page drew anything.
//
// - Drawing: all good, and the count of failures starts again.
// - Blank: load it again without the cached copy, in case the Hub has since shipped a fix. A few
//   blank loads in a row, and the box shows its own screen — which says what happened and can be
//   worked with the remote, rather than a black screen nothing can get out of.
// - Given up: the box's own screen stays up, and the app is tried again every few minutes, so a Hub
//   fixed later puts the TV right without anyone touching the box.

export interface UiCheckOptions {
  /** True when the page has drawn something: it has children under the app's root element. */
  drawn: () => Promise<boolean>;
  /** Load the TV app again, without taking the cached copy. */
  reload: () => Promise<void>;
  /** Something is playing, or a game or a screen share has the TV: don't pull the rug. */
  busy: () => boolean;
  /** Show the box's own screen, with the reason. */
  showOffline: (reason: string) => void;
  log: (line: string) => void;
  /** How long a page gets to draw before it counts as blank. */
  waitMs?: number;
  /** How many blank loads in a row before the box gives up on the TV app. */
  tries?: number;
  /** How long to wait before looking again, or trying the app again once the box has given up. */
  retryMs?: number;
}

/** What one look did, so a test can step through it without waiting on timers. */
export type UiCheckResult = "drawn" | "reload" | "offline" | "busy" | "waiting";

export class UiCheck {
  private timer: NodeJS.Timeout | undefined;
  private blanks = 0;
  private givenUp = false;
  private running = false;

  constructor(private readonly o: UiCheckOptions) {}

  /** For the tests and the logs: how many blank loads in a row, and whether the box gave up. */
  get state(): { blanks: number; givenUp: boolean } {
    return { blanks: this.blanks, givenUp: this.givenUp };
  }

  /** A Hub page has loaded: give it a moment to draw, then look. The count carries over. */
  start(): void {
    this.schedule(this.o.waitMs ?? 8_000);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => void this.check(), ms);
    this.timer.unref?.();
  }

  async check(): Promise<UiCheckResult> {
    if (this.running) return "waiting";
    this.running = true;
    try {
      if (this.o.busy()) {
        // Something is on screen that the household chose: leave it, and look again later.
        this.schedule(this.o.retryMs ?? 300_000);
        return "busy";
      }
      if (await this.o.drawn().catch(() => false)) {
        this.blanks = 0;
        this.givenUp = false;
        return "drawn";
      }
      const tries = this.o.tries ?? 3;
      if (this.givenUp) {
        // The box's own screen is up: try the app again in a while, in case the Hub was fixed.
        this.o.log("Trying the TV app again after it drew nothing");
        await this.o.reload().catch((e: Error) => this.o.log(`Couldn't reload the TV app: ${e.message}`));
        this.schedule(this.o.waitMs ?? 8_000);
        return "reload";
      }
      this.blanks++;
      if (this.blanks < tries) {
        this.o.log(`The TV app drew nothing; loading it again (${this.blanks} of ${tries})`);
        await this.o.reload().catch((e: Error) => this.o.log(`Couldn't reload the TV app: ${e.message}`));
        // The reload's own did-finish-load starts the next look; this covers the case where it hasn't.
        this.schedule(this.o.waitMs ?? 8_000);
        return "reload";
      }
      this.givenUp = true;
      this.o.log(`The TV app was blank ${this.blanks} times in a row: showing the box's own screen`);
      this.o.showOffline("The TV app didn't draw anything: the Hub may have sent it a broken app");
      this.schedule(this.o.retryMs ?? 300_000);
      return "offline";
    } finally {
      this.running = false;
    }
  }
}

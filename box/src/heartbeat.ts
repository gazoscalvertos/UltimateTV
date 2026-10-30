// The app's heartbeat for the check after an update (tools/box/healthcheck.sh): once a page has
// loaded and every 30 seconds after, a small key=value file says the app is up and whether it
// reaches the Hub. The check, running as root, reads it without running it.

import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const HEARTBEAT_FILE = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local/state"), "ultimatetv-health");

/** The file's text: `at` in whole seconds, like the update's `done`. */
export function heartbeatText(beat: { at: number; page: "app" | "offline"; hub: boolean; version: string }): string {
  return `at=${Math.floor(beat.at / 1000)}\npage=${beat.page}\nhub=${beat.hub ? 1 : 0}\nversion=${beat.version}\n`;
}

export class Heartbeat {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly read: () => Promise<{ page: "app" | "offline"; hub: boolean }>,
    private readonly version: string,
    private readonly log: (line: string) => void,
    private readonly file = HEARTBEAT_FILE,
  ) {}

  /** Called when a page has loaded: the first beat, then one every 30 seconds. */
  start(): void {
    if (this.timer) return;
    void this.beat();
    this.timer = setInterval(() => void this.beat(), 30_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async beat(): Promise<void> {
    try {
      const now = await this.read();
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, heartbeatText({ at: Date.now(), ...now, version: this.version }));
      await rename(`${this.file}.tmp`, this.file);
    } catch (e) {
      this.log(`Couldn't write the heartbeat: ${(e as Error).message}`);
    }
  }
}

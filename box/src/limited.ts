/**
 * The box's copy of what Limited mode needs (#78).
 *
 * While the Hub is up the box keeps one small JSON file of the channel list (with playable URLs),
 * a week of guide, the profiles with their Kids rules, and the Jellyfin connection. When the Hub
 * is down that file is the whole app: the Limited-mode page reads it through the agent bridge.
 *
 * The file is written to a temporary name and renamed over the old one, so a box that loses power
 * mid-write still has a usable cache. Reading is forgiving by design: a missing, truncated or
 * hand-edited file means Limited mode shows what it can, never that the box fails to start.
 */
import { limitedView, parseLimitedSnapshot, type LimitedSnapshot, type LimitedView } from "@ultimatetv/shared";

/** How often the box refreshes the cache while the Hub is up: often enough for a guide change, rare enough to be quiet. */
export const LIMITED_REFRESH_MS = 15 * 60_000;

export interface LimitedCacheOptions {
  /** Where the snapshot lives: under the box's userData directory. */
  file: string;
  /** Asks the Hub for a fresh snapshot. Throws when the Hub cannot be reached. */
  fetchSnapshot: () => Promise<unknown>;
  readFile: (file: string) => string;
  writeFile: (file: string, text: string) => void;
  rename: (from: string, to: string) => void;
  now?: () => number;
  log?: (line: string) => void;
}

/** Whether the cache is old enough to refresh again. */
export function refreshDue(lastAt: number | null, now: number, everyMs: number = LIMITED_REFRESH_MS): boolean {
  return lastAt === null || now - lastAt >= everyMs;
}

export class LimitedCache {
  private current: LimitedSnapshot | null = null;
  private read = false;
  private lastWritten = "";
  private lastOk: number | null = null;
  private refreshing: Promise<LimitedSnapshot | null> | null = null;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: LimitedCacheOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  /** When the cache last came from the Hub, or null if it never has. */
  get refreshedAt(): number | null {
    return this.lastOk;
  }

  /** The snapshot in memory, reading the file the first time only. Never throws. */
  snapshot(): LimitedSnapshot | null {
    if (!this.read) {
      this.read = true;
      let text = "";
      try {
        text = this.options.readFile(this.options.file);
      } catch {
        text = "";
      }
      if (text) {
        this.current = parseLimitedSnapshot(text, this.now());
        if (this.current) this.lastWritten = JSON.stringify(this.current);
        else this.log("The box's copy of the TV guide is unreadable: Limited mode will start empty");
      }
    }
    return this.current;
  }

  /** Same as `snapshot`, under the name the page-facing code uses. */
  load(): LimitedSnapshot | null {
    return this.snapshot();
  }

  /** What the Limited-mode screen should show for the profile on the TV. */
  view(viewer: { name: string; kids: boolean } | null): LimitedView {
    return limitedView(this.snapshot(), viewer, this.now());
  }

  /**
   * Fetches a fresh snapshot from the Hub and saves it. Resolves null and changes nothing when the
   * Hub cannot be reached or answers with something that is not a snapshot, so a blip never wipes
   * a working cache. Never runs two fetches at once.
   */
  refresh(): Promise<LimitedSnapshot | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.fetchAndSave().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchAndSave(): Promise<LimitedSnapshot | null> {
    let raw: unknown;
    try {
      raw = await this.options.fetchSnapshot();
    } catch (e) {
      this.log(`Couldn't refresh the box's copy of the guide: ${(e as Error).message}`);
      return null;
    }
    const next = parseLimitedSnapshot(raw, this.now());
    if (!next) return null;
    this.current = next;
    this.read = true;
    this.lastOk = this.now();
    const text = JSON.stringify(next);
    if (text === this.lastWritten) return next;
    const temp = `${this.options.file}.tmp`;
    try {
      this.options.writeFile(temp, text);
      this.options.rename(temp, this.options.file);
      this.lastWritten = text;
    } catch (e) {
      this.log(`Couldn't save the box's copy of the guide: ${(e as Error).message}`);
    }
    return next;
  }
}

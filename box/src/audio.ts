// Sound goes to the TV. WirePlumber ranks a PC's analog output above HDMI, so on a box with a
// headphone socket it picks analog (even with nothing plugged in) and the TV stays silent. This
// switches the sound card to the stereo HDMI profile of whichever HDMI output is connected; Dolby
// and DTS still reach the TV untouched through it (mpv's --audio-spdif).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

interface PactlCard {
  name: string;
  active_profile?: string;
  profiles?: Record<string, { available?: boolean; priority?: number }>;
  ports?: Record<string, { availability?: string; profiles?: string[]; type?: string; direction?: string }>;
}

/**
 * The profile a card should switch to so its sound reaches a connected HDMI output, or null when
 * it's already there or has no connected HDMI output. Prefers output only, stereo profiles.
 */
export function hdmiProfile(card: PactlCard): string | null {
  const connected = Object.entries(card.ports ?? {}).filter(([name, p]) => /^hdmi-output/.test(name) && p.availability === "available");
  if (!connected.length) return null;
  const covers = (profile: string) => connected.some(([, p]) => p.profiles?.includes(profile));
  if (card.active_profile && covers(card.active_profile)) return null;
  const candidates = connected
    .flatMap(([, p]) => p.profiles ?? [])
    .filter((name) => /^output:hdmi-/.test(name) && card.profiles?.[name]?.available !== false);
  const rank = (name: string) => (name.includes("+input") ? 100 : 0) + (/^output:hdmi-stereo(-extra\d+)?$/.test(name) ? 0 : 10);
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0] ?? null;
}

export class Audio {
  constructor(private readonly log: (line: string) => void) {}

  /**
   * Full volume on the box's output: the TV's remote sets the volume. (The HDMI output took over
   * the analog output's 40%, which left everything quiet.)
   */
  async fullVolume(): Promise<void> {
    await run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", "1.0"], { timeout: 5000 }).catch((e: Error) => this.log(`Couldn't set the volume: ${e.message}`));
  }

  /** Moves the sound to the connected HDMI output if it isn't there. Safe to call before every play. */
  async useHdmi(): Promise<void> {
    const cards = await run("pactl", ["-f", "json", "list", "cards"], { timeout: 5000 })
      .then((r) => JSON.parse(r.stdout) as PactlCard[])
      .catch((e: Error) => (this.log(`Couldn't list sound cards: ${e.message}`), [] as PactlCard[]));
    for (const card of cards) {
      const profile = hdmiProfile(card);
      if (!profile) continue;
      this.log(`Sound: switching ${card.name} from ${card.active_profile ?? "?"} to ${profile}`);
      await run("pactl", ["set-card-profile", card.name, profile], { timeout: 5000 }).catch((e: Error) => this.log(`Couldn't switch the sound to HDMI: ${e.message}`));
      await this.fullVolume();
    }
  }
}

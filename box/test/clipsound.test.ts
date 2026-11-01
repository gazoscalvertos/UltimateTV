import { describe, expect, it } from "vitest";
import type { Display } from "../src/display.js";
import type { Mpv } from "../src/mpv.js";
import { Player } from "../src/player.js";

/** Just enough of mpv to see which properties get set. */
function fakeMpv() {
  const sets: [string, unknown][] = [];
  const mpv = { set: async (name: string, value: unknown) => void sets.push([name, value]), on: () => mpv } as unknown as Mpv;
  return { mpv, spdif: () => sets.filter(([n]) => n === "audio-spdif").map(([, v]) => v) };
}

describe("a clip's sound over a film", () => {
  it("decodes Dolby and DTS while a clip's sound plays, then passes them through again", async () => {
    const { mpv, spdif } = fakeMpv();
    const player = new Player(mpv, {} as Display, () => ({ width: 1920, height: 1080 }), () => undefined);
    await player.setClipSound(true);
    await player.setClipSound(false);
    expect(spdif()).toEqual(["", "ac3,eac3,dts"]);
  });

  it("leaves the sound decoded afterwards when night mode wants it", async () => {
    const { mpv, spdif } = fakeMpv();
    const player = new Player(mpv, {} as Display, () => ({ width: 1920, height: 1080 }), () => undefined);
    await player.setNightMode(true);
    await player.setClipSound(true);
    await player.setClipSound(false);
    expect(spdif()).toEqual(["", "", ""]);
  });

  it("does nothing on a desktop, where the sound is always decoded", async () => {
    const { mpv, spdif } = fakeMpv();
    const player = new Player(mpv, {} as Display, () => ({ width: 1920, height: 1080 }), () => undefined, true);
    await player.setClipSound(true);
    expect(spdif()).toEqual([]);
  });
});

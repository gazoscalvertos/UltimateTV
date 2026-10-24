import { describe, expect, it } from "vitest";
import { CecParser, powerFrom, type CecMessage } from "../src/cec.js";
import { parseOutputs, pickMode, type Mode } from "../src/display.js";
import { mpvArgs } from "../src/mpv.js";
import { isHdr, marginsFor, tracksFrom } from "../src/player.js";

const mode = (id: string, refreshRate: number, width = 3840, height = 2160): Mode => ({ id, width, height, refreshRate });
const modes = [mode("1", 60), mode("2", 59.94), mode("3", 50), mode("4", 30), mode("5", 25), mode("6", 24), mode("7", 23.976), mode("8", 60, 1920, 1080)];

describe("refresh rate matching", () => {
  it("plays film at 24p and 23.976p exactly", () => {
    expect(pickMode(modes, modes[0]!, 23.976)?.id).toBe("7");
    expect(pickMode(modes, modes[0]!, 24)?.id).toBe("6");
  });

  it("plays TV-rate video at 50 or 59.94", () => {
    expect(pickMode(modes, modes[0]!, 25)?.id).toBe("3");
    expect(pickMode(modes, modes[0]!, 50)?.id).toBe("3");
    expect(pickMode(modes, modes[0]!, 29.97)?.id).toBe("2");
    expect(pickMode(modes, modes[0]!, 60)?.id).toBe("1");
  });

  it("stays at the current resolution and gives up when nothing fits", () => {
    expect(pickMode(modes, modes[7]!, 24)).toBeNull();
    expect(pickMode([mode("1", 60)], mode("1", 60), 23.976)).toBeNull();
  });

  it("reads kscreen-doctor's JSON", () => {
    const outputs = parseOutputs(
      JSON.stringify({
        outputs: [
          { id: 1, name: "HDMI-A-1", enabled: true, connected: true, currentModeId: "2", hdr: false, capabilities: ["HighDynamicRange", "WideColorGamut"], modes: [{ id: "2", name: "3840x2160@60", refreshRate: 60, size: { width: 3840, height: 2160 } }] },
          { id: 2, name: "DP-1", enabled: false, connected: false, modes: [] },
        ],
      }),
    );
    expect(outputs[0]).toMatchObject({ name: "HDMI-A-1", enabled: true, currentModeId: "2", hdr: false, hdrCapable: true });
    expect(outputs[0]!.modes[0]).toEqual({ id: "2", width: 3840, height: 2160, refreshRate: 60 });
    expect(outputs[1]!.connected).toBe(false);
  });
});

describe("CEC", () => {
  const parse = (text: string): CecMessage[] => {
    const p = new CecParser();
    const out = text.split("\n").map((l) => p.line(l));
    return [...out, p.flush()].filter((m): m is CecMessage => m !== null);
  };

  it("parses cec-ctl --monitor output", () => {
    const msgs = parse(`Received from TV to all (0 to 15): STANDBY (0x36)
Received from TV to Playback Device 1 (0 to 4): SET_STREAM_PATH (0x86):
	phys-addr: 1.0.0.0
Received from TV to all (0 to 15): ACTIVE_SOURCE (0x82):
	phys-addr: 2.0.0.0`);
    expect(msgs).toEqual([
      { opcode: "STANDBY", from: "TV" },
      { opcode: "SET_STREAM_PATH", from: "TV", physAddr: "1.0.0.0" },
      { opcode: "ACTIVE_SOURCE", from: "TV", physAddr: "2.0.0.0" },
    ]);
  });

  it("knows when the TV is showing the box", () => {
    expect(powerFrom({ opcode: "STANDBY", from: "TV" }, "1.0.0.0")).toBe(false);
    expect(powerFrom({ opcode: "SET_STREAM_PATH", from: "TV", physAddr: "1.0.0.0" }, "1.0.0.0")).toBe(true);
    expect(powerFrom({ opcode: "ACTIVE_SOURCE", from: "TV", physAddr: "2.0.0.0" }, "1.0.0.0")).toBe(false);
    expect(powerFrom({ opcode: "GIVE_OSD_NAME", from: "TV" }, "1.0.0.0")).toBeNull();
  });
});

describe("mpv", () => {
  it("passes Dolby and DTS through and keeps a live buffer", () => {
    const args = mpvArgs({ socket: "/run/mpv.sock", audioDevice: "pipewire/hdmi", extraArgs: ["--fs-screen=1"] });
    expect(args).toContain("--input-ipc-server=/run/mpv.sock");
    expect(args).toContain("--audio-spdif=ac3,eac3,dts");
    expect(args).toContain("--audio-device=pipewire/hdmi");
    expect(args.at(-1)).toBe("--fs-screen=1");
  });

  it("turns the track list into audio and subtitle choices", () => {
    const { audio, subs } = tracksFrom([
      { id: 1, type: "video" },
      { id: 1, type: "audio", lang: "eng", codec: "eac3", "demux-channel-count": 6, selected: true },
      { id: 2, type: "audio", lang: "spa", title: "Commentary" },
      { id: 1, type: "sub", lang: "eng", external: true },
    ]);
    expect(audio).toEqual([
      { id: 1, lang: "eng", codec: "eac3", channels: 6, selected: true },
      { id: 2, lang: "spa", title: "Commentary", selected: false },
    ]);
    expect(subs).toEqual([{ id: 1, lang: "eng", external: true, selected: false }]);
  });

  it("puts the video in the guide's preview window", () => {
    expect(marginsFor({ mode: "fullscreen" }, { width: 1920, height: 1080 })).toEqual([0, 0, 0, 0]);
    expect(marginsFor({ mode: "window", x: 96, y: 108, width: 480, height: 270 }, { width: 1920, height: 1080 })).toEqual([0.05, 0.7, 0.1, 0.65]);
  });

  it("spots HDR", () => {
    expect(isHdr({ gamma: "pq" })).toBe(true);
    expect(isHdr({ gamma: "hlg" })).toBe(true);
    expect(isHdr({ gamma: "bt.1886" })).toBe(false);
    expect(isHdr(null)).toBe(false);
  });
});

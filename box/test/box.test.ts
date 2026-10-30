import { describe, expect, it } from "vitest";
import { hdmiProfile } from "../src/audio.js";
import { CecParser, powerFrom, type CecMessage } from "../src/cec.js";
import { parseOutputText, parseOutputs, pickMode, type Mode } from "../src/display.js";
import { mpvArgs } from "../src/mpv.js";
import { redact, Ring, summariseKscreen } from "../src/diagnostics.js";
import { isHdr, marginsFor, sampleFrom, statsFrom, tracksFrom } from "../src/player.js";
import { parseKeyValues, remoteCommit } from "../src/updates.js";

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

  it("marks the audio description track, by mpv's flag or its name", () => {
    const { audio } = tracksFrom([
      { id: 1, type: "audio", lang: "eng", selected: true },
      { id: 2, type: "audio", lang: "eng", "visual-impaired": true },
      { id: 3, type: "audio", lang: "eng", title: "English (Audio Description)" },
    ]);
    expect(audio.map((a) => a.audioDescription ?? false)).toEqual([false, true, true]);
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

describe("playback stats", () => {
  const props = {
    "video-codec": "hevc (H.265 / HEVC)",
    "video-params": { w: 3840, h: 2160, pixelformat: "p010", "hw-pixelformat": "vaapi", gamma: "pq", primaries: "bt.2020", colormatrix: "bt.2020-ncl" },
    "hwdec-current": "vaapi",
    "container-fps": 23.976,
    "video-sync": "display-resample",
    "display-fps": 23.976,
    "frame-drop-count": 2,
    "audio-codec": "eac3 (E-AC-3)",
    "audio-params": { samplerate: 48000, "channel-count": 6, "hr-channels": "5.1" },
    "audio-out-params": { format: "spdif-eac3", "channel-count": 8 },
    "demuxer-cache-state": { "cache-duration": 12.34, "fw-bytes": 52428800, "raw-input-rate": 5_000_000 },
    af: [],
  };
  const stats = statsFrom(props, { url: "http://user:secret@iptv.example:8080/movie/user/secret/1.mkv", display: { width: 3840, height: 2160, refreshHz: 23.976, hdr: true } });
  const value = (section: string, label: string) => stats.sections.find((s) => s.title === section)?.rows.find((r) => r[0] === label)?.[1];

  it("describes the picture, sound and network", () => {
    expect(value("Video", "Resolution")).toBe("3840×2160 · vaapi/p010");
    expect(value("Video", "Colour")).toBe("HDR10 (PQ) · bt.2020 · bt.2020-ncl");
    expect(value("Video", "Decoder")).toBe("GPU (vaapi)");
    expect(value("Display", "TV mode")).toBe("3840×2160 @ 23.976 Hz · HDR on");
    expect(value("Display", "Dropped frames")).toBe("2 by the display · 0 by the decoder");
    expect(value("Audio", "Output")).toBe("Passthrough to the TV (eac3)");
    expect(value("Audio", "Night mode")).toBeUndefined();
    expect(value("Network", "Download speed")).toBe("40.0 Mbit/s");
  });

  it("never shows the account details in a stream address", () => {
    expect(value("Network", "Source")).toBe("iptv.example:8080");
    expect(JSON.stringify(stats)).not.toContain("secret");
  });
});

describe("box updates", () => {
  it("reads the installed version and the newest commit on its branch", () => {
    expect(parseKeyValues("commit=abc123\ndate=2026-10-24T19:00:00+01:00\nbranch=main\nrepo=https://github.com/x/y.git\n")).toEqual({ commit: "abc123", date: "2026-10-24T19:00:00+01:00", branch: "main", repo: "https://github.com/x/y.git" });
    expect(remoteCommit("def456\trefs/heads/main\n999\trefs/heads/mainline\n", "main")).toBe("def456");
    expect(remoteCommit("", "main")).toBeUndefined();
  });
});

describe("variable refresh", () => {
  it("knows which screens have variable refresh, from names or libkscreen flags", () => {
    const [named] = parseOutputs(JSON.stringify({ outputs: [{ name: "HDMI-A-1", enabled: true, connected: true, currentModeId: "1", modes: [], capabilities: ["Vrr", "HighDynamicRange"], vrrPolicy: 2 }] }));
    expect(named).toMatchObject({ vrrCapable: true, hdrCapable: true, vrrPolicy: "automatic" });
    const [flags] = parseOutputs(JSON.stringify({ outputs: [{ name: "HDMI-A-1", enabled: true, connected: true, currentModeId: "1", modes: [], capabilities: 0x2, vrrPolicy: "Never" }] }));
    expect(flags).toMatchObject({ vrrCapable: true, hdrCapable: false, vrrPolicy: "never" });
  });

  it("has no 24p mode on a 50/60/100 Hz monitor, so the box falls back to variable refresh", () => {
    const monitor = [mode("a", 100, 3440, 1440), mode("b", 60, 3440, 1440), mode("c", 50, 3440, 1440)];
    expect(pickMode(monitor, monitor[0]!, 23.976)).toBeNull();
    expect(pickMode(monitor, monitor[0]!, 25)?.id).toBe("c");
  });
});

describe("diagnostics", () => {
  it("cuts addresses to their host, dropping IPTV logins and API keys", () => {
    expect(redact("Playing http://user:pw@iptv.example:8080/live/user/pw/123.ts now")).toBe("Playing http://iptv.example:8080/… now");
    expect(redact("GET http://192.168.0.23:8096/Videos/1/stream?api_key=secret")).toBe("GET http://192.168.0.23:8096/…");
  });

  it("keeps only the newest entries", () => {
    const ring = new Ring<number>(3);
    for (let i = 1; i <= 5; i++) ring.push(i);
    expect(ring.list()).toEqual([3, 4, 5]);
  });

  it("cuts kscreen-doctor's mode lists to their refresh rates", () => {
    const json = JSON.stringify({ outputs: [{ name: "HDMI-A-1", capabilities: 0, modes: [{ id: "1", size: { width: 3440, height: 1440 }, refreshRate: 99.982 }] }] });
    expect(summariseKscreen(json)).toEqual({ outputs: [{ name: "HDMI-A-1", capabilities: 0, modes: ["1: 3440×1440@99.982"] }] });
  });

  it("samples playback compactly, with the stream's host only", () => {
    const s = sampleFrom(
      { "video-params": { w: 1920, h: 1040, gamma: "bt.1886" }, "container-fps": 23.976, "hwdec-current": "vaapi", "video-sync": "audio", "display-fps": 99.982, "frame-drop-count": 3, "decoder-frame-drop-count": 0, "vo-delayed-frame-count": 4, "mistimed-frame-count": 0, avsync: 0.008, "demuxer-cache-state": { "cache-duration": 60.1, "raw-input-rate": 275000 } },
      { url: "http://192.168.0.23:8096/Videos/1/stream?api_key=x", status: "playing", positionS: 61.4, match: null, display: { width: 3440, height: 1440, refreshHz: 99.982 } },
    );
    expect(s).toMatchObject({ source: "192.168.0.23:8096", status: "playing", positionS: 61, match: null, video: { width: 1920, height: 1040, fps: 23.976, hwdec: "vaapi" }, display: { mode: "3440×1440@99.982", sync: "audio" }, frames: { dropped: 3, decoderDropped: 0, delayed: 4, mistimed: 0 }, avsyncMs: 8, bufferS: 60.1, inputKbps: 2200 });
  });

  it("says in the overlay when nothing could match the screen to the film", () => {
    const stats = statsFrom({ "video-sync": "audio" }, { match: null });
    const display = stats.sections.find((x) => x.title === "Display")!;
    expect(display.rows[0]).toEqual(["Frame rate match", "None: no fitting refresh rate or variable refresh (expect judder)"]);
  });
});

describe("kscreen-doctor's text listing", () => {
  it("reads variable refresh and HDR, which some Plasma releases leave out of the JSON", () => {
    const text = "\x1b[01;32mOutput: \x1b[0;0m1 HDMI-A-1 enabled connected priority 1 HDMI Modes: 1:3440x1440@100*! Geometry: 0,0 3440x1440 Scale: 1 Rotation: 1 Overscan: 0 Vrr: incapable RgbRange: Automatic HDR: incapable\nOutput: 2 DP-1 enabled connected Vrr: Automatic HDR: disabled\n";
    const out = parseOutputText(text);
    expect(out.get("HDMI-A-1")).toEqual({ vrrCapable: false, hdrCapable: false });
    expect(out.get("DP-1")).toEqual({ vrrCapable: true, vrrPolicy: "automatic", hdrCapable: true, hdr: false });
  });
});

describe("sound to the TV", () => {
  const card = (active: string, hdmi0 = "available") => ({
    name: "alsa_card.pci-0000_00_1f.3",
    active_profile: active,
    profiles: { "output:analog-stereo": { available: true }, "output:hdmi-stereo": { available: true }, "output:hdmi-surround71": { available: true }, "output:hdmi-stereo-extra1": { available: false }, off: { available: true } },
    ports: {
      "analog-output-headphones": { availability: "not available", profiles: ["output:analog-stereo"] },
      "hdmi-output-0": { availability: hdmi0, profiles: ["output:hdmi-stereo", "output:hdmi-surround71", "output:hdmi-stereo+input:analog-stereo"] },
      "hdmi-output-1": { availability: "not available", profiles: ["output:hdmi-stereo-extra1"] },
    },
  });

  it("moves an analog card to the connected HDMI output, in stereo", () => {
    expect(hdmiProfile(card("output:analog-stereo"))).toBe("output:hdmi-stereo");
    expect(hdmiProfile(card("off"))).toBe("output:hdmi-stereo");
  });

  it("leaves a card alone when it already plays to the TV, or no TV is connected", () => {
    expect(hdmiProfile(card("output:hdmi-surround71"))).toBeNull();
    expect(hdmiProfile(card("output:analog-stereo", "not available"))).toBeNull();
  });

  it("moves off an HDMI output the TV isn't on", () => {
    expect(hdmiProfile(card("output:hdmi-stereo-extra1"))).toBe("output:hdmi-stereo");
  });
});

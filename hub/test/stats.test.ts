import { describe, expect, it } from "vitest";
import type { HostStats } from "@ultimatetv/shared";
import { statsWarnings, type WarningInput } from "../src/stats.js";

const host = (extra: Partial<HostStats> = {}): HostStats => ({
  hostname: "h",
  kernel: "6.8",
  uptimeS: 100,
  load: [0.1, 0.1, 0.1],
  cpu: { model: "N150", cores: 4, usagePct: 10 },
  memory: { totalMb: 16000, availableMb: 12000 },
  temperatures: [{ name: "x86_pkg_temp", celsius: 50 }],
  disks: [{ label: "Recordings", path: "/mnt/nas", totalGb: 1000, freeGb: 500 }],
  network: [],
  ...extra,
});

const NOW = Date.parse("2026-10-25T12:00:00Z");
const base = (extra: Partial<WarningInput> = {}): WarningInput => ({
  now: NOW,
  hub: host(),
  box: { receivedAt: "2026-10-25T11:59:30Z", from: "1.2.3.4", report: { at: "", hostname: "box", uptimeS: 1, load: [], memory: { totalMb: 1, freeMb: 1 }, software: null, info: { cec: { connected: true } }, kscreen: { json: null, text: "" }, now: null, samples: [], log: [], host: host() } },
  sources: [{ name: "IPTV", status: { at: NOW, ok: true } }],
  connections: { used: 0, limit: 1 },
  hardwareTranscode: true,
  hubErrors: [],
  ...extra,
});

describe("stats warnings", () => {
  it("is quiet when all is well", () => {
    expect(statsWarnings(base())).toEqual([]);
  });

  it("flags a silent box, a full disk, heat and a broken IPTV login, worst first", () => {
    const w = statsWarnings(
      base({
        box: { ...base().box!, receivedAt: "2026-10-25T11:30:00Z" },
        hub: host({ disks: [{ label: "Recordings", path: "/mnt/nas", totalGb: 1000, freeGb: 20 }], temperatures: [{ name: "cpu", celsius: 95 }] }),
        sources: [{ name: "IPTV", status: { at: NOW, ok: false, error: "401 Unauthorized" } }],
      }),
    );
    expect(w.map((x) => x.level)).toEqual(["bad", "bad", "bad", "warn"]);
    expect(w.map((x) => x.text).join("\n")).toMatch(/30 minutes ago[\s\S]*/);
    expect(w.some((x) => x.text.includes("401 Unauthorized"))).toBe(true);
    expect(w.some((x) => x.text.includes("nearly full"))).toBe(true);
  });

  it("spots dropped frames while playing", () => {
    const sample = (dropped: number) => ({ at: "", status: "playing", frames: { dropped, decoderDropped: 0 } });
    const box = base().box!;
    const w = statsWarnings(base({ box: { ...box, report: { ...box.report, now: sample(40), samples: [sample(0), sample(10), sample(20)] } } }));
    expect(w).toEqual([expect.objectContaining({ where: "playback", text: expect.stringContaining("40 frames dropped") })]);
  });
});

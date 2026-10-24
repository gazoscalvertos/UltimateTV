import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake kscreen-doctor: a 50/60/100 Hz monitor that takes reduced-blanking custom modes.
const screen = vi.hoisted(() => ({ modes: [] as { id: string; refreshRate: number }[], current: "1", calls: [] as string[], refuse: false }));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    screen.calls.push(args.join(" "));
    let stdout = "";
    if (args[0] === "-j") {
      stdout = JSON.stringify({ outputs: [{ name: "HDMI-A-1", enabled: true, connected: true, currentModeId: screen.current, modes: screen.modes.map((m) => ({ id: m.id, size: { width: 3440, height: 1440 }, refreshRate: m.refreshRate })) }] });
    } else if (args[0] === "-o") {
      stdout = "Output: 1 HDMI-A-1 enabled connected Vrr: incapable HDR: incapable\n";
    } else {
      for (const a of args) {
        const add = /addCustomMode\.\d+\.\d+\.(\d+)\.reduced$/.exec(a);
        if (add) screen.modes.push({ id: "39", refreshRate: Math.round(Number(add[1]) * 0.99917) / 1000 });
        const mode = /\.mode\.(\d+)$/.exec(a);
        if (mode && !(screen.refuse && mode[1] === "39")) screen.current = mode[1]!;
      }
    }
    cb(null, { stdout, stderr: "" });
  },
}));

const { Display, customRate } = await import("../src/display.js");

beforeEach(() => {
  screen.modes = [
    { id: "1", refreshRate: 99.982 },
    { id: "2", refreshRate: 59.94 },
    { id: "3", refreshRate: 50 },
  ];
  screen.current = "1";
  screen.calls = [];
  screen.refuse = false;
});

describe("custom modes for screens with no fitting refresh rate", () => {
  const m = (id: string, refreshRate: number) => ({ id, width: 3440, height: 1440, refreshRate });

  it("picks the lowest multiple of the frame rate within the screen's range", () => {
    expect(customRate([m("1", 99.982), m("2", 59.94), m("3", 50)], m("1", 99.982), 23.976)).toBe(71.928);
    expect(customRate([m("1", 99.982), m("2", 59.94), m("3", 50)], m("1", 99.982), 24)).toBe(72);
    expect(customRate([m("1", 60)], m("1", 60), 23.976)).toBeNull();
  });

  it("adds a 72 Hz mode for 24p film, switches to it and switches back after", async () => {
    const display = new Display(() => undefined);
    expect(await display.prepare(23.976, false)).toBe("mode");
    expect(screen.calls).toContain("output.HDMI-A-1.addCustomMode.3440.1440.71928.reduced");
    expect(screen.current).toBe("39");
    await display.restore();
    expect(screen.current).toBe("1");
    // Next time the mode is already there.
    screen.calls = [];
    expect(await display.prepare(23.976, false)).toBe("mode");
    expect(screen.calls.some((c) => c.includes("addCustomMode"))).toBe(false);
    expect(screen.current).toBe("39");
  });

  it("stays put when the screen won't take the mode, and doesn't try it again", async () => {
    screen.refuse = true;
    const display = new Display(() => undefined);
    expect(await display.prepare(23.976, false)).toBeNull();
    expect(screen.current).toBe("1");
    screen.calls = [];
    expect(await display.prepare(23.976, false)).toBeNull();
    expect(screen.calls.some((c) => c.includes("mode.39"))).toBe(false);
  });

  it("can be turned off", async () => {
    const display = new Display(() => undefined, false);
    expect(await display.prepare(23.976, false)).toBeNull();
    expect(screen.calls.some((c) => c.includes("addCustomMode"))).toBe(false);
  });
});

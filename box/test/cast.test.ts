import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Cast, uxplayArgs, which } from "../src/cast.js";

let tmp = "";
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = "";
});

describe("AirPlay and games", () => {
  it("runs UxPlay named after the app, full screen, telling us when something connects", () => {
    expect(uxplayArgs("GazosTV", "/run/user/1000/a.dacp", ["-vd", "vah264dec"])).toEqual(["-n", "GazosTV", "-nh", "-fs", "-dacp", "/run/user/1000/a.dacp", "-ca", "-nofreeze", "-reset", "15", "-vd", "vah264dec"]);
  });

  it("finds programs on the PATH", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-cast-"));
    await writeFile(path.join(tmp, "retroarch"), "#!/bin/sh\n");
    await chmod(path.join(tmp, "retroarch"), 0o755);
    expect(which("retroarch", `/nope:${tmp}`)).toBe(path.join(tmp, "retroarch"));
    expect(which("moonlight", tmp)).toBeNull();
  });

  it("lists the games, says which are installed, and won't open one that isn't", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-cast-"));
    const oldPath = process.env.PATH;
    process.env.PATH = tmp;
    try {
      const cast = new Cast({ runtimeDir: tmp, configFile: path.join(tmp, "cast.json"), name: () => "TV", log: () => undefined, onForeground: () => undefined });
      const s = cast.state();
      expect(s.airplay).toMatchObject({ installed: false, enabled: true, running: false, connected: false, name: "TV" });
      expect(s.apps.map((a) => a.id)).toEqual(["retroarch", "moonlight", "steamlink", "geforcenow", "steam"]);
      expect(s.apps.every((a) => !a.installed)).toBe(true);
      await expect(cast.launch("moonlight")).rejects.toThrow(/isn't installed/);
      cast.stop();
    } finally {
      process.env.PATH = oldPath;
    }
  });
});

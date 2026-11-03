import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DesktopAppUpdates, endsOf, installerFor, installerWord } from "../src/desktop-app-updates.js";

const COMMIT_NOW = "aaaaaaa111111111111111111111111111111111";
const COMMIT_NEW = "bbbbbbb222222222222222222222222222222222";

/** A Windows installer: "MZ" at the front and comfortably over the stub threshold. */
function exe(size = 90_000_000): Buffer {
  const body = Buffer.alloc(size);
  body.set([0x4d, 0x5a], 0);
  return body;
}

/** A Mac disk image: a UDIF trailer starting "koly" in the last 512 bytes. */
function dmg(size = 2_000_000): Buffer {
  const body = Buffer.alloc(size, 1);
  body.set(Buffer.from("koly"), size - 512);
  return body;
}

function setup(opts: { platform?: string; arch?: string; fetch?: typeof fetch; openInstaller?: (f: string) => Promise<string> }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "utv-desktop-app-"));
  const buildInfo = path.join(dir, "build-info.json");
  writeFileSync(buildInfo, JSON.stringify({ commit: COMMIT_NOW, branch: "main" }));
  const log = vi.fn();
  const openInstaller = vi.fn(opts.openInstaller ?? (async () => ""));
  const updates = new DesktopAppUpdates({
    platform: opts.platform ?? "win32",
    arch: opts.arch ?? "x64",
    buildInfo,
    stateDir: dir,
    log,
    openInstaller,
    baseUrl: "https://example.test/rel",
    ...(opts.fetch ? { fetchImpl: opts.fetch } : {}),
  });
  return { dir, updates, log, openInstaller };
}

describe("Windows and Mac updates", () => {
  it("are the desktop installer's job on Windows and macOS, and not on Linux", () => {
    expect(installerFor("win32")).toBe("windows");
    expect(installerFor("darwin")).toBe("macos");
    // Linux swaps its AppImage in place (appimage-updates.ts) and the box updates through systemd.
    expect(installerFor("linux")).toBeNull();
    expect(installerWord("windows")).toBe("a Windows installer");
    expect(installerWord("macos")).toBe("a disk image");
    expect(installerWord("linux")).toBe("an AppImage");
  });

  it("reports what this copy is and what the release has", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW, branch: "main" })) : new Response(exe()),
    ) as unknown as typeof fetch;
    const { updates } = setup({ fetch: fetchImpl });
    const before = await updates.status(true);
    expect(before).toMatchObject({ commit: COMMIT_NOW, branch: "main", latest: COMMIT_NEW, updating: false });
    expect(before.lastUpdate).toBeUndefined();
  });

  it("downloads the right installer for the platform and architecture and opens it", async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(url);
      return url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW })) : new Response(exe());
    }) as unknown as typeof fetch;
    const { dir, updates, openInstaller } = setup({ platform: "win32", arch: "arm64", fetch: fetchImpl });
    await updates.start();
    // The name shared/src/desktop.ts and tools/desktop/electron-builder.yml agree on.
    expect(asked).toContain("https://example.test/rel/UltimateTV-Setup-arm64.exe");
    const target = path.join(dir, "updates", "UltimateTV-Setup-arm64.exe");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).subarray(0, 2)).toEqual(Buffer.from([0x4d, 0x5a]));
    expect(openInstaller).toHaveBeenCalledWith(target);
    expect((await updates.status(false)).lastUpdate).toMatchObject({ ok: true });
  });

  it("fetches the .dmg on a Mac", async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(url);
      return url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW })) : new Response(dmg());
    }) as unknown as typeof fetch;
    const { dir, updates } = setup({ platform: "darwin", arch: "arm64", fetch: fetchImpl });
    await updates.start();
    expect(asked).toContain("https://example.test/rel/UltimateTV-arm64.dmg");
    expect(existsSync(path.join(dir, "updates", "UltimateTV-arm64.dmg"))).toBe(true);
  });

  it("does nothing when it is already the release's build", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NOW })) : new Response(exe()),
    ) as unknown as typeof fetch;
    const { updates, openInstaller, log } = setup({ fetch: fetchImpl });
    await updates.start();
    expect(openInstaller).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Already up to date");
  });

  it("leaves an error page alone instead of opening it as an installer", async () => {
    const page = "<html><h1>404</h1></html>";
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW })) : new Response(page),
    ) as unknown as typeof fetch;
    const { dir, updates, openInstaller } = setup({ fetch: fetchImpl });
    await expect(updates.start()).rejects.toThrow(/isn't a Windows installer/);
    expect(openInstaller).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, "updates", "UltimateTV-Setup-x64.exe"))).toBe(false);
    expect(existsSync(path.join(dir, "updates", "UltimateTV-Setup-x64.exe.download"))).toBe(false);
    expect((await updates.status(false)).lastUpdate).toMatchObject({ ok: false });
  });

  it("says so when the installer couldn't be opened", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW })) : new Response(exe()),
    ) as unknown as typeof fetch;
    const { updates } = setup({ fetch: fetchImpl, openInstaller: async () => "no application to open it" });
    await expect(updates.start()).rejects.toThrow(/couldn't open the installer: no application to open it/);
  });

  it("keeps a log for the diagnostics and the About screen, and refuses to pretend it can roll back", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: COMMIT_NEW })) : new Response(exe()),
    ) as unknown as typeof fetch;
    const { updates } = setup({ fetch: fetchImpl });
    await updates.start();
    const history = await updates.history();
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((l) => /^\d{4}-\d\d-\d\dT/.test(l))).toBe(true);
    await expect(updates.rollBack()).rejects.toThrow(/can't roll back by itself/);
  });

  it("reads its own platform's build description, and falls back to the shared one", async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(url);
      // A release from before the per-platform files: only the shared one is there.
      if (url.endsWith("ultimatetv-windows.json")) return new Response("Not Found", { status: 404 });
      if (url.endsWith("ultimatetv-desktop.json")) return new Response(JSON.stringify({ commit: COMMIT_NEW }));
      return new Response(exe());
    }) as unknown as typeof fetch;
    const { updates } = setup({ fetch: fetchImpl });
    expect((await updates.status(true)).latest).toBe(COMMIT_NEW);
    // Tried the platform's own file first, then the shared one.
    expect(asked[0]).toMatch(/ultimatetv-windows\.json$/);
    expect(asked[1]).toMatch(/ultimatetv-desktop\.json$/);
    // And with both present, the platform's own is the answer.
    const both = vi.fn(async (url: string) => {
      if (url.endsWith("ultimatetv-windows.json")) return new Response(JSON.stringify({ commit: COMMIT_NEW }));
      if (url.endsWith("ultimatetv-desktop.json")) return new Response(JSON.stringify({ commit: COMMIT_NOW }));
      return new Response(exe());
    }) as unknown as typeof fetch;
    const second = setup({ fetch: both });
    expect((await second.updates.status(true)).latest).toBe(COMMIT_NEW);
  });

  it("still answers when the update check itself fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const { updates, log } = setup({ fetch: fetchImpl });
    const sw = await updates.status(true);
    expect(sw.commit).toBe(COMMIT_NOW);
    expect(sw.latest).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Update check failed: GitHub said 500/));
  });
});

describe("the ends of a download", () => {
  it("reads the first and last bytes without the rest", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "utv-ends-"));
    const file = path.join(dir, "thing");
    writeFileSync(file, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(5000, 7), Buffer.from("koly")]));
    const { head, tail } = await endsOf(file, 5006);
    expect(head.subarray(0, 2)).toEqual(Buffer.from("MZ"));
    expect(tail.subarray(-4)).toEqual(Buffer.from("koly"));
  });
});

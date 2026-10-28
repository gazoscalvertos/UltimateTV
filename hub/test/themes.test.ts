import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanLook, easterSunday, isHalloweenWeek, resolveTheme, seasonalTheme, THEMES, type PublicSettings, type ThemePalette } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe("the seasons", () => {
  it("knows Halloween week", () => {
    expect(isHalloweenWeek(at("2026-10-25"))).toBe(true);
    expect(isHalloweenWeek(at("2026-11-01"))).toBe(true);
    expect(isHalloweenWeek(at("2026-10-24"))).toBe(false);
    expect(isHalloweenWeek(at("2026-11-02"))).toBe(false);
  });

  it("works out Easter", () => {
    expect(easterSunday(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easterSunday(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
    expect(easterSunday(2025).toDateString()).toBe(new Date(2025, 3, 20).toDateString());
  });

  it("brings each seasonal theme out on its days", () => {
    expect(seasonalTheme(at("2026-10-31"))).toBe("halloween");
    expect(seasonalTheme(at("2026-12-01"))).toBe("christmas");
    expect(seasonalTheme(at("2027-01-05"))).toBe("christmas");
    expect(seasonalTheme(at("2027-01-06"))).toBeNull();
    expect(seasonalTheme(at("2027-02-14"))).toBe("valentine");
    expect(seasonalTheme(at("2027-02-15"))).toBeNull();
    // Palm Sunday to Easter Monday, 2026.
    expect(seasonalTheme(at("2026-03-28"))).toBeNull();
    expect(seasonalTheme(at("2026-03-29"))).toBe("easter");
    expect(seasonalTheme(at("2026-04-06"))).toBe("easter");
    expect(seasonalTheme(at("2026-04-07"))).toBeNull();
    expect(seasonalTheme(at("2026-06-01"))).toBeNull();
  });
});

describe("which theme to wear", () => {
  it("wears the everyday theme out of season, and the season's in it", () => {
    expect(resolveTheme({ theme: "cyberpunk", seasonal: true }, at("2026-06-01"))).toBe("cyberpunk");
    expect(resolveTheme({ theme: "cyberpunk", seasonal: true }, at("2026-12-20"))).toBe("christmas");
    expect(resolveTheme({ theme: "cyberpunk", seasonal: false }, at("2026-12-20"))).toBe("cyberpunk");
  });

  it("understands what older TVs and phones saved", () => {
    expect(resolveTheme({ theme: "auto" }, at("2026-10-31"))).toBe("halloween");
    expect(resolveTheme({ theme: "auto" }, at("2026-06-01"))).toBe("default");
    expect(cleanLook({ theme: "auto" })).toEqual({ theme: "default", seasonal: true });
    expect(cleanLook({})).toEqual({ theme: "default", seasonal: true });
    // "Plain" and "Halloween" were picked by hand, so the seasons stay off for them.
    expect(cleanLook({ theme: "default" })).toEqual({ theme: "default", seasonal: false });
    expect(cleanLook({ theme: "halloween" })).toEqual({ theme: "halloween", seasonal: false });
    expect(cleanLook({ theme: "nonsense" as never })).toEqual({ theme: "default", seasonal: true });
  });

  it("gives every theme a whole palette", () => {
    const keys = Object.keys(THEMES[0]!.palette).sort();
    for (const t of THEMES) expect(Object.keys(t.palette).sort(), t.id).toEqual(keys);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of ["default", "light", "cyberpunk", "slick", "halloween", "christmas", "easter"]) expect(ids).toContain(name);
    // The "r g b" ones really are, so `rgb(var(--hi) / 0.1)` works.
    for (const t of THEMES) for (const k of ["--hi", "--bg-rgb", "--panel-rgb"] as (keyof ThemePalette)[]) expect(t.palette[k]).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });
});

describe("the theme on the Hub", () => {
  let tmp: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-themes-"));
    app = await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never });
    await pairAsTv(app);
  });

  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const settings = async () => (await app.inject("/api/settings")).json() as PublicSettings;
  const put = async (payload: object) => (await app.inject({ method: "PUT", url: "/api/settings", payload })).json() as PublicSettings;

  it("starts dark, with the seasons on", async () => {
    const s = await settings();
    expect(s.theme).toBe("default");
    expect(s.seasonal).toBe(true);
    expect(s.themeNow).toBe(resolveTheme({ theme: "default", seasonal: true }));
  });

  it("keeps the theme and the seasons as they're changed", async () => {
    let s = await put({ theme: "light", seasonal: false });
    expect(s).toMatchObject({ theme: "light", seasonal: false, themeNow: "light" });
    s = await put({ theme: "cyberpunk" });
    expect(s).toMatchObject({ theme: "cyberpunk", seasonal: false });
    s = await put({ theme: "made-up" });
    expect(s.theme).toBe("cyberpunk");
    // An older TV cycling to "auto".
    s = await put({ theme: "auto" });
    expect(s).toMatchObject({ theme: "default", seasonal: true });
  });

  it("serves the palettes, with today's theme put on, for the phone and web pages", async () => {
    await put({ theme: "slick", seasonal: false });
    const res = await app.inject("/theme.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toContain('apply("slick")');
    expect(res.body).toContain('"cyberpunk":{');
  });
});

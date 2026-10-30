import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuideWindow, HomeScreen, Profile, SearchResult } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { certificationRank, ContentFilter, ProfileStore } from "../src/profiles.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

describe("ProfileStore", () => {
  it("starts with a Family and a Kids profile", () => {
    const store = new ProfileStore(new Db(":memory:"));
    expect(store.list().map((p) => [p.name, p.kind])).toEqual([
      ["Family", "adult"],
      ["Kids", "kids"],
    ]);
    expect(store.locked()).toBe(false);
    expect(store.resolve(undefined, undefined).admin).toBe(true);
  });

  it("keeps each profile's accessibility, one change at a time", () => {
    const store = new ProfileStore(new Db(":memory:"));
    expect(store.update("family", { accessibility: { textScale: 150 } })?.accessibility).toEqual({ audioDescription: false, highContrast: false, textScale: 150, reducedMotion: false });
    expect(store.update("family", { accessibility: { reducedMotion: true } })?.accessibility).toMatchObject({ textScale: 150, reducedMotion: true });
    expect(store.get("kids")?.accessibility).toBeUndefined();
    // All off again, or null: nothing kept.
    expect(store.update("family", { accessibility: { textScale: 100, reducedMotion: false } })?.accessibility).toBeUndefined();
    store.update("family", { accessibility: { highContrast: true } });
    expect(store.update("family", { accessibility: null })?.accessibility).toBeUndefined();
  });

  it("locks every adult profile once one has a PIN", () => {
    const store = new ProfileStore(new Db(":memory:"));
    const dad = store.create({ name: "Dad", kind: "adult" });
    store.update("family", { pin: "1234" });
    expect(store.locked()).toBe(true);
    expect(store.get(dad.id)?.hasPin).toBe(true);
    // Without a token, an adult profile falls back to Kids.
    expect(store.resolve("family", undefined).profile?.kind).toBe("kids");
    expect(store.resolve(dad.id, undefined).profile?.kind).toBe("kids");
    expect(store.resolve(undefined, undefined).admin).toBe(false);
    expect(() => store.unlock("family", "0000")).toThrow(/PIN/);
    // Dad has no PIN of his own, so the household PIN opens it.
    const token = store.unlock(dad.id, "1234");
    expect(store.resolve(dad.id, token)).toMatchObject({ profile: { id: dad.id }, admin: true });
    // Kids needs no PIN.
    expect(store.resolve("kids", store.unlock("kids", undefined)).admin).toBe(false);
  });

  it("rejects malformed PINs and keeps one adult", () => {
    const store = new ProfileStore(new Db(":memory:"));
    expect(() => store.update("family", { pin: "12a4" })).toThrow(/four digits/);
    expect(() => store.remove("family")).toThrow(/adult/);
  });

  it("filters content for kids", () => {
    const kids: Profile = { id: "k", name: "Kids", kind: "kids", colour: "#fff", hasPin: false, maxCertification: "PG", channelCategories: ["kids"], allowedChannels: ["bbc-one"] };
    const f = new ContentFilter(kids);
    expect(f.title({ certification: "PG", genres: [] })).toBe(true);
    expect(f.title({ certification: "12A", genres: ["Family"] })).toBe(false);
    expect(f.title({ genres: ["Animation", "Comedy"] })).toBe(false);
    expect(f.title({ genres: ["Animation", "Family"] })).toBe(true);
    expect(f.title({ certification: "TV-Y7", genres: [] })).toBe(true);
    expect(f.ref({ id: "x", kind: "movie", name: "X", certification: "18" })).toBe(false);
    const channel = { id: "bbc-one", category: "entertainment" } as never;
    expect(f.channel(channel)).toBe(true);
    expect(f.channel({ id: "itv1", category: "entertainment" } as never)).toBe(false);
    expect(new ContentFilter(null).title({ certification: "18", genres: [] })).toBe(true);
    expect(certificationRank("GB-15")).toBe(4);
  });
});

describe("profiles over the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const kids = { "x-profile": "kids" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-profiles-"));
    const config: HubConfig = {
      port: 8095,
      host: "127.0.0.1",
      dataDir: path.join(tmp, "data"),
      clipsDir: path.join(tmp, "clips"),
      probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"),
      setupDir: path.join(tmp, "setup"),
      mediaRoot: path.join(tmp, "media"),
      demo: true,
    };
    app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
    await pairAsTv(app);
  });

  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("shows Kids only kids' channels and titles", async () => {
    const guide = (await app.inject({ url: "/api/guide", headers: kids })).json<GuideWindow>();
    expect(guide.channels.length).toBeGreaterThan(0);
    expect(guide.channels.every((c) => c.category === "kids")).toBe(true);

    const home = (await app.inject({ url: "/api/home", headers: kids })).json<HomeScreen>();
    const titles = home.rails.flatMap((r) => r.items.map((t) => t.name));
    expect(titles).not.toContain("Copper Sky");

    expect((await app.inject({ url: "/api/titles/" + encodeURIComponent("demo:movie:copper-sky"), headers: kids })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/titles/" + encodeURIComponent("demo:movie:paper-moons"), headers: kids })).statusCode).toBe(200);

    const search = (await app.inject({ url: "/api/search?q=copper", headers: kids })).json<{ results: SearchResult[] }>();
    expect(search.results.filter((r) => r.kind === "title")).toHaveLength(0);

    const play = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-one" }, headers: kids });
    expect(play.statusCode).toBe(403);
    const cbeebies = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "cbeebies" }, headers: kids });
    expect(cbeebies.statusCode).toBe(200);
  });

  it("shows Kids only the downloads on the box they're allowed", async () => {
    const items = [
      { id: "a", title: { id: "t1", kind: "movie", name: "Paper Moons", certification: "U" } },
      { id: "b", title: { id: "t2", kind: "movie", name: "Copper Sky", certification: "15" } },
      { id: "c", channelId: "cbeebies" },
      { id: "d", channelId: "bbc-one" },
      { id: "e", title: { id: "t3", kind: "movie", name: "Unrated", genres: ["Family"] } },
      { id: "f" },
    ];
    const asKids = (await app.inject({ method: "POST", url: "/api/offline/allowed", payload: { items }, headers: kids })).json<{ allowed: string[] }>();
    expect(asKids.allowed).toEqual(["a", "c", "e"]);
    const asFamily = (await app.inject({ method: "POST", url: "/api/offline/allowed", payload: { items } })).json<{ allowed: string[] }>();
    expect(asFamily.allowed).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("stops Kids changing settings or deleting recordings", async () => {
    expect((await app.inject({ method: "PUT", url: "/api/settings", payload: { tmdbApiKey: "" }, headers: kids })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/recordings/whatever", headers: kids })).statusCode).toBe(403);
  });

  it("asks the setup page for a PIN once the lock is on", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/profiles/family", payload: { pin: "2468" } })).statusCode).toBe(200);
    const blocked = await app.inject({ method: "PUT", url: "/api/settings", payload: {} });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "pin" });
    expect((await app.inject({ method: "POST", url: "/api/profiles/admin-unlock", payload: { pin: "1111" } })).statusCode).toBe(403);
    const { token } = (await app.inject({ method: "POST", url: "/api/profiles/admin-unlock", payload: { pin: "2468" } })).json<{ token: string }>();
    expect((await app.inject({ method: "PUT", url: "/api/settings", payload: {}, headers: { "x-profile-token": token } })).statusCode).toBe(200);

    const list = (await app.inject({ url: "/api/profiles", headers: { "x-profile": "family" } })).json<{ profiles: Profile[]; current: string; admin: boolean }>();
    expect(list.current).toBe("kids");
    expect(list.admin).toBe(false);
    expect(list.profiles.find((p) => p.id === "family")?.hasPin).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/pinHash|pinSalt/);
  });
});

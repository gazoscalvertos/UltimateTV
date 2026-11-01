import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuideWindow, HomeScreen, Profile, SearchResult } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { certificationRank, clearPinLockouts, ContentFilter, PIN_FIRST_LOCKOUT_MS, PIN_FORGET_MS, PIN_MAX_LOCKOUT_MS, PIN_MAX_TRIES, PinLimiter, ProfileStore } from "../src/profiles.js";
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

  it("locks a profile out after five wrong PINs, and the right one waits too", () => {
    const db = new Db(":memory:");
    const store = new ProfileStore(db);
    store.update("family", { pin: "1234" });
    const now = 1_000_000;
    const client = "device:tv-in-the-lounge";
    for (let i = 1; i < PIN_MAX_TRIES; i++) expect(() => store.unlock("family", "0000", client, now)).toThrow(/PIN isn't right/);
    const thrown = (() => {
      try {
        store.unlock("family", "0000", client, now);
      } catch (err) {
        return err as { statusCode?: number; code?: string; retryAfterMs?: number };
      }
      return undefined;
    })();
    expect(thrown?.statusCode).toBe(429);
    expect(thrown?.code).toBe("pin-locked");
    expect(thrown?.retryAfterMs).toBe(PIN_FIRST_LOCKOUT_MS);
    // Even the right PIN waits the minute out...
    expect(() => store.unlock("family", "1234", client, now)).toThrow(/Too many tries, wait 1 minute/);
    // ...then it works, and the tries are forgotten.
    expect(store.unlock("family", "1234", client, now + PIN_FIRST_LOCKOUT_MS)).toEqual(expect.any(String));
    expect(() => store.unlock("family", "0000", client, now + PIN_FIRST_LOCKOUT_MS)).toThrow(/PIN isn't right/);
  });

  it("counts wrong PINs per client as well as per profile", () => {
    const store = new ProfileStore(new Db(":memory:"));
    const dad = store.create({ name: "Dad", kind: "adult" });
    store.update("family", { pin: "1234" });
    const tv = "device:tv";
    for (let i = 0; i < PIN_MAX_TRIES; i++) {
      try {
        store.unlock("family", "0000", tv, 5_000);
      } catch {
        // The fifth throw is the lockout.
      }
    }
    // The TV is barred whatever profile it asks for, PIN or not.
    expect(() => store.unlock(dad.id, "1234", tv, 5_000)).toThrow(/Too many tries/);
    // A phone that hasn't been guessing is let in with the right PIN.
    expect(store.unlock(dad.id, "1234", "ip:192.168.1.50", 5_000)).toEqual(expect.any(String));
  });

  it("forgets the tries after a quiet hour", () => {
    const store = new ProfileStore(new Db(":memory:"));
    store.update("family", { pin: "1234" });
    const now = 1_000_000;
    for (let i = 1; i < PIN_MAX_TRIES; i++) {
      try {
        store.unlock("family", "0000", "device:tv", now);
      } catch {
        // Wrong, but not yet locked out.
      }
    }
    // An hour later it's a new day's mistake, not a guesser at work.
    expect(() => store.unlock("family", "0000", "device:tv", now + PIN_FORGET_MS + 1)).toThrow(/PIN isn't right/);
  });

  it("keeps the lockout in the database, so restarting the Hub doesn't clear it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "utv-pin-"));
    const file = path.join(dir, "hub.db");
    const now = 1_000_000;
    const first = new Db(file);
    const store = new ProfileStore(first);
    store.update("family", { pin: "1234" });
    for (let i = 0; i < PIN_MAX_TRIES; i++) {
      try {
        store.unlock("family", "0000", "device:tv", now);
      } catch {
        // The fifth is the lockout.
      }
    }
    first.close();
    // A fresh Hub on the same database still knows about it.
    const second = new Db(file);
    const restarted = new ProfileStore(second);
    expect(() => restarted.unlock("family", "1234", "device:tv", now)).toThrow(/Too many tries/);
    // reset-pins.js clears it along with the PINs.
    clearPinLockouts(second);
    expect(restarted.unlock("family", "1234", "device:tv", now)).toEqual(expect.any(String));
    second.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("forgets a profile's tries when its PIN is changed", () => {
    const store = new ProfileStore(new Db(":memory:"));
    store.update("family", { pin: "1234" });
    const now = 1_000_000;
    for (let i = 0; i < PIN_MAX_TRIES; i++) {
      try {
        store.unlock("family", "0000", "device:tv", now);
      } catch {
        // The fifth is the lockout.
      }
    }
    // The grown-up changes the PIN (they were already in), so the new one works at once.
    store.update("family", { pin: "5678" });
    expect(store.unlock("family", "5678", "device:tv", now)).toEqual(expect.any(String));
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

describe("PinLimiter", () => {
  it("locks out after five tries, doubling each time up to an hour", () => {
    const now = 10_000_000;
    const limiter = new PinLimiter(new Db(":memory:"), now);
    limiter.reset();
    const attempts = (n: number, at: number) => {
      for (let i = 0; i < n; i++) limiter.fail("family", "device:tv", at);
      return limiter.lockout("family", "device:tv", at);
    };
    expect(attempts(PIN_MAX_TRIES - 1, now)).toBe(0);
    expect(attempts(1, now)).toBe(PIN_FIRST_LOCKOUT_MS);
    // Each further wrong try while the lockout is on doubles it, up to an hour.
    expect(attempts(1, now)).toBe(PIN_FIRST_LOCKOUT_MS * 2);
    expect(attempts(1, now)).toBe(PIN_FIRST_LOCKOUT_MS * 4);
    for (let i = 0; i < 10; i++) attempts(1, now);
    expect(limiter.lockout("family", "device:tv", now)).toBe(PIN_MAX_LOCKOUT_MS);
    // Once the lockout has run out, a right PIN clears everything.
    limiter.clear("family", "device:tv");
    expect(limiter.lockout("family", "device:tv", now)).toBe(0);
  });

  it("shares the count per profile and per client", () => {
    const limiter = new PinLimiter(new Db(":memory:"));
    limiter.reset();
    const t = 1_000;
    // The TV guesses at the household PIN five times.
    for (let i = 0; i < PIN_MAX_TRIES; i++) limiter.fail("family", "device:tv", t);
    // The profile is barred, whoever asks...
    expect(limiter.lockout("family", "ip:192.168.1.9", t)).toBe(PIN_FIRST_LOCKOUT_MS);
    // ...and so is the TV, whatever profile it asks for.
    expect(limiter.lockout("kids", "device:tv", t)).toBe(PIN_FIRST_LOCKOUT_MS);
    // A phone that hasn't been guessing may try.
    expect(limiter.lockout("kids", "ip:192.168.1.9", t)).toBe(0);
    // The TV's next wrong try, on another profile, doubles its wait.
    expect(limiter.fail("kids", "device:tv", t)).toBe(PIN_FIRST_LOCKOUT_MS * 2);
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

  // Last: it leaves the TV locked out, which would get in the way of the tests above.
  it("answers 429 with a Retry-After once the guesses run out", async () => {
    const unlock = (pin: string) => app.inject({ method: "POST", url: "/api/profiles/admin-unlock", payload: { pin } });
    for (let i = 1; i < PIN_MAX_TRIES; i++) expect((await unlock("0000")).statusCode).toBe(403);
    const locked = await unlock("0000");
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: "pin-locked" });
    expect(locked.json().error).toMatch(/^Too many tries, wait 1 minute/);
    expect(Number(locked.headers["retry-after"])).toBe(PIN_FIRST_LOCKOUT_MS / 1000);
    // Even the right PIN is turned away while the lockout runs.
    expect((await unlock("2468")).statusCode).toBe(429);
  });
});

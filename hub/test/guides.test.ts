import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CustomGuide, GuideChoices, GuideWindow, SearchResult } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { buildChannels, ChannelStore } from "../src/channels.js";
import { CustomGuideStore } from "../src/guides.js";
import { buildServer } from "../src/server.js";
import { channel, programme, pairAsTv } from "./helpers.js";

describe("CustomGuideStore", () => {
  const channels = [channel("a", { number: 101 }), channel("b", { number: 102, category: "sport", favourite: true }), channel("c", { number: 103 })];

  it("keeps a custom guide's own order and drops channels the profile can't see", () => {
    const store = new CustomGuideStore(new Db(":memory:"));
    const g = store.create({ name: " Mine ", channels: ["c", "gone", "a", "c"] });
    expect(g.name).toBe("Mine");
    expect(store.channelsFor(g.id, channels).map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("offers only lists with channels in them", () => {
    const store = new CustomGuideStore(new Db(":memory:"));
    const ids = store.choices(channels).map((c) => c.id);
    expect(ids).toEqual(["", "favourites", "entertainment", "sport"]);
    expect(store.channelsFor("sport", channels).map((c) => c.id)).toEqual(["b"]);
  });

  it("falls back to all channels when a default guide is deleted", () => {
    const store = new CustomGuideStore(new Db(":memory:"));
    const g = store.create({ channels: ["a"] });
    expect(store.resolveDefault(g.id, channels)).toBe(g.id);
    store.remove(g.id);
    expect(store.resolveDefault(g.id, channels)).toBe("");
    expect(store.channelsFor(g.id, channels)).toHaveLength(3);
  });
});

describe("lists and channels arranged by hand", () => {
  it("puts the lists in the household's order, with new ones after", () => {
    const store = new CustomGuideStore(new Db(":memory:"));
    const channels = [channel("a", { favourite: true }), channel("b", { category: "sport" }), channel("c", { category: "news" })];
    const g = store.create({ name: "Mine", channels: ["a"] });
    store.setOrder(["news", "sport", "favourites"]);
    expect(store.choices(channels).map((c) => c.id)).toEqual(["", "news", "sport", "favourites", g.id, "entertainment"]);
  });

  it("swaps numbers when moving a channel onto another's, and keeps a chosen category through a refresh", () => {
    const store = new ChannelStore(new Db(":memory:"));
    const feed = (name: string) => ({ sourceId: "x", upstreamId: name, name, url: `http://h/${name}`, catchupDays: 0, group: "UK" });
    const built = buildChannels([feed("UK: BBC One"), feed("UK: BBC Two")], { numbering: "uk", filter: null, existing: new Map() });
    store.replace(built.channels, built.feeds);
    expect(() => store.update("bbc-two", { number: 101 })).toThrow(/already BBC One/);
    store.update("bbc-two", { number: 101, swap: true });
    expect(store.list().map((c) => [c.id, c.number])).toEqual([["bbc-two", 101], ["bbc-one", 102]]);

    store.update("bbc-one", { category: "news" });
    expect(() => store.update("bbc-one", { category: "nonsense" as never })).toThrow();
    const again = buildChannels([feed("UK: BBC One"), feed("UK: BBC Two")], { numbering: "uk", filter: null, existing: store.existingFlags() });
    expect(again.channels.find((c) => c.id === "bbc-one")).toMatchObject({ category: "news", number: 102 });
    store.replace(again.channels, again.feeds);
    store.update("bbc-one", { category: null });
    const reset = buildChannels([feed("UK: BBC One")], { numbering: "uk", filter: null, existing: store.existingFlags() });
    expect(reset.channels[0]!.category).toBe("entertainment");
  });
});

describe("custom guides over the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const family = { "x-profile": "family" };
  const kids = { "x-profile": "kids" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-guides-"));
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

  it("builds a guide, shows it in order and saves it as a profile's default", async () => {
    const created = await app.inject({ method: "POST", url: "/api/guides", payload: { name: "Sport first", channels: ["sky-sports-main-event", "bbc-one"] }, headers: family });
    expect(created.statusCode).toBe(201);
    const g = created.json<CustomGuide>();

    const guide = (await app.inject({ url: `/api/guide?category=${g.id}`, headers: family })).json<GuideWindow>();
    expect(guide.channels.map((c) => c.id)).toEqual(["sky-sports-main-event", "bbc-one"]);

    expect((await app.inject({ method: "PUT", url: "/api/guides/default", payload: { guide: g.id }, headers: family })).statusCode).toBe(200);
    const choices = (await app.inject({ url: "/api/guides", headers: family })).json<GuideChoices>();
    expect(choices.default).toBe(g.id);
    expect(choices.choices.find((c) => c.id === g.id)).toMatchObject({ label: "Sport first", kind: "custom", count: 2 });
    // Another profile keeps its own default.
    expect((await app.inject({ url: "/api/guides", headers: kids })).json<GuideChoices>().default).toBe("");

    await app.inject({ method: "PATCH", url: `/api/guides/${g.id}`, payload: { channels: ["bbc-one"] }, headers: family });
    expect((await app.inject({ url: `/api/guide?category=${g.id}`, headers: family })).json<GuideWindow>().channels.map((c) => c.id)).toEqual(["bbc-one"]);
  });

  it("saves the list order and a profile's default from the phone", async () => {
    expect((await app.inject({ method: "PUT", url: "/api/guides/order", payload: { order: ["sport", "news"] }, headers: kids })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/guides/order", payload: { order: ["sport", "news"] } })).statusCode).toBe(200);
    const ids = (await app.inject({ url: "/api/guides", headers: family })).json<GuideChoices>().choices.map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(["", "sport", "news"]);
    expect((await app.inject({ method: "PATCH", url: "/api/profiles/family", payload: { defaultGuide: "sport" } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/guides", headers: family })).json<GuideChoices>().default).toBe("sport");
    expect((await app.inject({ method: "PATCH", url: "/api/channels/bbc-one", payload: { category: "nope" } })).statusCode).toBe(400);
  });

  it("lets Kids pick a list but not build one, and keeps their channels filtered", async () => {
    expect((await app.inject({ method: "POST", url: "/api/guides", payload: { name: "x" }, headers: kids })).statusCode).toBe(403);
    const g = (await app.inject({ method: "POST", url: "/api/guides", payload: { channels: ["bbc-one", "cbeebies"] }, headers: family })).json<CustomGuide>();
    expect((await app.inject({ method: "PUT", url: "/api/guides/default", payload: { guide: g.id }, headers: kids })).statusCode).toBe(200);
    const guide = (await app.inject({ url: `/api/guide?category=${g.id}`, headers: kids })).json<GuideWindow>();
    expect(guide.channels.map((c) => c.id)).toEqual(["cbeebies"]);
  });

  it("finds channels by name, with what's on now", async () => {
    // The demo guide has gaps at some times of day, so put a programme on now rather than rely on the clock.
    app.hub.guide.dropFrom("bbc-one");
    app.hub.guide.upsert([programme("bbc-one", Date.now() - 10 * 60_000, 60, { title: "On Right Now" })]);
    const r = (await app.inject({ url: "/api/search?q=bbcone", headers: family })).json<{ results: SearchResult[] }>().results;
    expect(r.find((x) => x.kind === "channel")).toMatchObject({ id: "bbc-one", name: "BBC One" });
    expect(r.find((x) => x.kind === "channel")?.subtitle).toBe("101 · Now: On Right Now");
    expect(r.some((x) => x.kind === "on-now" && x.channel?.id === "bbc-one" && x.name === "On Right Now")).toBe(true);
  });
});

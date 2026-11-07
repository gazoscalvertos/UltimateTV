// Emby (a Jellyfin-shaped client) and several media servers at once (#216, #217), against faked
// servers: ids that cannot collide, merged rails, routing by server, and one server being down.

import { describe, expect, it } from "vitest";
import { CombinedMedia } from "../src/services/combined.js";
import { EmbyClient } from "../src/services/emby.js";
import { JellyfinClient } from "../src/services/jellyfin.js";
import { PlexClient } from "../src/services/plex.js";

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const film = (Id: string, Name: string, extra: Record<string, unknown> = {}) => ({ Id, Name, Type: "Movie", ProviderIds: { Tmdb: "603" }, ImageTags: { Primary: "t" }, ...extra });

describe("Emby", () => {
  const auth = { url: "http://emby:8096/", userId: "u1", token: "k" };

  it("keys its titles emby: and sends Emby's headers", async () => {
    const f = fakeFetch({ "/Items/Resume": { Items: [film("55", "The Matrix")] } });
    const emby = new EmbyClient(auth, f.impl);
    expect(emby.kind).toBe("emby");
    expect(emby.key("55")).toBe("emby:55");
    expect(emby.parseKey("emby:55")).toBe("55");
    expect(emby.parseKey("jellyfin:55")).toBeUndefined();
    const [item] = await emby.resume();
    expect(emby.toTitleRef(item!).id).toBe("tmdb:movie:603");
    expect(emby.toDetails({ ...item!, ProviderIds: {} }).id).toBe("emby:55");
    expect(emby.toDetails(item!).availability).toEqual(["emby"]);
    const headers = f.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["X-Emby-Token"]).toBe("k");
    expect(headers["X-Emby-Authorization"]).toContain('Token="k"');
  });

  it("makes skip markers from chapter markers", async () => {
    const f = fakeFetch({
      "/Items/55": {
        Id: "55",
        Name: "x",
        Type: "Episode",
        RunTimeTicks: 30_000_000_000,
        Chapters: [
          { StartPositionTicks: 0, Name: "Chapter 1", MarkerType: "Chapter" },
          { StartPositionTicks: 600_000_000, MarkerType: "IntroStart" },
          { StartPositionTicks: 1_500_000_000, MarkerType: "IntroEnd" },
          { StartPositionTicks: 28_000_000_000, MarkerType: "CreditsStart" },
        ],
      },
    });
    const segs = await new EmbyClient(auth, f.impl).segments("55");
    expect(segs).toEqual([
      { Type: "Intro", StartTicks: 600_000_000, EndTicks: 1_500_000_000 },
      { Type: "Outro", StartTicks: 28_000_000_000, EndTicks: 30_000_000_000 },
    ]);
  });

  it("has no Quick Connect", async () => {
    await expect(new EmbyClient({ url: "http://emby:8096" }).quickConnectInitiate()).rejects.toThrow(/Quick Connect/);
  });
});

describe("Several servers at once", () => {
  const jfAuth = { url: "http://jf:8096", userId: "u", token: "j" };
  const emAuth = { url: "http://em:8096", userId: "u", token: "e" };

  function both(jfRoutes: Record<string, unknown>, emRoutes: Record<string, unknown>) {
    const jf = fakeFetch(jfRoutes);
    const em = fakeFetch(emRoutes);
    const jellyfin = new JellyfinClient(jfAuth, jf.impl);
    const emby = new EmbyClient(emAuth, em.impl);
    return { combined: new CombinedMedia([jellyfin, emby]), jf, em };
  }

  it("tags item ids with their server so equal ids cannot collide", async () => {
    const { combined } = both({ "/Items/Resume": { Items: [film("7", "Heat", { ProviderIds: {} })] } }, { "/Items/Resume": { Items: [film("7", "Alien", { ProviderIds: {} })] } });
    const items = await combined.resume();
    expect(items.map((i) => i.Id).sort()).toEqual(["emby~7", "jellyfin~7"]);
    expect(combined.key("emby~7")).toBe("emby:7");
    expect(combined.parseKey("jellyfin:7")).toBe("jellyfin~7");
    expect(combined.parseKey("plex:7")).toBeUndefined();
    expect(combined.kindOf("emby~7")).toBe("emby");
    expect(combined.rawId("emby~7")).toBe("7");
    const alien = items.find((i) => i.Name === "Alien")!;
    expect(combined.toTitleRef(alien).id).toBe("emby:7");
    expect(combined.toDetails(alien).id).toBe("emby:7");
  });

  it("sends each call to the server the id names", async () => {
    const { combined, jf, em } = both({ "/Items/7": film("7", "Heat") }, { "/Items/7": film("7", "Alien") });
    const item = await combined.item("emby~7");
    expect(item.Name).toBe("Alien");
    expect(em.calls.length).toBe(1);
    expect(jf.calls.length).toBe(0);
    expect(combined.streamUrl("jellyfin~7", "src")).toBe("http://jf:8096/Videos/7/stream?static=true&api_key=j&mediaSourceId=src");
    expect(() => combined.streamUrl("plex~7")).toThrow(/No connected media server/);
  });

  it("shows a film on both servers once, and keeps going when one is down", async () => {
    const { combined } = both({ "/Users/u/Items?": { Items: [film("1", "Heat")], TotalRecordCount: 1 } }, { "/Users/u/Items?": { Items: [film("9", "Heat")], TotalRecordCount: 1 } });
    const r = await combined.items({ type: "Movie" });
    expect(r.items.map((i) => i.Id)).toEqual(["jellyfin~1"]);
    expect(r.total).toBe(2);

    const down = new CombinedMedia([new JellyfinClient(jfAuth, fakeFetch({}).impl), new EmbyClient(emAuth, fakeFetch({ "/Items/Resume": { Items: [film("3", "Up")] } }).impl)]);
    expect((await down.resume()).map((i) => i.Id)).toEqual(["emby~3"]);
  });

  it("finds a title by TMDB id on whichever server has it", async () => {
    const idx = (id: string) => ({ "Recursive=true&IncludeItemTypes=Movie,Series": { Items: [film(id, "Matrix")] }, [`/Items/${id}`]: film(id, "Matrix") });
    const jf = fakeFetch({ "IncludeItemTypes=Movie,Series": { Items: [] } });
    const em = fakeFetch(idx("42"));
    const combined = new CombinedMedia([new JellyfinClient(jfAuth, jf.impl), new EmbyClient(emAuth, em.impl)]);
    expect(await combined.hasProviderId("tmdb", "603", "Movie")).toBe(true);
    expect((await combined.byProviderId("tmdb", "603", "Movie"))?.Id).toBe("emby~42");
  });

  it("tells every server about new files", async () => {
    const { combined, jf, em } = both({ "/Library/VirtualFolders": [], "/Library/Media/Updated": {} }, { "/Library/VirtualFolders": [], "/Library/Media/Updated": {} });
    const r = await combined.mediaUpdated(["/mnt/nas/Movies/x.mkv"]);
    expect(r.added).toBe(true);
    expect(r.note).toBe("Added to Jellyfin. Added to Emby");
    expect(jf.calls.some((c) => c.url.includes("/Library/Media/Updated"))).toBe(true);
    expect(em.calls.some((c) => c.url.includes("/Library/Media/Updated"))).toBe(true);
  });

  it("still routes Plex ids", () => {
    const plex = new PlexClient({ url: "http://p:32400", token: "t" }, fakeFetch({}).impl);
    const combined = new CombinedMedia([new JellyfinClient(jfAuth, fakeFetch({}).impl), plex]);
    expect(combined.parseKey("plex:99")).toBe("plex~99");
    expect(combined.kindOf("plex~99")).toBe("plex");
    expect(combined.name).toBe("Jellyfin + Plex");
  });
});

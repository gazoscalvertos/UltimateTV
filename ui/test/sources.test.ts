// Settings › Sources: the status lines say what to do next, and the typed addresses are tidied.
import { describe, expect, it } from "vitest";
import type { PublicSettings } from "@ultimatetv/shared";
import { canSetUpSources, cleanAddonUrl, cleanServerUrl, providerList, withAddon } from "../src/sources.js";

const empty = { iptv: [], addons: [], tmdb: false, torbox: false } as unknown as PublicSettings;
const by = (s: PublicSettings, id: string, ctx = {}) => providerList(s, ctx).find((p) => p.id === id)!;

describe("providerList", () => {
  it("says what to do next for everything that isn't set up", () => {
    expect(by(empty, "iptv").status).toBe("Not set up – press OK to add a playlist");
    expect(by(empty, "xtream").status).toBe("Not set up – press OK to add a login");
    expect(by(empty, "jellyfin").status).toBe("Not signed in – press OK to sign in");
    expect(by(empty, "plex").status).toBe("Not signed in – press OK to sign in");
    expect(by(empty, "addons").status).toBe("No add-ons yet – press OK to add one");
    expect(by(empty, "torbox").status).toBe("Not set up – press OK to add your key");
    expect(providerList(empty).filter((p) => !p.phoneOnly).every((p) => !p.ok)).toBe(true);
  });

  it("shows what is connected once it is", () => {
    const s = {
      ...empty,
      iptv: [
        { id: "a", kind: "m3u", name: "Playlist", connections: 1, host: "x" },
        { id: "b", kind: "xtream", name: "Provider", connections: 2, host: "y" },
      ],
      jellyfin: { url: "http://nas:8096", serverName: "Den" },
      plex: { url: "http://nas:32400" },
      addons: [{ url: "https://a.example", name: "AIOStreams" }],
      torbox: true,
    } as unknown as PublicSettings;
    expect(by(s, "iptv")).toMatchObject({ ok: true, status: "Playlist (1 connection)" });
    expect(by(s, "xtream")).toMatchObject({ ok: true, status: "Provider (2 connections)" });
    expect(by(s, "jellyfin")).toMatchObject({ ok: true, status: "Den" });
    expect(by(s, "plex")).toMatchObject({ ok: true, status: "Connected" });
    expect(by(s, "addons").status).toBe("AIOStreams");
    expect(by(s, "torbox").status).toBe("Connected");
  });

  it("calls the demo's channels what they are and counts the guide", () => {
    expect(by(empty, "iptv", { demo: true }).status).toBe("Demo channels");
    expect(by(empty, "guide", { channels: 1, programmes: 40 }).status).toBe("1 channel, 40 programmes");
  });

  it("gives every row an id, a label and a kind, so another provider is one more entry", () => {
    for (const p of providerList(empty)) expect(p.id && p.label && p.kind).toBeTruthy();
    expect(new Set(providerList(empty).map((p) => p.id)).size).toBe(providerList(empty).length);
  });
});

describe("canSetUpSources", () => {
  it("is for adult profiles only", () => {
    expect(canSetUpSources({ kind: "adult" })).toBe(true);
    expect(canSetUpSources({ kind: "kids" })).toBe(false);
    expect(canSetUpSources({ kind: "guest" })).toBe(false);
    expect(canSetUpSources(null)).toBe(false);
  });
});

describe("typed addresses", () => {
  it("turns stremio:// and bare hosts into https URLs", () => {
    expect(cleanAddonUrl("stremio://aio.example/abc/manifest.json")).toBe("https://aio.example/abc/manifest.json");
    expect(cleanAddonUrl(" aio.example/abc ")).toBe("https://aio.example/abc");
    expect(cleanAddonUrl("")).toBeNull();
  });

  it("gives a bare server address http://", () => {
    expect(cleanServerUrl("192.168.0.20:8096")).toBe("http://192.168.0.20:8096");
    expect(cleanServerUrl("https://jf.example/")).toBe("https://jf.example");
    expect(cleanServerUrl("  ")).toBeNull();
  });

  it("won't add the same add-on twice", () => {
    expect(withAddon(["https://a.example/x/manifest.json"], "https://A.example/x")).toBeNull();
    expect(withAddon(["https://a.example/x"], "https://b.example/y")).toEqual(["https://a.example/x", "https://b.example/y"]);
  });
});

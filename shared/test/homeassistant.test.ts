import { describe, expect, it } from "vitest";
import { cleanHaCommand, cleanHaSettings, cleanTvPlayState, haEvents, haState, type TvPlayState } from "../src/homeassistant.js";

const NOW = Date.UTC(2026, 9, 30, 20, 0, 0);
const gary = { id: "p1", name: "Gary", kind: "adult" as const };
const kids = { id: "p2", name: "Kids", kind: "kids" as const };
const film = { key: "jellyfin:abc", kind: "film" as const, title: "Dune", subtitle: "2021", positionMs: 61_000, durationMs: 9_360_000, credits: false };
const bbc1 = { key: "channel:bbc1", kind: "live" as const, title: "BBC One", subtitle: "EastEnders", channel: { id: "bbc1", number: 101, name: "BBC One" }, positionMs: 0, credits: false };
const bbc2 = { ...bbc1, key: "channel:bbc2", title: "BBC Two", subtitle: "Newsnight", channel: { id: "bbc2", number: 102, name: "BBC Two" } };
const state = (patch: Partial<TvPlayState> = {}): TvPlayState => ({ status: "playing", profile: gary, playing: film, volume: 100, muted: false, ...patch });
const types = (prev: TvPlayState | null, next: TvPlayState) => haEvents(prev, next, "UltimateTV", NOW).map((e) => e.type);

describe("Home Assistant playback events", () => {
  it("says a film started with what, who and where it's got to", () => {
    const [e] = haEvents(state({ status: "idle", playing: null }), state(), "GazosTV", NOW);
    expect(e).toEqual({ app: "GazosTV", type: "started", kind: "film", title: "Dune", subtitle: "2021", channel: null, profile: "Gary", kids: false, position: 61, duration: 9360, at: "2026-10-30T20:00:00.000Z" });
  });

  it("follows pause, resume, credits and stop", () => {
    const playing = state();
    const paused = state({ status: "paused" });
    expect(types(playing, paused)).toEqual(["paused"]);
    expect(types(paused, playing)).toEqual(["resumed"]);
    // Picking up after a pause through buffering is still a resume; buffering on its own is nothing.
    expect(types(paused, state({ status: "buffering" }))).toEqual(["resumed"]);
    expect(types(playing, state({ status: "buffering" }))).toEqual([]);
    const credits = state({ playing: { ...film, credits: true, positionMs: 9_000_000 } });
    expect(types(playing, credits)).toEqual(["credits"]);
    expect(types(credits, credits)).toEqual([]);
    const stopped = haEvents(credits, state({ status: "idle", playing: null }), "UltimateTV", NOW);
    expect(stopped).toMatchObject([{ type: "stopped", kind: "film", title: "Dune", position: 9000 }]);
  });

  it("calls channel hopping a channel change, not a stop and a start", () => {
    const [e] = haEvents(state({ playing: bbc1 }), state({ playing: bbc2 }), "UltimateTV", NOW);
    expect(e).toMatchObject({ type: "channel_changed", kind: "live", title: "BBC Two", channel: "BBC Two", from: "BBC One", position: 0, duration: null });
    // From live TV to a film is a stop and a start.
    expect(types(state({ playing: bbc1 }), state())).toEqual(["stopped", "started"]);
  });

  it("notices a profile switch, with Kids flagged", () => {
    const events = haEvents(state({ status: "idle", playing: null }), state({ status: "idle", playing: null, profile: kids }), "UltimateTV", NOW);
    expect(events).toMatchObject([{ type: "profile_switched", profile: "Kids", kids: true, from: "Gary" }]);
    // The TV's first report (nothing to compare with) isn't a switch.
    expect(types(null, state({ status: "idle", playing: null }))).toEqual([]);
  });
});

describe("the TV as a Home Assistant media player", () => {
  it("names things the way media_player does", () => {
    const ep = { key: "title:tmdb:tv:1|s2e5", kind: "episode" as const, title: "Slow Horses", subtitle: "S2 E5 · Cuckoo", season: 2, episode: 5, artwork: "/api/art/x.jpg", source: "TorBox", positionMs: 125_400, durationMs: 2_700_000, credits: false };
    const s = haState(state({ status: "paused", playing: ep, volume: 40 }), { reportedAt: NOW, connected: true, appName: "UltimateTV", hubBase: "http://hub:8095" });
    expect(s).toMatchObject({
      state: "paused",
      media_title: "S2 E5 · Cuckoo",
      media_series_title: "Slow Horses",
      media_content_type: "episode",
      media_season: 2,
      media_episode: 5,
      media_position: 125,
      media_duration: 2700,
      media_position_updated_at: "2026-10-30T20:00:00.000Z",
      entity_picture: "http://hub:8095/api/art/x.jpg",
      source: "TorBox",
      volume_level: 0.4,
      kind: "episode",
      profile: "Gary",
    });
    const live = haState(state({ playing: bbc1 }), { reportedAt: NOW, connected: true, appName: "UltimateTV" });
    expect(live).toMatchObject({ media_title: "EastEnders", media_channel: "BBC One", source: "BBC One", media_content_type: "channel", media_position: null, media_duration: null });
  });

  it("is off when the TV app isn't connected or the TV is in standby", () => {
    expect(haState(state(), { reportedAt: NOW, connected: false, appName: "UltimateTV" })).toMatchObject({ state: "off", media_title: null, connected: false });
    expect(haState(null, { reportedAt: null, connected: true, appName: "UltimateTV" }).state).toBe("off");
    expect(haState(state({ status: "idle", playing: null }), { reportedAt: NOW, connected: true, appName: "UltimateTV" }).state).toBe("idle");
  });
});

describe("cleaning what comes in", () => {
  it("keeps a sane state from the TV and drops what can't be passed on", () => {
    const s = cleanTvPlayState({ status: "playing", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: { key: "k", kind: "nonsense", title: "  Home  video ", positionMs: -5, artwork: "data:image/png;base64,AAAA" }, volume: 250 });
    expect(s).toEqual({ status: "playing", profile: gary, playing: { key: "k", kind: "video", title: "Home video", positionMs: 0, credits: false }, volume: 100, muted: false });
    expect(cleanTvPlayState({ status: "playing", playing: null, profile: null })?.status).toBe("idle");
    expect(cleanTvPlayState({ status: "dancing" })).toBeNull();
    expect(cleanTvPlayState("hello")).toBeNull();
  });

  it("takes Home Assistant's own service names and checks values", () => {
    expect(cleanHaCommand({ command: "media_pause" })).toEqual({ command: "pause" });
    expect(cleanHaCommand({ command: "media_next_track" })).toEqual({ command: "channel_up" });
    expect(cleanHaCommand({ command: "volume_set", value: 0.25 })).toEqual({ command: "volume_set", value: 0.25 });
    expect(cleanHaCommand({ command: "volume_set", value: 60 })).toEqual({ command: "volume_set", value: 0.6 });
    expect(cleanHaCommand({ command: "volume_mute", value: "false" })).toEqual({ command: "volume_mute", value: false });
    expect(cleanHaCommand({ command: "select_source", value: 101 })).toEqual({ command: "select_source", value: "101" });
    expect(cleanHaCommand({ command: "volume_set" })).toHaveProperty("error");
    expect(cleanHaCommand({ command: "select_source" })).toHaveProperty("error");
    expect(cleanHaCommand({ command: "rm -rf" })).toHaveProperty("error");
  });

  it("only takes web addresses for the webhook", () => {
    expect(cleanHaSettings({ webhookUrl: " http://ha.local:8123/api/webhook/tv " })).toEqual({ webhookUrl: "http://ha.local:8123/api/webhook/tv" });
    expect(cleanHaSettings({ webhookUrl: "file:///etc/passwd" }, { webhookUrl: "http://a/" })).toEqual({ webhookUrl: "http://a/" });
    expect(cleanHaSettings({ webhookUrl: "" }, { webhookUrl: "http://a/" })).toEqual({ webhookUrl: "" });
  });
});

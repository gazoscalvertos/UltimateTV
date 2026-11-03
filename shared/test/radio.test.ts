import { describe, expect, it } from "vitest";
import {
  cleanRadioSettings,
  DEFAULT_RADIO_SETTINGS,
  isStationOrder,
  sortStations,
  STATION_ORDERS,
  STATION_ORDER_NAMES,
  type RadioStation,
} from "../src/radio.js";

const station = (id: string, name: string, source: "preset" | "custom", kidsOnly = false): RadioStation => ({
  id,
  name,
  url: `http://stream.example/${id}`,
  source,
  ...(kidsOnly ? { kidsOnly: true } : {}),
});

// The presets' own running order matters: BBC first, then the commercial stations.
const STATIONS: RadioStation[] = [
  station("radio:bbc-1", "BBC Radio 1", "preset"),
  station("radio:bbc-2", "BBC Radio 2", "preset"),
  station("radio:fun-kids", "Fun Kids", "preset", true),
  station("radio:classic", "Classic FM", "preset"),
  station("custom:jazz", "Jazz FM", "custom"),
  station("custom:1", "1 FM", "custom"),
];

describe("the radio settings", () => {
  it("start the way the TV has always worked", () => {
    expect(DEFAULT_RADIO_SETTINGS).toEqual({
      keepAwake: false,
      onScreensaver: true,
      nowPlaying: true,
      showPodcasts: true,
      stationOrder: "presets",
    });
  });

  it("name every station order in plain words", () => {
    for (const order of STATION_ORDERS) expect(STATION_ORDER_NAMES[order]).toBeTruthy();
    expect(STATION_ORDER_NAMES.presets).toBe("As they come");
    expect(STATION_ORDER_NAMES.custom).toBe("Yours first");
    expect(STATION_ORDER_NAMES.name).toBe("By name");
  });

  it("only accept an order the TV knows", () => {
    expect(isStationOrder("presets")).toBe(true);
    expect(isStationOrder("custom")).toBe(true);
    expect(isStationOrder("name")).toBe(true);
    expect(isStationOrder("alphabetical")).toBe(false);
    expect(isStationOrder(undefined)).toBe(false);
    expect(isStationOrder(3)).toBe(false);
  });
});

describe("cleanRadioSettings", () => {
  it("leave everything alone when nothing is sent", () => {
    expect(cleanRadioSettings(undefined)).toEqual(DEFAULT_RADIO_SETTINGS);
    expect(cleanRadioSettings({})).toEqual(DEFAULT_RADIO_SETTINGS);
  });

  it("keep the switches that were sent", () => {
    const got = cleanRadioSettings({ keepAwake: true, onScreensaver: false, nowPlaying: false, showPodcasts: false });
    expect(got).toEqual({ keepAwake: true, onScreensaver: false, nowPlaying: false, showPodcasts: false, stationOrder: "presets" });
  });

  it("fall back rather than trust junk", () => {
    const got = cleanRadioSettings({
      keepAwake: "yes" as unknown as boolean,
      onScreensaver: 1 as unknown as boolean,
      nowPlaying: null as unknown as boolean,
      showPodcasts: undefined,
      stationOrder: "sideways" as never,
    });
    expect(got).toEqual(DEFAULT_RADIO_SETTINGS);
  });

  it("fall back to what the household already had, not the defaults", () => {
    const held = { keepAwake: true, onScreensaver: false, nowPlaying: false, showPodcasts: false, stationOrder: "name" as const };
    expect(cleanRadioSettings({ stationOrder: "custom" }, held)).toEqual({ ...held, stationOrder: "custom" });
    expect(cleanRadioSettings({ keepAwake: "maybe" as unknown as boolean }, held)).toEqual(held);
  });

  it("survive a settings file from before the radio had any", () => {
    expect(cleanRadioSettings({})).toEqual(DEFAULT_RADIO_SETTINGS);
  });
});

describe("sortStations", () => {
  it("leave the presets in their written order", () => {
    expect(sortStations(STATIONS, "presets").map((s) => s.id)).toEqual(STATIONS.map((s) => s.id));
  });

  it("put the household's own stations first, keeping both groups in order", () => {
    expect(sortStations(STATIONS, "custom").map((s) => s.name)).toEqual([
      "Jazz FM",
      "1 FM",
      "BBC Radio 1",
      "BBC Radio 2",
      "Fun Kids",
      "Classic FM",
    ]);
  });

  it("sort grown-ups' stations by name with the children's together at the top", () => {
    expect(sortStations(STATIONS, "name").map((s) => s.name)).toEqual([
      "Fun Kids",
      "1 FM",
      "BBC Radio 1",
      "BBC Radio 2",
      "Classic FM",
      "Jazz FM",
    ]);
  });

  it("just sort by name for a Kids profile, which only sees the children's ones", () => {
    const kids = [station("radio:z", "Zoo FM", "preset", true), station("radio:a", "Animal Radio", "preset", true)];
    expect(sortStations(kids, "name", true).map((s) => s.name)).toEqual(["Animal Radio", "Zoo FM"]);
  });

  it("ignore case when sorting by name", () => {
    const odd = [station("b", "banana", "preset"), station("a", "Apple", "preset"), station("c", "Cherry", "preset")];
    expect(sortStations(odd, "name").map((s) => s.name)).toEqual(["Apple", "banana", "Cherry"]);
  });

  it("not change the list it was given", () => {
    const before = STATIONS.map((s) => s.id);
    sortStations(STATIONS, "name");
    sortStations(STATIONS, "custom");
    expect(STATIONS.map((s) => s.id)).toEqual(before);
  });

  it("cope with no stations at all", () => {
    expect(sortStations([], "name")).toEqual([]);
    expect(sortStations([], "custom")).toEqual([]);
    expect(sortStations([], "presets")).toEqual([]);
  });
});

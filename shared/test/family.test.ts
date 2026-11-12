import { describe, expect, it } from "vitest";
import { binItems, binNotice, birthdayItems, cleanFamilySettings, DEFAULT_FAMILY_SETTINGS, familyConfigured, familySettingsView, parseBirthdayText, schoolItem, visibleItems, whenLabel, type FamilyItem } from "../src/family.js";

const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime(); // 2026-11-d, a Thursday on the 12th

const ev = (id: string, day: number, h: number, extra: Partial<FamilyItem> = {}): FamilyItem => ({ id, kind: "event", title: id, start: at(day, h), end: at(day, h + 1), allDay: false, kids: false, ...extra });

describe("bin schedule", () => {
  it("finds a weekly bin and lines up alternate weeks", () => {
    // Thursdays: the 12th, 19th, 26th.
    const weekly = binItems([{ id: "g", name: "Green bin", weekday: 4, everyWeeks: 1, from: "2026-11-05" }], "2026-11-12", 14);
    expect(weekly.map((i) => i.day)).toEqual(["2026-11-12", "2026-11-19", "2026-11-26"]);
    const fortnight = binItems([{ id: "b", name: "Blue bin", weekday: 4, everyWeeks: 2, from: "2026-11-19" }], "2026-11-12", 21);
    expect(fortnight.map((i) => i.day)).toEqual(["2026-11-19", "2026-12-03"]);
    const before = binItems([{ id: "b", name: "Blue bin", weekday: 4, everyWeeks: 2, from: "2026-10-29" }], "2026-11-12", 14);
    expect(before.map((i) => i.day)).toEqual(["2026-11-12", "2026-11-26"]);
  });
  it("says it on the day, and the evening before once it's late enough", () => {
    const items = binItems([{ id: "g", name: "Green bin", weekday: 5, everyWeeks: 1, from: "2026-11-13" }, { id: "r", name: "Recycling", weekday: 5, everyWeeks: 1, from: "2026-11-13" }], "2026-11-12", 3);
    expect(binNotice(items, at(12, 10), 17)).toBe("");
    expect(binNotice(items, at(12, 18), 17)).toBe("Green bin and Recycling out tonight");
    expect(binNotice(items, at(12, 18), 0)).toBe("");
    expect(binNotice(items, at(13, 7), 17)).toBe("Green bin and Recycling collected today");
  });
});

describe("birthdays and the school run", () => {
  it("lists the next birthdays with the age", () => {
    const list = birthdayItems([{ id: "m", name: "Maya", month: 11, day: 14, year: 2017 }, { id: "x", name: "Sam", month: 3, day: 1 }], "2026-11-12", 14);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Maya's birthday", day: "2026-11-14", detail: "Turns 9", kids: true });
  });
  it("shows the school run on school days until it has gone", () => {
    const s = { on: true, label: "School run", time: "08:15", days: [1, 2, 3, 4, 5] };
    expect(schoolItem(s, at(12, 7))).toMatchObject({ kind: "school", start: at(12, 8, 15) });
    expect(schoolItem(s, at(12, 9))).toBeNull();
    expect(schoolItem(s, at(14, 7))).toBeNull(); // a Saturday
    expect(schoolItem({ ...s, on: false }, at(12, 7))).toBeNull();
  });
  it("reads a birthday as it's typed", () => {
    expect(parseBirthdayText("14 March")).toEqual({ month: 3, day: 14 });
    expect(parseBirthdayText("14th Mar 2017")).toEqual({ month: 3, day: 14, year: 2017 });
    expect(parseBirthdayText("14/3")).toEqual({ month: 3, day: 14 });
    expect(parseBirthdayText("14/03/17")).toEqual({ month: 3, day: 14, year: 2017 });
    expect(parseBirthdayText("March 14")).toEqual({ month: 3, day: 14 });
    expect(parseBirthdayText("31 February")).toBeNull();
    expect(parseBirthdayText("soon")).toBeNull();
  });
});

describe("who sees what", () => {
  const items = [
    ev("work", 12, 20, { kids: false }),
    ev("swim", 12, 17, { kids: true }),
    ev("past", 12, 7, { kids: true }),
    ev("later", 15, 10, { kids: true }),
    ev("next-week", 25, 10),
    { id: "bin", kind: "bin", title: "Green bin", start: at(13), allDay: true, day: "2026-11-13", kids: true } as FamilyItem,
  ];
  const now = at(12, 12);
  it("gives adults everything coming, soonest first, and drops what has passed", () => {
    expect(visibleItems(items, now, "adult", { days: 7 }).map((i) => i.id)).toEqual(["swim", "work", "bin", "later"]);
  });
  it("keeps private events and anything past tomorrow off Kids, and at most three things", () => {
    expect(visibleItems(items, now, "kids").map((i) => i.id)).toEqual(["swim", "bin"]);
  });
  it("shows a Guest nothing", () => {
    expect(visibleItems(items, now, "guest")).toEqual([]);
  });
  it("limits the number and drops duplicates", () => {
    expect(visibleItems([...items, items[0]!], now, "adult", { limit: 2 })).toHaveLength(2);
  });
  it("words when an item is", () => {
    expect(whenLabel(items[1]!, now)).toBe("Today 17:00");
    expect(whenLabel(items[5]!, now)).toBe("Tomorrow");
    expect(whenLabel(items[3]!, now, true)).toBe("Sunday 10am");
  });
});

describe("settings", () => {
  it("cleans what was typed and keeps the token out of the view", () => {
    const s = cleanFamilySettings({
      calendars: [
        { id: "a", name: " Family ", kind: "ical", url: "webcal://example.com/f.ics", kids: true },
        { id: "b", name: "", kind: "ical", url: "javascript:alert(1)", kids: true },
        { id: "c", name: "Work", kind: "ha", entity: "calendar.Work", kids: false },
        { id: "d", name: "Bad", kind: "ha", entity: "sensor.nope", kids: false },
      ],
      ha: { url: "192.168.0.20:8123/", token: "abc" },
      birthdays: [{ id: "m", name: "Maya", month: 2, day: 30 }, { id: "n", name: "Nan", month: 2, day: 29, year: 1950 }],
      bins: { mode: "schedule", entities: ["sensor.green_bin", "nope"], eveningFrom: 99, rules: [{ id: "g", name: "Green", weekday: 9, everyWeeks: 7, from: "2026-11-05" }, { id: "h", name: "Bad", weekday: 1, everyWeeks: 1, from: "never" }] },
    });
    expect(s.calendars.map((c) => [c.name, c.url ?? c.entity])).toEqual([["Family", "https://example.com/f.ics"], ["Work", "calendar.work"]]);
    expect(s.ha).toEqual({ url: "http://192.168.0.20:8123", token: "abc" });
    expect(s.birthdays.map((b) => b.name)).toEqual(["Nan"]);
    expect(s.bins).toMatchObject({ mode: "schedule", entities: ["sensor.green_bin"], eveningFrom: 23 });
    expect(s.bins.rules).toEqual([{ id: "g", name: "Green", weekday: 6, everyWeeks: 1, from: "2026-11-05" }]);
    expect(JSON.stringify(familySettingsView(s))).not.toContain("abc");
    expect(familySettingsView(s).ha).toEqual({ url: "http://192.168.0.20:8123", tokenSet: true });
  });
  it("keeps the saved token when only the address changes, and clears it when asked", () => {
    const base = cleanFamilySettings({ ha: { url: "http://ha:8123", token: "t" } });
    expect(cleanFamilySettings({ ha: { url: "http://other:8123" } }, base).ha.token).toBe("t");
    expect(cleanFamilySettings({ ha: { token: "" } }, base).ha).toEqual({ url: "http://ha:8123", token: "" });
  });
  it("knows when there's anything to show", () => {
    expect(familyConfigured(DEFAULT_FAMILY_SETTINGS)).toBe(false);
    expect(familyConfigured(cleanFamilySettings({ school: { on: true } as never }))).toBe(true);
  });
});

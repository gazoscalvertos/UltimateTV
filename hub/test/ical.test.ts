import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/ical.js";

const wrap = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const opts = (from: string, to: string) => ({ from: Date.parse(from), to: Date.parse(to), kids: false, source: "c", detail: "Family" });

describe("iCal", () => {
  it("reads UTC, zoned and all-day events and drops cancelled ones", () => {
    const ics = wrap(
      "UID:1\r\nSUMMARY:Dentist\r\nDTSTART:20261113T091500Z\r\nDTEND:20261113T094500Z\r\nLOCATION:High St",
      "UID:2\r\nSUMMARY:Swimming\\, club\r\nDTSTART;TZID=Europe/London:20261112T173000\r\nDTEND;TZID=Europe/London:20261112T181500",
      "UID:3\r\nSUMMARY:Training day\r\nDTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261118",
      "UID:4\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nDTSTART:20261113T100000Z",
    );
    const out = parseIcs(ics, opts("2026-11-12T00:00:00Z", "2026-11-30T00:00:00Z"));
    expect(out.map((i) => i.title)).toEqual(["Dentist", "Swimming, club", "Training day", "Training day"]);
    expect(out[0]).toMatchObject({ start: Date.parse("2026-11-13T09:15:00Z"), end: Date.parse("2026-11-13T09:45:00Z"), detail: "High St", allDay: false });
    // 17:30 in London in November is 17:30 UTC; in summer it would be an hour earlier.
    expect(out[1]!.start).toBe(Date.parse("2026-11-12T17:30:00Z"));
    expect(out.slice(2).map((i) => i.day)).toEqual(["2026-11-16", "2026-11-17"]);
  });
  it("handles daylight saving in a zone", () => {
    const out = parseIcs(wrap("UID:s\r\nSUMMARY:Summer\r\nDTSTART;TZID=Europe/London:20260715T180000"), opts("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"));
    expect(out[0]!.start).toBe(Date.parse("2026-07-15T17:00:00Z"));
  });
  it("unfolds long lines", () => {
    const out = parseIcs(wrap("UID:f\r\nSUMMARY:A very long\r\n  title here\r\nDTSTART:20261113T100000Z"), opts("2026-11-12T00:00:00Z", "2026-11-30T00:00:00Z"));
    expect(out[0]!.title).toBe("A very long title here");
  });
  it("repeats weekly on chosen days, skipping exceptions and honouring edits", () => {
    const ics = wrap(
      "UID:w\r\nSUMMARY:Football\r\nDTSTART:20261102T160000Z\r\nDTEND:20261102T170000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8\r\nEXDATE:20261111T160000Z",
      "UID:w\r\nSUMMARY:Football (moved)\r\nRECURRENCE-ID:20261116T160000Z\r\nDTSTART:20261117T160000Z\r\nDTEND:20261117T170000Z",
    );
    const out = parseIcs(ics, opts("2026-11-09T00:00:00Z", "2026-11-23T00:00:00Z"));
    expect(out.map((i) => `${i.title} ${new Date(i.start).toISOString().slice(5, 10)}`)).toEqual(["Football 11-09", "Football 11-18", "Football (moved) 11-17"]);
  });
  it("repeats monthly by weekday and yearly, and stops at UNTIL", () => {
    const monthly = parseIcs(wrap("UID:m\r\nSUMMARY:Bins meeting\r\nDTSTART:20260908T190000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=2TU"), opts("2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"));
    expect(monthly.map((i) => new Date(i.start).toISOString().slice(0, 10))).toEqual(["2026-11-10", "2026-12-08"]);
    const yearly = parseIcs(wrap("UID:y\r\nSUMMARY:Anniversary\r\nDTSTART;VALUE=DATE:20150320\r\nRRULE:FREQ=YEARLY"), opts("2027-03-01T00:00:00Z", "2027-04-01T00:00:00Z"));
    expect(yearly.map((i) => i.day)).toEqual(["2027-03-20"]);
    const until = parseIcs(wrap("UID:u\r\nSUMMARY:Term\r\nDTSTART:20261110T080000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261112T080000Z"), opts("2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"));
    expect(until).toHaveLength(3);
  });
  it("ignores what it can't read", () => {
    expect(parseIcs("not a calendar", opts("2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))).toEqual([]);
    expect(parseIcs(wrap("UID:x\r\nSUMMARY:No start"), opts("2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z"))).toEqual([]);
  });
});

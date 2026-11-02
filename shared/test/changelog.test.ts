import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { householdChanges, parseChangelog, plainText, releaseLabel, unseenChanges } from "../src/index.js";

const SAMPLE = `# Changelog

Some words about the file.

## Updating

- **Hub**: run update.sh.

## 2026-10-30

- **Weather** ([docs/weather.md](docs/weather.md)): today's weather on Home, the
  temperature next to the clock. (#64)
  Household: Today's weather now sits next to the clock on Home.
- **Android client 0.2.1: Hub setup page opens straight away.** Settings › Hub setup page opens
  \`/api/pair/open\`. (#66)

## 2026-10-29

- **Cast and games** (\`/api/cast\`, [docs/casting-and-games.md](docs/casting-and-games.md)): AirPlay. (#60, #61)
  Household: You can send a video from a phone straight to the TV.
- Pop-ups on the TV: a doorbell, a meeting. (#39)

## 0.2.0 (2026-10-24)

The first install on the real box.

- Playback stats overlay (blue button). (#4)

## 0.1.0

The whole app.
`;

describe("changelog", () => {
  const log = parseChangelog(SAMPLE);

  it("reads dated and versioned sections, newest first, and skips the rest", () => {
    expect(log.releases.map((r) => r.id)).toEqual(["2026-10-30", "2026-10-29", "0.2.0", "0.1.0"]);
    expect(log.releases[2]).toMatchObject({ version: "0.2.0", date: "2026-10-24", note: "The first install on the real box." });
    expect(log.releases[3]).toMatchObject({ version: "0.1.0", note: "The whole app.", entries: [] });
    expect(log.latest).toBe("2026-10-30/weather");
  });

  it("splits each bullet into a title, plain text, PRs and its guide", () => {
    const [weather, android] = log.releases[0]!.entries;
    expect(weather).toEqual({ id: "2026-10-30/weather", title: "Weather", text: "Today's weather on Home, the temperature next to the clock.", prs: [64], doc: "docs/weather.md", household: "Today's weather now sits next to the clock on Home." });
    expect(android).toMatchObject({ title: "Android client 0.2.1: Hub setup page opens straight away", text: "Settings › Hub setup page opens /api/pair/open.", prs: [66] });
    const [cast, popups] = log.releases[1]!.entries;
    expect(cast).toMatchObject({ title: "Cast and games", text: "AirPlay.", prs: [60, 61], doc: "docs/casting-and-games.md" });
    expect(popups).toMatchObject({ title: "Pop-ups on the TV", text: "A doorbell, a meeting.", prs: [39] });
    expect(log.releases[2]!.entries[0]).toMatchObject({ title: "Playback stats overlay (blue button)", text: "", prs: [4] });
  });

  it("keeps ids unique when two changes share a title", () => {
    const twice = parseChangelog("## 2026-11-01\n\n- **Fix**: one.\n- **Fix**: two.\n");
    expect(twice.releases[0]!.entries.map((e) => e.id)).toEqual(["2026-11-01/fix", "2026-11-01/fix-2"]);
  });

  it("finds what's new since the entry an app last showed", () => {
    // Only the changes with a household summary are offered: the Android fix is internal.
    expect(unseenChanges(log, "2026-10-30/weather")).toEqual([]);
    expect(unseenChanges(log, "2026-10-30/android-client-0-2-1-hub-setup-page-opens-straig").map((e) => e.title)).toEqual(["Weather"]);
    expect(unseenChanges(log, "2026-10-29/cast-and-games").map((e) => e.title)).toEqual(["Weather"]);
    // Nothing stored yet: the newest day's household changes.
    expect(unseenChanges(log, null).map((e) => e.title)).toEqual(["Weather"]);
    // The entry it saw was reworded: everything dated after it.
    expect(unseenChanges(log, "2026-10-28/old-title").map((e) => e.title)).toEqual(["Weather", "Cast and games"]);
    expect(unseenChanges(log, "something-else")).toEqual([]);
    expect(unseenChanges({ releases: [] }, null)).toEqual([]);
  });

  it("lists every household change, newest first, for Settings and About", () => {
    expect(householdChanges(log).map((e) => e.id)).toEqual(["2026-10-30/weather", "2026-10-29/cast-and-games"]);
    // A day of internal work adds nothing for the household.
    expect(householdChanges(parseChangelog("## 2026-11-02\n\n- **A test**: guarded. (#1)\n"))).toEqual([]);
  });

  it("labels sections and strips Markdown", () => {
    expect(releaseLabel(log.releases[0]!)).toBe("30 Oct 2026");
    expect(releaseLabel(log.releases[2]!)).toBe("0.2.0 · 24 Oct 2026");
    expect(releaseLabel(log.releases[3]!)).toBe("0.1.0");
    expect(plainText("**Bold** and [a link](https://x) with `code`")).toBe("Bold and a link with code");
  });

  it("reads the repo's own CHANGELOG.md: every change has a title and a pull request", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const real = parseChangelog(readFileSync(path.resolve(here, "../../CHANGELOG.md"), "utf8"));
    const dated = real.releases.filter((r) => !r.version);
    expect(dated.length).toBeGreaterThan(5);
    // Newest first.
    expect(dated.map((r) => r.date)).toEqual([...dated.map((r) => r.date)].sort().reverse());
    for (const e of real.releases.flatMap((r) => r.entries)) {
      expect(e.title.length, e.id).toBeGreaterThan(2);
      expect(e.title.length, e.id).toBeLessThan(90);
      expect(e.title, e.id).not.toMatch(/[*`[\]]/);
      expect(e.prs.length, e.id).toBeGreaterThan(0);
    }
    expect(real.latest).toBeTruthy();
    // CHANGELOG.md is also what the TV shows after an update, so the newest entries must say
    // something the household understands (issue #111).
    const spoken = householdChanges(real);
    expect(spoken.length).toBeGreaterThan(5);
    for (const e of spoken) {
      expect(e.household!.length, e.id).toBeGreaterThan(10);
      expect(e.household!.length, e.id).toBeLessThan(200);
      expect(e.household, e.id).not.toMatch(/[*`[\]]/);
    }
    // Newest first.
    expect(spoken.map((e) => e.id)).toEqual([...spoken.map((e) => e.id)]);
  });
});

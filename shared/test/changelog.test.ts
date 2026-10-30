import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseChangelog, plainText, releaseLabel, unseenChanges } from "../src/index.js";

const SAMPLE = `# Changelog

Some words about the file.

## Updating

- **Hub**: run update.sh.

## 2026-10-30

- **Weather** ([docs/weather.md](docs/weather.md)): today's weather on Home, the
  temperature next to the clock. (#64)
- **Android client 0.2.1: Hub setup page opens straight away.** Settings › Hub setup page opens
  \`/api/pair/open\`. (#66)

## 2026-10-29

- **Cast and games** (\`/api/cast\`, [docs/casting-and-games.md](docs/casting-and-games.md)): AirPlay. (#60, #61)
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
    expect(weather).toEqual({ id: "2026-10-30/weather", title: "Weather", text: "Today's weather on Home, the temperature next to the clock.", prs: [64], doc: "docs/weather.md" });
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
    expect(unseenChanges(log, "2026-10-30/weather")).toEqual([]);
    expect(unseenChanges(log, "2026-10-29/cast-and-games").map((e) => e.title)).toEqual(["Weather", "Android client 0.2.1: Hub setup page opens straight away"]);
    // Nothing stored yet: the newest day.
    expect(unseenChanges(log, null).map((e) => e.title)).toEqual(["Weather", "Android client 0.2.1: Hub setup page opens straight away"]);
    // The entry it saw was reworded: everything dated after it.
    expect(unseenChanges(log, "2026-10-29/old-title")).toHaveLength(2);
    expect(unseenChanges(log, "something-else")).toEqual([]);
    expect(unseenChanges({ releases: [] }, null)).toEqual([]);
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
  });
});

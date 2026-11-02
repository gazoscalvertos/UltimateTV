// The phone remote's pages are plain HTML and JS served by the Hub, with no build step and no
// component tests, so this reads them the way the browser will: every Watch tab button has a view
// behind it, and the Saved tab is wired to the watchlist it shows. It is a small net, but it is
// the one that catches a chip added without its view (or the reverse) and a Saved tab that stops
// talking to /api/watchlist.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const html = readFileSync(path.join(root, "hub/public/remote/index.html"), "utf8");
const js = readFileSync(path.join(root, "hub/public/remote/phone.js"), "utf8");

/** The Watch tab's buttons, in page order. */
const chips = [...html.matchAll(/data-browse="([a-z-]+)"/g)].map((m) => m[1]!);
/** The views show() can open. A list can share a view (Films and TV do), so take every name show() matches on. */
const showBody = js.slice(js.indexOf("async function show(what)"), js.indexOf("async function showGuide"));
const views = [...showBody.matchAll(/what === "([a-z-]+)"/g)].map((m) => m[1]!);

describe("the phone remote's pages", () => {
  it("puts a button in the Watch tab for every list it can show, and a view behind every button", () => {
    // Fail loudly if either side was refactored out from under this test.
    expect(chips.length, "the Watch tab has lost its buttons: check hub/public/remote/index.html").toBeGreaterThan(5);
    expect(views.length, "show() no longer dispatches per list: check hub/public/remote/phone.js").toBeGreaterThan(5);
    expect(chips).toContain("queue");
    expect(views).toContain("queue");
    for (const chip of chips) expect(views, `the ${chip} button has no view in show()`).toContain(chip);
    for (const view of views) expect(chips, `show() can open ${view} but no button reaches it`).toContain(view);
  });

  it("has a Saved button after Queue, and a Saved view that reads the watchlist", () => {
    expect(chips.filter((c) => c === "saved")).toHaveLength(1);
    expect(chips.indexOf("saved"), "Saved belongs next to Queue").toBe(chips.indexOf("queue") + 1);
    const saved = js.slice(js.indexOf("async function showSaved"), js.indexOf("async function showRecordings"));
    expect(saved, "showSaved is missing: the Saved chip has nothing behind it").not.toBe("");
    expect(saved).toContain("/api/watchlist");
    expect(saved, "Play on TV should go through the TV, as the rest of the remote does").toContain("playOnTv(");
    expect(saved, "Add to queue should use the queue the remote already has").toContain("queueIt(");
    expect(saved, "Remove should delete from the watchlist").toMatch(/del\(\s*`?\/api\/watchlist/);
  });

  it("asks as the profile the TV is on, so Kids only see what they may watch", () => {
    const saved = js.slice(js.indexOf("async function showSaved"), js.indexOf("async function showRecordings"));
    expect(saved, "the list should be asked for as the TV's profile").toContain("savedFor()");
    const remove = saved.split("\n").find((line) => line.includes("/api/watchlist/"));
    expect(remove, "taking something off should name the same profile as the list").toMatch(/,\s*profile\)/);
    // An adult profile with a PIN can't be answered for without its token, so the household's list
    // is the honest answer there rather than the kids profile the Hub would fall back to.
    expect(js.slice(js.indexOf("async function savedFor"), js.indexOf("async function showRecordings"))).toContain("hasPin");
  });

  it("says on the row when a saved title is next on, and offers Record and Remind", () => {
    const saved = js.slice(js.indexOf("async function showSaved"), js.indexOf("async function showRecordings"));
    // The Hub works the airing out and sends it ready to show: "On Film4 · Sat 21:00".
    expect(saved, "the Saved row no longer shows the next airing").toContain("s.next");
    expect(saved, "the airing should be shown as the Hub words it").toMatch(/esc\(on\.when\)/);
    // One press records it or sets a reminder, through the routes the TV uses, so Kids limits and
    // the music-channel rule are applied by the Hub rather than by the phone.
    expect(saved, "Record should post the airing's programme").toMatch(/post\("\/api\/recordings",\s*\{\s*programmeId:\s*on\.programmeId\s*\}\)/);
    expect(saved, "Remind should post the airing's programme").toMatch(/post\("\/api\/reminders",\s*\{\s*programmeId:\s*on\.programmeId\s*\}\)/);
    // A title with nothing coming up keeps the row exactly as it was.
    expect(saved).toContain("Looking for it…");
  });

  it("hides the Saved tab when the household turns the list's features off", () => {
    const recordings = js.slice(js.indexOf("recordings: ["), js.indexOf("downloads: ["));
    expect(recordings, "the Saved button is not in the feature-off map").toContain('[data-browse="saved"]');
  });
});

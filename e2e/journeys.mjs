// The journeys a person actually does on the TV, pressed out with remote keys only. Each one gets
// its own Hub and its own browser, so a recording made by one can't change what another sees.

import { startHub } from "./hub.mjs";
import { startTv, until } from "./tv.mjs";

/** The text of the first match for `selector`, or "" while the screen is still drawing. */
const textOn = (tv, selector) =>
  tv.page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? "", selector);

/** Waits for the first match for `selector` to have text. */
const waitText = (tv, selector, what) => until(() => textOn(tv, selector), what);

/** Asks the Hub the same question the TV just asked, to prove the key press reached it. */
const api = async (tv, hub, path) => {
  const token = (await tv.page.context().cookies()).find((c) => c.name === "utv_device")?.value;
  const r = await fetch(hub.url(path), { headers: { "X-Device-Token": token } });
  if (!r.ok) throw new Error(`The Hub answered ${r.status} for ${path}`);
  return r.json();
};

/** What the guide has highlighted right now: its channel and its programme. */
const highlighted = (tv) =>
  tv.page.evaluate(() => ({
    title: document.querySelector(".gg-cell.selected .gg-cell-title")?.textContent?.trim() ?? "",
    number: document.querySelector(".gg-row-active .gg-number")?.textContent?.trim() ?? "",
    channel: document.querySelector(".gg-row-active .gg-name")?.textContent?.trim() ?? "",
    onNow: !!document.querySelector(".gg-cell.selected.gg-on-now"),
  }));

/** Waits for the guide's grid to take the remote, which is what makes the next key do anything. */
const waitForGuideKeys = (tv) =>
  until(() => tv.page.evaluate(() => document.activeElement?.classList.contains("guide-grid") ?? false), "the guide to take the remote");

/** Signs a fresh screen in as the named profile, and gets the what's-new pop-up out of the way. */
async function asProfile(tv, name) {
  await tv.at("choosing a profile").waitForScreen("profiles");
  await tv.at(`picking ${name}`).pickProfile(name);
  await tv.at("the Home screen").waitForScreen("home");
  await tv.at("dismissing what's new").dismissWhatsNew();
  await tv.waitForScreen("home");
}

export const journeys = [
  {
    name: "pick a profile",
    why: "The first thing on the TV: who's watching, and Home follows.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        await tv.at("the profiles screen").waitForScreen("profiles");
        const names = await tv.page.evaluate(() =>
          [...document.querySelectorAll("button.profile .profile-name")].map((e) => e.textContent?.trim() ?? ""),
        );
        if (!names.includes("Family")) throw new Error(`The profiles screen listed ${JSON.stringify(names)}, not Family`);

        await tv.at("picking Family").pickProfile("Family");
        await tv.at("the Home screen").waitForScreen("home");
        // Adults get the what's-new dialog on their first visit, and it must be dismissable by Back.
        const announced = await tv.page.evaluate(() => document.querySelector(".whatsnew-dialog") !== null);
        await tv.at("dismissing what's new").dismissWhatsNew();

        const hero = await until(
          () =>
            tv.page.evaluate(
              () => (document.querySelector(".hero-title")?.textContent?.trim() || document.querySelector(".hero-logo")?.getAttribute("alt") || "").trim(),
            ),
          "a title in Home's hero",
        );
        const button = await waitText(tv, ".hero-actions button", "Home's hero button");
        if (!/Resume|Watch/.test(button)) throw new Error(`Home's first button said "${button}", not Resume or Watch`);
        const rails = await tv.page.evaluate(() => document.querySelectorAll("section.rail").length);
        if (rails === 0) throw new Error("Home drew no rails under the hero");
        tv.clean();
        return `picked Family (what's new ${announced ? "was shown and closed" : "was already seen"}), Home showed “${hero}” with a “${button.replace(/[^A-Za-z ]/g, "").trim()}” button and ${rails} rails`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("pick a profile", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },

  {
    name: "tune a channel from the guide",
    why: "The guide is the main way people find something to watch, and tuning has to work from it.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        await asProfile(tv, "Family");

        // Green is the guide, as on Sky.
        await tv.at("opening the guide with green").press("green");
        await tv.at("the guide screen").waitForScreen("guide");
        await waitForGuideKeys(tv);
        const first = await highlighted(tv);
        if (!first.title) throw new Error("The guide had nothing highlighted");
        if (!first.onNow) throw new Error(`The guide started on “${first.title}”, which isn't on now`);

        // OK on what's on now tunes it.
        await tv.at(`tuning ${first.title}`).press("ok");
        await tv.at("the player").waitForScreen("player");
        const banner = await waitText(tv, ".banner-title", "the channel's programme name");
        const number = await textOn(tv, ".banner-number");
        if (!banner) throw new Error("Live TV started but the banner named no programme");
        if (!/^\d+$/.test(number)) throw new Error(`The banner said the channel number was "${number}"`);
        tv.clean();
        return `tuned channel ${number} (${banner}) straight from the guide`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("tune a channel from the guide", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },

  {
    name: "record a programme",
    why: "Recording is what the box is for. It also proves a key press reaches the Hub, not just the screen.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        await asProfile(tv, "Family");
        await tv.at("opening the guide").press("green");
        await tv.at("the guide screen").waitForScreen("guide");
        await waitForGuideKeys(tv);

        // A film records in one press, so this journey is about the key reaching the Hub.
        await tv.at("jumping to the film channel");
        await tv.press("digit3");
        await tv.press("digit0");
        await tv.press("digit1");
        const film = await until(async () => {
          const h = await highlighted(tv);
          return h.number === "301" && h.title ? h : null;
        }, "the guide to jump to channel 301");

        await tv.at(`recording ${film.title}`).press("red");
        await tv.at("the recording to be accepted").waitForToast("Recording");
        const { recordings } = await api(tv, hub, "/api/recordings");
        const made = recordings.find((r) => r.programme?.title === film.title);
        if (!made) throw new Error(`The Hub has no recording of "${film.title}": it has ${JSON.stringify(recordings.map((r) => r.programme?.title))}`);
        if (made.status === "failed" || made.status === "cancelled") throw new Error(`"${film.title}" was recorded as ${made.status}`);
        tv.clean();
        return `recorded “${film.title}” on channel 301 from the guide; the Hub has it as ${made.status}`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("record a programme", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },

  {
    name: "set a series link",
    why: "A series link is the slowest path through the UI — red, a dialog, and a choice — so it catches dropped keys.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        await asProfile(tv, "Family");
        await tv.at("opening the guide").press("green");
        await tv.at("the guide screen").waitForScreen("guide");
        await waitForGuideKeys(tv);
        const show = await until(async () => {
          const h = await highlighted(tv);
          return h.title && h.title !== "Starfall" ? h : null;
        }, "a programme highlighted in the guide");

        // Red on a series asks whether to make a series link; the first choice is "Series link".
        await tv.at(`asking to record ${show.title}`).press("red");
        const title = await until(() => tv.dialogTitle(), "the series-link dialog");
        const options = await tv.dialogOptions();
        if (!options.some((o) => /series link/i.test(o))) {
          throw new Error(`Recording “${show.title}” offered ${JSON.stringify(options)}, not a series link (the guide picked a film?)`);
        }

        await tv.at("choosing Series link").press("ok");
        await tv.at("the series link to be accepted").waitForToast("Series linked");
        const { seriesLinks } = await api(tv, hub, "/api/series-links");
        const made = seriesLinks.find((l) => l.title === title || l.title === show.title);
        if (!made) throw new Error(`The Hub has no series link for "${title}": it has ${JSON.stringify(seriesLinks.map((l) => l.title))}`);
        tv.clean();
        return `series-linked “${made.title}” through the “${options.join(" / ")}” dialog`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("set a series link", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },

  {
    name: "play a film from Home and resume it",
    why: "Resuming is the most-used thing on the box, and it is where the player and the progress store meet.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        await asProfile(tv, "Family");

        // The demo leaves Copper Sky part-watched, so Home's hero offers Resume.
        const button = await waitText(tv, ".hero-actions button", "Home's hero button");
        if (!/Resume/.test(button)) throw new Error(`Home's hero offered "${button}", not Resume`);
        await tv.at("pressing Resume").press("ok");
        await tv.at("the player").waitForScreen("player");

        const title = await waitText(tv, ".osd-title h2", "the film's name in the player");
        // The demo has it at 48 of 128 minutes; the player must pick that up rather than start at 0.
        const shown = await waitText(tv, ".osd-time", "how far into the film it is");
        const mins = shown.includes(":") ? Number(shown.split(":")[0]) : NaN;
        if (!(mins >= 47 && mins <= 51)) throw new Error(`“${title}” resumed at ${shown}, not around 48 minutes`);
        tv.clean();
        return `resumed “${title}” at ${shown}`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("play a film from Home and resume it", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },

  {
    name: "Kids can't reach Settings",
    why: "Kids must not be able to change the house's settings, and the tab they'd use must not be there at all.",
    async run() {
      const hub = await startHub();
      const tv = await startTv(hub);
      try {
        // Picked from the profiles screen, which is where a kids' profile really starts.
        await tv.at("the profiles screen").waitForScreen("profiles");
        await tv.at("picking Kids").pickProfile("Kids");
        await tv.at("the Home screen").waitForScreen("home");
        await tv.at("dismissing what's new").dismissWhatsNew();
        await tv.waitForScreen("home");

        const tabs = await tv.tabs();
        if (tabs.includes("Settings")) throw new Error(`The Kids profile has a Settings tab: ${JSON.stringify(tabs)}`);

        // Nor by walking there: the top bar must never land on one either.
        await tv.at("walking the top bar").press("up");
        const seen = [];
        for (let i = 0; i < 14; i++) {
          const where = await tv.focusText();
          seen.push(where.replace(/\s+/g, " ").trim());
          if (/^settings$/i.test(where.trim())) throw new Error(`The Kids top bar reached Settings: ${JSON.stringify(seen)}`);
          await tv.press("right");
        }
        // Pressing right past the last item stops on it (the profile), not in the screen below.
        const end = await tv.page.evaluate(() => ({
          inBar: !!document.activeElement?.closest(".topbar"),
          avatar: !!document.activeElement?.classList.contains("avatar"),
        }));
        if (!end.inBar || !end.avatar) throw new Error(`Right past the end of the top bar left it: ${JSON.stringify(seen)}`);
        // A Kids profile is a different app: the tab is gone, not merely behind a PIN.
        tv.clean();
        return `the Kids profile has ${tabs.length} tabs (${tabs.filter(Boolean).join(", ")}) and none is Settings; right stops on the profile`;
      } catch (err) {
        // A screenshot of the screen that failed, and the page's own view of it, for CI to upload.
        await tv.failed("Kids can't reach Settings", err).catch(() => {});
        throw err;
      } finally {
        await tv.close();
        await hub.stop();
      }
    },
  },
];

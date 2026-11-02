// The phone's settings page (/setup/) is meant to be everything the TV's Settings is, so a household
// can be set up from a phone. Alerts were the one panel missing, and nothing noticed because the page
// is a single HTML file with no test of its own. This reads the file and checks the Alerts section is
// wired to the endpoints that exist, so the next person adding a panel has a pattern to copy.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "@ultimatetv/shared";
// @ts-expect-error -- a plain node script: it has no types, and hub/test isn't in the build.
import { audit } from "../../tools/hub/route-auth.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const page = readFileSync(path.join(root, "hub/public/setup/index.html"), "utf8");
const routes = new Set(audit(root).routes.map((r: { key: string }) => r.key));

const section = (id: string): string => {
  const start = page.indexOf(`<section id="${id}"`);
  expect(start, `no <section id="${id}"> in the setup page`).toBeGreaterThan(-1);
  const end = page.indexOf("</section>", start);
  return page.slice(start, end);
};

describe("the phone's settings page", () => {
  it("has an Alerts section, reachable from the jump nav", () => {
    expect(section("alerts")).toContain("<h2>Alerts");
    expect(page).toContain('<a href="#alerts">Alerts</a>');
  });

  it("offers every setting the TV's Alerts panel offers", () => {
    const alerts = section("alerts");
    // A field per AlertSettings key: the two addresses as text inputs, the rest as controls.
    expect(alerts).toContain('name="webhookUrl"');
    expect(alerts).toContain('name="ntfyUrl"');
    for (const key of Object.keys(DEFAULT_ALERT_SETTINGS).filter((k) => k !== "webhookUrl" && k !== "ntfyUrl")) {
      expect(alerts, `${key} is on the TV but not on the phone`).toContain(`data-al="${key}"`);
    }
  });

  it("shows what the Hub is worried about, not just the settings", () => {
    const alerts = section("alerts");
    expect(alerts).toContain('id="al-list"');
    // The list is filled from a state the page has to ask for.
    expect(page).toContain('api("/api/alerts")');
  });

  it("calls only routes that exist", () => {
    for (const key of ["GET /api/alerts", "PUT /api/alerts/settings", "POST /api/alerts/check", "POST /api/alerts/test"]) {
      expect(routes.has(key), `${key} is missing from the routes table`).toBe(true);
    }
    expect(page).toContain('api("/api/alerts/check", { method: "POST" })');
    expect(page).toContain('api("/api/alerts/test", { method: "POST" })');
    expect(page).toContain('api("/api/alerts/settings", { method: "PUT"');
  });
});

describe("the backup section of the phone's settings page", () => {
  it("shows the second copy, not just the one on the NAS", () => {
    const backup = section("backup");
    // Room for the second destination's own line, filled from the state the page asks for.
    expect(backup).toContain('id="backup-offsite"');
    const script = page.slice(page.indexOf("async function loadBackup"));
    // It reads the second copy out of the state, and says where it goes and how it went.
    expect(script).toContain("b.offsite");
    expect(script).toContain("off.target");
    expect(script).toContain("off.keepDays");
    expect(script).toContain("off.keepWeeks");
  });

  it("can restore a copy that is only in the second place", () => {
    // The NAS copy is tried first, so a copy that has gone from there is fetched from the second one.
    expect(page).toContain('from: "offsite"');
    expect(page).toContain("Only in the second copy");
    expect(page).toContain('api("/api/backup/restore", { method: "POST"');
    expect(routes.has("POST /api/backup/restore")).toBe(true);
  });
});

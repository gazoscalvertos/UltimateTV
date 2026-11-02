// Reminders, end to end (issue: they were write-only — a reminder could be set but there was no
// list of them anywhere, so taking one back meant finding the programme in the guide again).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuideWindow, Programme, Reminder } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-reminders-"));
  const config: HubConfig = {
    port: 8095,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    remoteDir: new URL("../public/remote", import.meta.url).pathname,
    mediaRoot: path.join(tmp, "media"),
    demo: true,
  };
  app = await buildServer(config, {
    systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcEncode: false, hevc10Encode: false } }) as never,
  });
  await pairAsTv(app);
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

/** A programme that is on later today, from the demo guide. */
async function laterProgramme(): Promise<Programme> {
  const now = Date.now();
  const g = (await app.inject(`/api/guide?from=${now}&to=${now + 12 * 3_600_000}`)).json<GuideWindow>();
  for (const list of Object.values(g.programmes)) {
    const p = list.find((x) => x.start > now + 10 * 60_000);
    if (p) return p;
  }
  throw new Error("the demo guide has nothing coming up");
}

describe("reminders through the API", () => {
  it("sets one, lists it, and takes it back", async () => {
    const p = await laterProgramme();
    const made = await app.inject({ method: "POST", url: "/api/reminders", payload: { programmeId: p.id } });
    expect(made.statusCode).toBe(200);
    expect(made.json<Reminder>()).toMatchObject({ id: p.id, channelName: expect.any(String) });

    const listed = (await app.inject("/api/recordings")).json<{ reminders: Reminder[] }>();
    expect(listed.reminders.map((r) => r.id)).toContain(p.id);

    expect((await app.inject({ method: "DELETE", url: `/api/reminders/${encodeURIComponent(p.id)}` })).statusCode).toBe(200);
    const after = (await app.inject("/api/recordings")).json<{ reminders: Reminder[] }>();
    expect(after.reminders.map((r) => r.id)).not.toContain(p.id);
  });

  it("says on the programme that a reminder is set", async () => {
    const p = await laterProgramme();
    await app.inject({ method: "POST", url: "/api/reminders", payload: { programmeId: p.id } });
    const info = (await app.inject(`/api/programmes/${encodeURIComponent(p.id)}`)).json<{ reminder: boolean }>();
    expect(info.reminder).toBe(true);
    await app.inject({ method: "DELETE", url: `/api/reminders/${encodeURIComponent(p.id)}` });
  });

  it("refuses to set two for the same programme", async () => {
    const p = await laterProgramme();
    await app.inject({ method: "POST", url: "/api/reminders", payload: { programmeId: p.id } });
    await app.inject({ method: "POST", url: "/api/reminders", payload: { programmeId: p.id } });
    const listed = (await app.inject("/api/recordings")).json<{ reminders: Reminder[] }>();
    expect(listed.reminders.filter((r) => r.id === p.id)).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/reminders/${encodeURIComponent(p.id)}` });
  });
});

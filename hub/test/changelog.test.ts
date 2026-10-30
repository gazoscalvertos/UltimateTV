// What's new: the Hub serves the CHANGELOG.md it was built with.

import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Changelog } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;

const options = (extra: object = {}) => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false, ...extra });
const start = async (extra: object = {}) => {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, ytdlp: null });
  app = (await buildServer(options(extra), { systemReport: async () => ({}) as never, context })) as never;
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-changelog-"));
});

afterEach(async () => {
  await app?.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("GET /api/changelog", () => {
  it("serves the repo's CHANGELOG.md by default, without pairing", async () => {
    await start();
    const res = await app.inject("/api/changelog");
    expect(res.statusCode).toBe(200);
    const log = res.json<Changelog>();
    expect(log.releases.length).toBeGreaterThan(3);
    expect(log.latest).toBe(log.releases[0]!.entries[0]!.id);
    expect(log.releases.some((r) => r.version === "0.2.0")).toBe(true);
  });

  it("reads the file again when it changes, and limits the sections", async () => {
    const file = path.join(tmp, "CHANGELOG.md");
    await writeFile(file, "## 2026-10-30\n\n- **First**: one. (#1)\n\n## 2026-10-29\n\n- **Older**: two. (#2)\n");
    await start({ changelogPath: file });
    expect((await app.inject("/api/changelog")).json<Changelog>().latest).toBe("2026-10-30/first");
    const one = (await app.inject("/api/changelog?limit=1")).json<Changelog>();
    expect(one.releases.map((r) => r.id)).toEqual(["2026-10-30"]);

    await writeFile(file, "## 2026-10-31\n\n- **Newer**: three. (#3)\n");
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    expect((await app.inject("/api/changelog")).json<Changelog>().latest).toBe("2026-10-31/newer");
  });

  it("says what an app hasn't shown yet", async () => {
    const file = path.join(tmp, "CHANGELOG.md");
    await writeFile(file, "## 2026-10-30\n\n- **First**: one. (#1)\n- **Second**: two. (#2)\n\n## 2026-10-29\n\n- **Older**: three. (#3)\n");
    await start({ changelogPath: file });
    const titles = async (q: string) => (await app.inject(`/api/changelog${q}`)).json<Changelog>().unseen?.map((e) => e.title);
    expect(await titles("")).toBeUndefined();
    expect(await titles("?seen=")).toEqual(["First", "Second"]);
    expect(await titles("?seen=2026-10-29/older")).toEqual(["First", "Second"]);
    expect(await titles("?seen=2026-10-30/second")).toEqual(["First"]);
    expect(await titles("?seen=2026-10-30/first")).toEqual([]);
  });

  it("answers with nothing when the file is missing", async () => {
    await start({ changelogPath: path.join(tmp, "nope.md") });
    expect((await app.inject("/api/changelog")).json()).toEqual({ releases: [] });
  });
});

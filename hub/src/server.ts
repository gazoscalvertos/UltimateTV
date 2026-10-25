import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import QRCode from "qrcode";
import type { BoxState, Certification, Channel, ChannelCategory, GuideChoices, GuideWindow, HubStatus, IptvSource, PlaybackRequest, ProfileKind, ProgrammeMark, Settings, TitleRef } from "@ultimatetv/shared";
import { renderMatrix, validateReport, type ProbeReport } from "@ultimatetv/shared";
import { listClips } from "./clips.js";
import type { HubConfig } from "./config.js";
import { ConnectionBusyError } from "./connections.js";
import { HubContext } from "./context.js";
import { demoArt, seedDemo } from "./demo.js";
import { BoxReportStore, cleanBoxReport, renderDiagnostics, RollingFile, type LogRing } from "./diagnostics.js";
import { Library, NotAllowedError } from "./library.js";
import type { Logger } from "./log.js";
import { Playback, PlaybackError, episodeNumbers } from "./playback.js";
import { ContentFilter } from "./profiles.js";
import { ReportStore } from "./reports.js";
import { JellyfinClient } from "./services/jellyfin.js";
import { publicSettings, sourceKey } from "./settings.js";
import { SelfUpdate } from "./selfupdate.js";
import { sendFile } from "./streaming.js";
import { systemReport, type SystemReport } from "./system.js";
import { parseVoice } from "./voice.js";

export interface ServerDeps {
  /** Overridable in tests so they don't shell out to ffmpeg/vainfo. */
  systemReport?: () => Promise<SystemReport>;
  logger?: boolean;
  /** Keeps the Hub's recent log lines for /api/diagnostics (with `logger`). */
  logRing?: LogRing;
  context?: HubContext;
  env?: NodeJS.ProcessEnv;
}

export const HUB_VERSION = "0.2.0";
/** The commit and date the Hub was built from (set by tools/hub/update.sh through the Docker build). */
export const HUB_BUILD = { commit: process.env.GIT_COMMIT || undefined, date: process.env.BUILD_DATE || undefined };

type Req<P = Record<string, string>, Q = Record<string, string | undefined>, B = unknown> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;

export async function buildServer(config: HubConfig, deps: ServerDeps = {}): Promise<FastifyInstance & { hub: HubContext }> {
  // With a log ring the logger runs at LOG_LEVEL (debug by default): the rolling file in
  // data/logs gets everything, docker logs info and up.
  const app = Fastify({ logger: deps.logger ? (deps.logRing ? { level: deps.env?.LOG_LEVEL ?? "debug", stream: deps.logRing.stream } : true) : false, bodyLimit: 2 * 1024 * 1024 });
  const log: Logger = app.log;
  const ctx = deps.context ?? new HubContext({ dataDir: config.dataDir, mediaRoot: config.mediaRoot, env: deps.env ?? {}, log });
  if (config.demo) seedDemo(ctx, config);
  const library = new Library(ctx);
  const playback = new Playback(ctx, library);
  const reports = new ReportStore(path.join(config.dataDir, "probe-reports"));
  const getSystem = deps.systemReport ?? systemReport;
  app.addHook("onClose", async () => ctx.close());

  /** TV apps listening on the event socket: the phone's box controls need one. */
  let tvSockets = 0;
  const hubBase = (req: FastifyRequest) => config.publicUrl ?? `${req.protocol}://${req.headers.host ?? `${req.hostname}:${config.port}`}`;
  const setupUrl = (req: FastifyRequest) => `${hubBase(req)}/setup/`;

  // Who's asking: the TV sends its profile (and a token once a PIN has been entered); the phone
  // setup page sends just a token after asking for a PIN.
  const viewer = (req: FastifyRequest) => {
    const header = (name: string) => {
      const v = req.headers[name];
      return typeof v === "string" && v ? v : undefined;
    };
    const who = ctx.profiles.resolve(header("x-profile"), header("x-profile-token"));
    return { ...who, filter: new ContentFilter(who.profile) };
  };
  const filterOf = (req: FastifyRequest) => viewer(req).filter;
  /** Anything that changes the household's setup or deletes things needs an adult (and the PIN once it's set). */
  const ADMIN_ROUTES = new Set([
    "PUT /api/settings",
    "POST /api/settings/iptv",
    "DELETE /api/settings/iptv/:id",
    "POST /api/refresh",
    "POST /api/jellyfin/quickconnect",
    "POST /api/jellyfin/login",
    "DELETE /api/jellyfin",
    "PATCH /api/channels/:id",
    "DELETE /api/recordings/:id",
    "PATCH /api/series-links/:id",
    "DELETE /api/series-links/:id",
    "POST /api/profiles",
    "PATCH /api/profiles/:id",
    "DELETE /api/profiles/:id",
    "POST /api/guides",
    "PATCH /api/guides/:id",
    "DELETE /api/guides/:id",
    "POST /api/downloads",
    "DELETE /api/downloads/:id",
    "POST /api/software/hub/update",
    "POST /api/box/update",
  ]);
  app.addHook("preHandler", async (req) => {
    if (ADMIN_ROUTES.has(`${req.method} ${req.routeOptions.url}`) && !viewer(req).admin) {
      throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PlaybackError) return reply.code(err.code === "busy" ? 409 : err.code === "not-found" ? 404 : 422).send({ error: err.message, code: err.code, recordings: err.recordings });
    if (err instanceof ConnectionBusyError) return reply.code(409).send({ error: err.message, code: "busy", recordings: err.blockingRecordings });
    if (err instanceof NotAllowedError) return reply.code(403).send({ error: err.message, code: "profile" });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error({ err: String(err) }, "Request failed");
    const code = (err as { code?: unknown }).code;
    return reply.code(status).send({ error: err instanceof Error ? err.message : String(err), ...(code === "pin" ? { code } : {}) });
  });

  // -------------------------------------------------------------------------
  // Health, status, probes

  app.get("/api/health", async () => ({ ok: true, version: HUB_VERSION, ...HUB_BUILD }));
  app.get("/api/system", async () => getSystem());
  app.get("/api/clips", async () => ({ clips: await listClips(config.clipsDir) }));

  // Diagnostics: the box reports its log, playback samples and screen details here.
  const logsDir = path.join(config.dataDir, "logs");
  const logFiles = { hub: new RollingFile(path.join(logsDir, "hub.log")), box: new RollingFile(path.join(logsDir, "box.log")), playback: new RollingFile(path.join(logsDir, "playback.jsonl")) };
  const boxReports = new BoxReportStore(path.join(config.dataDir, "diagnostics"), logFiles);
  await boxReports.load();
  app.post("/api/diagnostics/box", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const report = cleanBoxReport(req.body);
    if (!report) return reply.code(400).send({ error: "Not a box report" });
    await boxReports.save(report, req.ip);
    return { ok: true };
  });
  // The rolling logs on disk: hub, box or playback, the last `lines` lines (500 by default).
  app.get("/api/diagnostics/logs/:name", async (req: Req<{ name: string }, { lines?: string }>, reply) => {
    const file = logFiles[req.params.name as keyof typeof logFiles];
    if (!file) return reply.code(404).send({ error: "Logs are hub, box or playback" });
    const lines = Math.min(Math.max(Number(req.query.lines) || 500, 1), 50_000);
    return reply.type("text/plain; charset=utf-8").send(`${(await file.tail(lines)).join("\n")}\n`);
  });
  app.get("/api/diagnostics", async (req: Req<Record<string, string>, { format?: string }>, reply) => {
    const hub = { version: HUB_VERSION, ...(HUB_BUILD.commit ? { commit: HUB_BUILD.commit } : {}), ...(HUB_BUILD.date ? { builtAt: HUB_BUILD.date } : {}), uptimeS: Math.round(process.uptime()), log: deps.logRing?.list() ?? [] };
    if (req.query.format === "text") return reply.type("text/plain; charset=utf-8").send(renderDiagnostics(hub, boxReports.get()));
    return { hub, box: boxReports.get() };
  });

  app.get("/api/status", async (): Promise<HubStatus> => {
    const s = ctx.settings.get();
    const status: HubStatus = {
      version: HUB_VERSION,
      ...(HUB_BUILD.commit ? { commit: HUB_BUILD.commit } : {}),
      ...(HUB_BUILD.date ? { builtAt: HUB_BUILD.date } : {}),
      demo: config.demo,
      channels: ctx.channels.count(),
      programmes: ctx.guide.count(),
      connections: ctx.guard.status(),
      recordingNow: ctx.recordings.withStatus("recording"),
      configured: { iptv: s.iptv.length > 0 || config.demo, jellyfin: Boolean(s.jellyfin), tmdb: Boolean(s.tmdbApiKey), addons: s.addonUrls.length > 0, torbox: Boolean(s.torboxApiKey) },
    };
    const epg = ctx.db.getKv<number>("epgUpdatedAt");
    if (epg) status.epgUpdatedAt = epg;
    const src = ctx.db.getKv<number>("sourcesUpdatedAt");
    if (src) status.sourcesUpdatedAt = src;
    try {
      const fs = await statfs(s.library.recordingsPath).catch(() => statfs(path.dirname(s.library.recordingsPath)));
      status.diskFreeBytes = fs.bavail * fs.bsize;
      status.diskTotalBytes = fs.blocks * fs.bsize;
    } catch {
      // The NAS isn't mounted (development).
    }
    return status;
  });

  app.get("/api/probe-reports", async () => ({ reports: await reports.list() }));
  app.post("/api/probe-reports", async (request, reply) => {
    const problems = validateReport(request.body);
    if (problems.length > 0) return reply.code(400).send({ error: "Invalid probe report", problems });
    const id = await reports.save(request.body as ProbeReport);
    return reply.code(201).send({ id, matrix: `/api/probe-reports/${id}/matrix.md` });
  });
  app.get("/api/probe-reports/:id", async (request: Req<{ id: string }>, reply) => {
    const report = await reports.get(request.params.id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    return report;
  });
  app.get("/api/probe-reports/:id/matrix.md", async (request: Req<{ id: string }>, reply) => {
    const report = await reports.get(request.params.id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    return reply.type("text/markdown; charset=utf-8").send(renderMatrix(report));
  });

  // -------------------------------------------------------------------------
  // Settings and setup

  app.get("/api/settings", async (req) => publicSettings(ctx.settings.get(), setupUrl(req), (id) => ctx.ingest.sourceStatus(id)));

  app.put("/api/settings", async (req: Req<Record<string, string>, Record<string, string>, Partial<Settings>>) => {
    const body = req.body ?? {};
    const patch: Partial<Settings> = {};
    const s = ctx.settings.get();
    if (body.xmltvUrls) patch.xmltvUrls = body.xmltvUrls.map((u) => u.trim()).filter(Boolean);
    if (body.addonUrls) patch.addonUrls = body.addonUrls.map((u) => u.trim()).filter(Boolean);
    if (body.tmdbApiKey !== undefined) patch.tmdbApiKey = body.tmdbApiKey.trim();
    if (body.torboxApiKey !== undefined) patch.torboxApiKey = body.torboxApiKey.trim();
    if (body.library) patch.library = { ...s.library, ...body.library };
    if (body.recording) patch.recording = { ...s.recording, ...body.recording };
    if (body.playback) patch.playback = { ...s.playback, ...body.playback };
    if (body.numbering) patch.numbering = body.numbering;
    if (body.channelFilter !== undefined) {
      try {
        if (body.channelFilter) new RegExp(body.channelFilter);
      } catch {
        throw Object.assign(new Error("The channel filter isn't a valid pattern"), { statusCode: 400 });
      }
      patch.channelFilter = body.channelFilter;
    }
    ctx.settings.update(patch);
    ctx.events.emit({ type: "settings.changed" });
    const refresh = body.xmltvUrls !== undefined || body.channelFilter !== undefined || body.numbering !== undefined;
    if (refresh) void ctx.ingest.refreshAll().then(() => ctx.events.emit({ type: "guide.updated" }));
    return publicSettings(ctx.settings.get(), setupUrl(req), (id) => ctx.ingest.sourceStatus(id));
  });

  app.post("/api/settings/iptv", async (req: Req<Record<string, string>, Record<string, string>, Partial<IptvSource>>, reply) => {
    const b = req.body ?? {};
    const id = `src${Date.now().toString(36)}`;
    const connections = Math.max(1, Number(b.connections ?? 1));
    let source: IptvSource;
    if (b.kind === "xtream") {
      const x = b as Partial<Extract<IptvSource, { kind: "xtream" }>>;
      if (!x.url || !x.username || !x.password) return reply.code(400).send({ error: "Server address, username and password are all needed" });
      source = { id, kind: "xtream", name: x.name || "IPTV", url: x.url.trim().replace(/\/+$/, ""), username: x.username.trim(), password: x.password, connections };
    } else {
      if (!b.url) return reply.code(400).send({ error: "Playlist URL is needed" });
      source = { id, kind: "m3u", name: b.name || "Playlist", url: b.url.trim(), connections };
    }
    const existing = ctx.settings.get().iptv.find((s) => sourceKey(s) === sourceKey(source));
    if (existing) return reply.code(409).send({ error: `That source is already added as "${existing.name}"` });
    ctx.settings.update({ iptv: [...ctx.settings.get().iptv, source] });
    void ctx.ingest.refreshAll().then(() => {
      ctx.scheduler.replan();
      ctx.events.emit({ type: "guide.updated" });
    });
    return reply.code(201).send(publicSettings(ctx.settings.get(), setupUrl(req), (id) => ctx.ingest.sourceStatus(id)));
  });

  app.delete("/api/settings/iptv/:id", async (req: Req<{ id: string }>) => {
    ctx.settings.update({ iptv: ctx.settings.get().iptv.filter((s) => s.id !== req.params.id) });
    // Drop the removed source's channels (a no-op for a duplicate, whose twin still supplies them).
    void ctx.ingest.refreshAll().then(() => {
      ctx.scheduler.replan();
      ctx.events.emit({ type: "guide.updated" });
    });
    return publicSettings(ctx.settings.get(), setupUrl(req), (id) => ctx.ingest.sourceStatus(id));
  });

  app.post("/api/refresh", async () => {
    void ctx.ingest.refreshAll().then(() => {
      ctx.scheduler.replan();
      ctx.events.emit({ type: "guide.updated" });
    });
    return { ok: true };
  });

  app.get("/api/setup/qr.svg", async (req, reply) => {
    const svg = await QRCode.toString(setupUrl(req), { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").send(svg);
  });

  // -------------------------------------------------------------------------
  // Phone remote: key presses and typed text go to the TV over the event socket.

  const REMOTE_ACTIONS = new Set([
    "up", "down", "left", "right", "ok", "back", "red", "green", "yellow", "blue", "guide", "info", "play", "pause", "playPause", "stop",
    "rewind", "fastForward", "record", "channelUp", "channelDown", "home", "digit0", "digit1", "digit2", "digit3", "digit4", "digit5", "digit6", "digit7", "digit8", "digit9",
  ]);
  app.post("/api/remote/key", async (req: Req<Record<string, string>, Record<string, string>, { action?: string }>, reply) => {
    const action = String(req.body?.action ?? "");
    if (!REMOTE_ACTIONS.has(action)) return reply.code(400).send({ error: "Unknown key" });
    ctx.events.emit({ type: "remote.key", action });
    return { ok: true };
  });
  app.post("/api/remote/text", async (req: Req<Record<string, string>, Record<string, string>, { text?: string }>) => {
    ctx.events.emit({ type: "remote.text", text: String(req.body?.text ?? "").slice(0, 120) });
    return { ok: true };
  });
  /** A QR code for a web address the TV shows, such as Spotify's sign-in page. */
  app.get("/api/qr.svg", async (req: Req<Record<string, string>, { text?: string }>, reply) => {
    const text = String(req.query.text ?? "");
    if (!/^https:\/\/[^\s]{1,500}$/.test(text)) return reply.code(400).send({ error: "Only https addresses" });
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "public, max-age=600").send(svg);
  });
  app.get("/api/remote/qr.svg", async (req, reply) => {
    const svg = await QRCode.toString(`${hubBase(req)}/remote/`, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").send(svg);
  });

  /** Voice control: what the phone heard, turned into keys, a channel or a search. */
  app.post("/api/remote/voice", async (req: Req<Record<string, string>, Record<string, string>, { text?: string }>) => {
    const said = String(req.body?.text ?? "").slice(0, 200);
    const cmd = parseVoice(said, ctx.channels.list());
    if (cmd.kind === "keys") cmd.actions.forEach((action, i) => setTimeout(() => ctx.events.emit({ type: "remote.key", action }), i * 150));
    if (cmd.kind === "channel") ctx.events.emit({ type: "remote.channel", channelId: cmd.channelId });
    if (cmd.kind === "search") ctx.events.emit({ type: "remote.text", text: cmd.text.slice(0, 120) });
    if (cmd.kind === "stats") ctx.events.emit({ type: "box.command", command: "stats", on: cmd.on });
    if (cmd.kind === "reload") ctx.events.emit({ type: "box.command", command: "reload" });
    if (cmd.kind !== "none" && said) ctx.events.emit({ type: "remote.said", text: cmd.say });
    return { ...cmd, heard: said, tvConnected: tvSockets > 0 };
  });

  // -------------------------------------------------------------------------
  // Software: the Hub updates through a helper on the Docker LXC; the box through the TV app.

  const selfUpdate = new SelfUpdate(config.dataDir, HUB_BUILD);
  let boxState: BoxState | null = null;
  app.get("/api/software", async (req: Req<Record<string, string>, { check?: string }>) => ({
    hub: await selfUpdate.status(req.query.check === "1"),
    box: boxState,
    tvConnected: tvSockets > 0,
  }));
  app.get("/api/software/hub/log", async (_req, reply) => reply.type("text/plain").send((await selfUpdate.log()) || "No update has run from here yet."));
  app.post("/api/software/hub/update", async (_req, reply) => {
    if (!(await selfUpdate.status(false)).canUpdate) {
      return reply.code(409).send({ error: "The Hub's update helper isn't installed yet. Run `sudo bash tools/hub/update.sh --phone-updates` on the server once to install it." });
    }
    await selfUpdate.request();
    return reply.code(202).send({ ok: true });
  });
  /** The TV app reports the box's software here, when it starts and whenever it's asked. */
  app.post("/api/box/state", async (req: Req<Record<string, string>, Record<string, string>, Partial<BoxState>>) => {
    boxState = { software: req.body?.software ?? null, stats: Boolean(req.body?.stats), reportedAt: new Date().toISOString() };
    return { ok: true };
  });
  const boxCommand = (command: "update" | "reload" | "report" | "stats", on?: boolean) => {
    if (tvSockets === 0) throw Object.assign(new Error("The TV app isn't connected to the Hub. Is the box on?"), { statusCode: 409 });
    ctx.events.emit(on === undefined ? { type: "box.command", command } : { type: "box.command", command, on });
    return { ok: true };
  };
  app.post("/api/box/check", async () => boxCommand("report"));
  app.post("/api/box/update", async () => boxCommand("update"));
  app.post("/api/box/reload", async () => boxCommand("reload"));
  app.post("/api/box/stats", async (req: Req<Record<string, string>, Record<string, string>, { on?: boolean }>) => boxCommand("stats", Boolean(req.body?.on)));

  // Jellyfin sign-in: Quick Connect (a code on the TV, approved on the phone) or name and password.
  app.post("/api/jellyfin/quickconnect", async (req: Req<Record<string, string>, Record<string, string>, { url: string }>) => {
    const client = new JellyfinClient({ url: req.body.url.trim() }, ctx.fetchImpl);
    return client.quickConnectInitiate();
  });

  app.get("/api/jellyfin/quickconnect/:secret", async (req: Req<{ secret: string }, { url: string }>) => {
    const client = new JellyfinClient({ url: String(req.query.url) }, ctx.fetchImpl);
    if (!(await client.quickConnectStatus(req.params.secret))) return { authenticated: false };
    ctx.saveJellyfin(await client.quickConnectAuthenticate(req.params.secret));
    ctx.events.emit({ type: "settings.changed" });
    return { authenticated: true };
  });

  app.post("/api/jellyfin/login", async (req: Req<Record<string, string>, Record<string, string>, { url: string; username: string; password: string }>) => {
    const client = new JellyfinClient({ url: req.body.url.trim() }, ctx.fetchImpl);
    ctx.saveJellyfin(await client.authenticateByName(req.body.username, req.body.password ?? ""));
    ctx.events.emit({ type: "settings.changed" });
    return { ok: true };
  });

  app.delete("/api/jellyfin", async () => {
    const { jellyfin: _j, ...rest } = ctx.settings.get();
    ctx.settings.update({ ...rest, jellyfin: undefined } as Partial<Settings>);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Channels and guide

  app.get("/api/channels", async (req: Req<Record<string, string>, { all?: string }>) => ({ channels: filterOf(req).channels(ctx.channels.list(req.query.all === "1")) }));

  app.patch("/api/channels/:id", async (req: Req<{ id: string }, Record<string, string>, { favourite?: boolean; hidden?: boolean; number?: number }>, reply) => {
    try {
      const c = ctx.channels.update(req.params.id, req.body ?? {});
      if (!c) return reply.code(404).send({ error: "No such channel" });
      ctx.events.emit({ type: "guide.updated" });
      return c;
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get("/api/guide", async (req: Req<Record<string, string>, { from?: string; to?: string; category?: string; channels?: string }>): Promise<GuideWindow> => {
    const now = Date.now();
    const from = Number(req.query.from ?? now - 30 * 60_000);
    const to = Number(req.query.to ?? from + 4 * 3_600_000);
    let channels = ctx.guides.channelsFor(req.query.category, filterOf(req).channels(ctx.channels.list()));
    if (req.query.channels) {
      const ids = new Set(req.query.channels.split(","));
      channels = channels.filter((c) => ids.has(c.id));
    }
    const programmes = ctx.guide.window(channels.map((c) => c.id), from, to);
    return { from, to, channels, programmes, marks: marksFor(ctx, from, to) };
  });

  app.get("/api/nownext", async (req: Req<Record<string, string>, { ids?: string; category?: string }>) => {
    let channels = ctx.guides.channelsFor(req.query.category, filterOf(req).channels(ctx.channels.list()));
    if (req.query.ids) {
      const ids = new Set(req.query.ids.split(","));
      channels = channels.filter((c) => ids.has(c.id));
    }
    return { items: library.nowNextFor(channels) };
  });

  /** The lists the guide can show this profile, its custom guides and which one it opens on. */
  app.get("/api/guides", async (req): Promise<GuideChoices> => {
    const who = viewer(req);
    const channels = who.filter.channels(ctx.channels.list());
    return { choices: ctx.guides.choices(channels), custom: ctx.guides.list(), default: ctx.guides.resolveDefault(who.profile?.defaultGuide, channels) };
  });

  app.post("/api/guides", async (req: Req<Record<string, string>, Record<string, string>, { name?: string; channels?: string[] }>, reply) => {
    const g = ctx.guides.create(req.body ?? {});
    ctx.events.emit({ type: "guide.updated" });
    return reply.code(201).send(g);
  });

  app.patch("/api/guides/:id", async (req: Req<{ id: string }, Record<string, string>, { name?: string; channels?: string[] }>, reply) => {
    const g = ctx.guides.update(req.params.id, req.body ?? {});
    if (!g) return reply.code(404).send({ error: "That guide has been deleted" });
    ctx.events.emit({ type: "guide.updated" });
    return g;
  });

  app.delete("/api/guides/:id", async (req: Req<{ id: string }>, reply) => {
    if (!ctx.guides.remove(req.params.id)) return reply.code(404).send({ error: "That guide has been deleted" });
    ctx.events.emit({ type: "guide.updated" });
    return { ok: true };
  });

  /** Which list the current profile's guide opens on. Anyone can choose their own, Kids included. */
  app.put("/api/guides/default", async (req: Req<Record<string, string>, Record<string, string>, { guide?: string }>, reply) => {
    const who = viewer(req);
    if (!who.profile) return reply.code(400).send({ error: "Choose a profile first" });
    const p = ctx.profiles.update(who.profile.id, { defaultGuide: String(req.body?.guide ?? "") });
    ctx.events.emit({ type: "profiles.changed" });
    return p;
  });

  app.get("/api/channels/:id/programmes", async (req: Req<{ id: string }, { from?: string; limit?: string }>) => {
    const channel = ctx.channels.get(req.params.id);
    if (!channel || !filterOf(req).channel(channel)) throw new NotAllowedError();
    return { programmes: ctx.guide.onChannel(req.params.id, Number(req.query.from ?? Date.now()), Number(req.query.limit ?? 12)) };
  });

  app.get("/api/programmes/:id", async (req: Req<{ id: string }>, reply) => {
    const p = ctx.guide.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "That programme isn't in the guide" });
    const channel = ctx.channels.get(p.channelId);
    if (!filterOf(req).programme(p, channel)) throw new NotAllowedError();
    const recording = ctx.recordings.forProgramme(p.id);
    const link = p.seriesKey ? ctx.recordings.linkForSeries(p.seriesKey) : undefined;
    const now = Date.now();
    const catchup = Boolean(channel && channel.catchupDays > 0 && p.start < now && p.start > now - channel.catchupDays * 86_400_000);
    const otherAirings = p.seriesKey ? ctx.guide.airings(p.seriesKey, now).filter((a) => a.id !== p.id && a.episodeKey === p.episodeKey).slice(0, 5) : [];
    return { programme: p, channel, recording, seriesLink: link, catchup, otherAirings, reminder: ctx.recordings.reminders().some((r) => r.id === p.id) };
  });

  // -------------------------------------------------------------------------
  // Recording

  /** Kids profiles only see recordings from their channels. */
  const recordingAllowed = (req: FastifyRequest, channelId: string) => {
    const f = filterOf(req);
    const channel = ctx.channels.get(channelId);
    return !f.kids || (channel !== undefined && f.channel(channel));
  };
  const programmeAllowed = (req: FastifyRequest, programmeId: string) => {
    const p = ctx.guide.get(programmeId);
    if (p && !recordingAllowed(req, p.channelId)) throw new NotAllowedError();
  };

  app.get("/api/recordings", async (req) => ({
    recordings: ctx.recordings.list().filter((r) => r.status !== "cancelled" && recordingAllowed(req, r.channelId)),
    seriesLinks: ctx.recordings.links(),
    conflicts: ctx.scheduler.conflicts(),
    reminders: ctx.recordings.reminders(),
  }));

  app.post("/api/recordings", async (req: Req<Record<string, string>, Record<string, string>, { programmeId: string }>) => {
    programmeAllowed(req, req.body.programmeId);
    return ctx.scheduler.recordProgramme(req.body.programmeId);
  });

  app.delete("/api/recordings/:id", async (req: Req<{ id: string }>, reply) => {
    const r = ctx.recordings.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "No such recording" });
    if (r.status === "completed" || r.status === "failed") await ctx.scheduler.deleteRecording(r.id);
    else ctx.scheduler.cancelRecording(r.id);
    return { ok: true };
  });

  app.post("/api/recordings/:id/watched", async (req: Req<{ id: string }, Record<string, string>, { watched: boolean }>, reply) => {
    const r = ctx.recordings.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "No such recording" });
    ctx.recordings.save({ ...r, watched: req.body?.watched ?? true, positionMs: 0 });
    ctx.events.emit({ type: "recordings.changed" });
    return { ok: true };
  });

  app.get("/api/recordings/:id/file", async (req: Req<{ id: string }>, reply) => {
    const r = ctx.recordings.get(req.params.id);
    if (!r?.path) return reply.code(404).send({ error: "No file for that recording" });
    if (!recordingAllowed(req, r.channelId)) throw new NotAllowedError();
    return sendFile(req, reply, r.path);
  });

  app.get("/api/series-links", async () => ({ seriesLinks: ctx.recordings.links() }));

  app.post("/api/series-links", async (req: Req<Record<string, string>, Record<string, string>, { programmeId: string; scope?: "this" | "any"; newOnly?: boolean; keepLatest?: number }>) => {
    const { programmeId, ...options } = req.body;
    programmeAllowed(req, programmeId);
    return ctx.scheduler.createSeriesLink(programmeId, options);
  });

  app.patch("/api/series-links/:id", async (req: Req<{ id: string }, Record<string, string>, Record<string, unknown>>, reply) => {
    const link = ctx.scheduler.updateSeriesLink(req.params.id, req.body as never);
    if (!link) return reply.code(404).send({ error: "No such series link" });
    return link;
  });

  app.delete("/api/series-links/:id", async (req: Req<{ id: string }>) => {
    ctx.scheduler.deleteSeriesLink(req.params.id);
    return { ok: true };
  });

  app.post("/api/reminders", async (req: Req<Record<string, string>, Record<string, string>, { programmeId: string }>) => {
    programmeAllowed(req, req.body.programmeId);
    return ctx.scheduler.addReminder(req.body.programmeId);
  });
  app.delete("/api/reminders/:id", async (req: Req<{ id: string }>) => {
    ctx.recordings.deleteReminder(req.params.id);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Playback

  app.post("/api/play", async (req: Req<Record<string, string>, Record<string, string>, PlaybackRequest & { force?: boolean }>) => playback.resolve(req.body, hubBase(req), filterOf(req)));

  app.post("/api/progress", async (req: Req<Record<string, string>, Record<string, string>, { key: string; positionMs: number; durationMs?: number; event?: "start" | "progress" | "stop"; paused?: boolean; title?: TitleRef }>) => {
    const b = req.body;
    await playback.report(b.key, b.positionMs, b.durationMs, b.event ?? "progress", b.paused ?? false, b.title);
    return { ok: true };
  });

  app.get("/api/live/:file", async (req: Req<{ file: string }, { force?: string; holder?: string }>, reply) => {
    const channelId = req.params.file.replace(/\.ts$/, "");
    const live = ctx.channels.get(channelId);
    if (live && !filterOf(req).channel(live)) throw new NotAllowedError();
    const holder = req.query.holder ?? "box";
    const consumer = ctx.relay.subscribe(channelId, holder, "view", req.query.force === "1");
    req.raw.on("close", () => consumer.close());
    void consumer.ended.then((reason) => {
      // A recording took the only connection: tell the TV which channel to follow.
      const m = reason ? /^recording:live:(.+)$/.exec(reason) : null;
      if (m?.[1]) {
        const ch = ctx.channels.get(m[1]);
        ctx.events.emit({ type: "connection.conflict", message: `Switched to ${ch?.name ?? "another channel"} so a recording can start.`, ...(ctx.recordings.withStatus("recording").find((r) => r.channelId === m[1]) ? { recording: ctx.recordings.withStatus("recording").find((r) => r.channelId === m[1])! } : {}) });
      }
    });
    reply.header("Content-Type", "video/mp2t").header("Cache-Control", "no-store");
    return reply.send(consumer.stream);
  });

  app.get("/api/stream/:token", (req: Req<{ token: string }>, reply) => ctx.proxy.handle(req, reply));

  // -------------------------------------------------------------------------
  // Profiles

  app.get("/api/profiles", async (req) => {
    const who = viewer(req);
    return { profiles: ctx.profiles.list(), locked: ctx.profiles.locked(), current: who.profile?.id ?? null, admin: who.admin };
  });

  app.post("/api/profiles", async (req: Req<Record<string, string>, Record<string, string>, { name: string; kind: ProfileKind }>, reply) => {
    const kind: ProfileKind = req.body?.kind === "kids" ? "kids" : "adult";
    const p = ctx.profiles.create({ name: String(req.body?.name ?? ""), kind });
    ctx.events.emit({ type: "profiles.changed" });
    return reply.code(201).send(p);
  });

  app.patch(
    "/api/profiles/:id",
    async (req: Req<{ id: string }, Record<string, string>, { name?: string; colour?: string; maxCertification?: Certification; channelCategories?: ChannelCategory[]; allowedChannels?: string[]; pin?: string | null }>, reply) => {
      const p = ctx.profiles.update(req.params.id, req.body ?? {});
      if (!p) return reply.code(404).send({ error: "No such profile" });
      ctx.events.emit({ type: "profiles.changed" });
      return p;
    },
  );

  app.delete("/api/profiles/:id", async (req: Req<{ id: string }>) => {
    ctx.profiles.remove(req.params.id);
    ctx.events.emit({ type: "profiles.changed" });
    return { ok: true };
  });

  /** Switch the TV to a profile. Returns the token to send as X-Profile-Token. */
  app.post("/api/profiles/:id/unlock", async (req: Req<{ id: string }, Record<string, string>, { pin?: string }>) => {
    const token = ctx.profiles.unlock(req.params.id, req.body?.pin);
    return { token, profile: ctx.profiles.get(req.params.id) };
  });

  /** The phone setup page asks for a grown-up's PIN once the lock is on. */
  app.post("/api/profiles/admin-unlock", async (req: Req<Record<string, string>, Record<string, string>, { pin?: string }>) => ({ token: ctx.profiles.unlockAdmin(req.body?.pin) }));

  // -------------------------------------------------------------------------
  // Library

  app.get("/api/home", async (req) => library.home(Date.now(), filterOf(req)));
  app.get("/api/browse/:kind", async (req: Req<{ kind: "movie" | "series" }>) => ({ rails: await library.browse(req.params.kind === "series" ? "series" : "movie", filterOf(req)) }));
  app.get("/api/titles/:id", async (req: Req<{ id: string }>) => library.details(req.params.id, filterOf(req)));
  app.get("/api/titles/:id/season/:n", async (req: Req<{ id: string; n: string }>, reply) => {
    const season = await library.season(req.params.id, Number(req.params.n), filterOf(req));
    if (!season) return reply.code(404).send({ error: "No such season" });
    return season;
  });
  app.get("/api/titles/:id/streams", async (req: Req<{ id: string }, { episode?: string }>) => {
    const ep = req.query.episode ? episodeNumbers(req.query.episode) : undefined;
    const streams = await library.streams(req.params.id, ep, filterOf(req));
    return { streams: streams.map((s) => ({ ...s, url: "", headers: undefined, badges: library.badgesFor(s) })) };
  });
  app.get("/api/search", async (req: Req<Record<string, string>, { q?: string }>) => ({ results: await library.search(req.query.q ?? "", Date.now(), filterOf(req)) }));

  // Downloads to the NAS.
  app.get("/api/downloads", async () => ({ downloads: ctx.downloads.list() }));
  app.post("/api/downloads", async (req: Req<Record<string, string>, Record<string, string>, { titleId: string; episodeId?: string; streamId?: string }>, reply) => {
    const { titleId, episodeId, streamId } = req.body;
    const ep = episodeId ? episodeNumbers(episodeId) : undefined;
    const streams = await library.streams(titleId, ep);
    const pick = streamId ? streams.find((s) => s.id === streamId) : streams.find((s) => s.downloadable && s.ready && s.kind !== "xtream") ?? streams.find((s) => s.downloadable);
    if (!pick?.downloadable) return reply.code(422).send({ error: "There's no copy of this that can be saved to the NAS" });
    const details = await library.details(titleId);
    const request: Parameters<typeof ctx.downloads.add>[0] = { title: details.name, kind: details.kind, url: pick.url };
    if (details.year) request.year = details.year;
    if (pick.headers) request.headers = pick.headers;
    if (ep) {
      request.season = ep.season;
      request.episode = ep.episode;
      const name = details.seasons?.find((s) => s.season === ep.season)?.episodes.find((e) => e.episode === ep.episode)?.name;
      if (name) request.episodeName = name;
    }
    if (pick.detail) request.fileName = pick.detail;
    return reply.code(201).send(ctx.downloads.add(request));
  });
  app.delete("/api/downloads/:id", async (req: Req<{ id: string }>) => {
    ctx.downloads.remove(req.params.id);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Live updates for the TV

  await app.register(fastifyWebsocket);
  app.get("/api/events", { websocket: true }, (socket) => {
    const off = ctx.events.on((e) => socket.send(JSON.stringify(e)));
    tvSockets++;
    socket.on("close", () => {
      off();
      tvSockets--;
    });
    socket.send(JSON.stringify({ type: "hello", version: HUB_VERSION }));
  });

  // -------------------------------------------------------------------------
  // Static pages

  if (config.demo) {
    app.get("/api/art/:kind/:file", async (req: Req<{ kind: string; file: string }>, reply) =>
      reply.type("image/svg+xml").header("Cache-Control", "public, max-age=86400").send(demoArt(req.params.kind, req.params.file.replace(/\.svg$/, ""))),
    );
  }

  app.get("/", async (_request, reply) => reply.redirect(existsSync(config.uiDir) ? "/app/" : "/probe/"));

  const serveDir = async (dir: string, prefix: string, missing: string, decorate = false) => {
    if (existsSync(dir)) {
      await app.register(fastifyStatic, {
        root: dir,
        prefix,
        decorateReply: decorate,
        cacheControl: false,
        index: ["index.html"],
        // Pages are checked on every load, so the TV picks up a Hub update; the hashed assets they
        // point at never change.
        setHeaders: (res, file) => res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache"),
      });
    } else {
      app.get(prefix, async (_request, reply) => reply.code(503).type("text/plain").send(missing));
    }
  };
  await serveDir(config.probeDir, "/probe/", "Probe page not built. Run `npm run build` first.", true);
  await serveDir(config.uiDir, "/app/", "TV app not built. Run `npm run build` first.");
  await serveDir(config.setupDir, "/setup/", "Setup page missing.");
  if (config.remoteDir) await serveDir(config.remoteDir, "/remote/", "Phone remote missing.");

  // Test clips are served with range requests so players can seek.
  if (existsSync(config.clipsDir)) {
    await app.register(fastifyStatic, { root: config.clipsDir, prefix: "/clips/", decorateReply: false, acceptRanges: true, cacheControl: false });
  }

  app.decorate("hub", ctx);
  return app as unknown as FastifyInstance & { hub: HubContext };
}

function marksFor(ctx: HubContext, from: number, to: number): Record<string, ProgrammeMark> {
  const marks: Record<string, ProgrammeMark> = {};
  for (const r of ctx.recordings.list()) {
    if (r.programme.end < from || r.programme.start > to) continue;
    if (r.status === "recording") marks[r.programme.id] = "recording";
    else if (r.status === "scheduled" || r.status === "waiting-catchup") marks[r.programme.id] = r.seriesLinkId ? "series" : "scheduled";
  }
  for (const rem of ctx.recordings.reminders()) marks[rem.id] ??= "reminder";
  return marks;
}

export function hostname(): string {
  return os.hostname();
}

import { existsSync, readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { MUSIC_LOGIN_PAGE, MusicLogins } from "./musiclogin.js";
import { registerNotices } from "./notify.js";
import { registerQueue } from "./queue.js";
import { registerScares } from "./scares.js";
import { AdSkipper, registerAdSkip } from "./adskip.js";
import { Alerts, registerAlerts } from "./alerts.js";
import { registerCast, ScreenShares } from "./cast.js";
import { Projections, registerProjections } from "./projections.js";
import { registerWatchlist, Watchlist } from "./watchlist.js";
import { registerSubtitles } from "./subtitles.js";
import { movedAway, registerMove } from "./move.js";
import type { BoxState, DeviceList, NewsFlash, PairedDevice, TvMethod, WebAppLoginResult, Certification, Channel, ChannelCategory, GuideChoices, GuideWindow, HubStatus, IptvSource, MixChannel, PlaybackRequest, ProfileKind, ProgrammeMark, Settings, SubtitleMode, TitleRef } from "@ultimatetv/shared";
import { cleanAppName, cleanSubtitleStyle, TV_APPS_METHODS, cleanLook, resolveTheme, THEMES, cleanScreensaver, renderMatrix, SCREENSAVER_THEMES, THEME_CHOICES, type ScreensaverInfo, validateReport, type ProbeReport } from "@ultimatetv/shared";
import { listClips } from "./clips.js";
import { guideBlocks, mixLogo } from "./mixchannels.js";
import type { HubConfig } from "./config.js";
import { ConnectionBusyError } from "./connections.js";
import { HubContext } from "./context.js";
import { demoArt, seedDemo } from "./demo.js";
import { BoxReportStore, cleanBoxReport, renderDiagnostics, RollingFile, type LogRing } from "./diagnostics.js";
import { phoneReachable } from "./lan.js";
import { Library, NotAllowedError } from "./library.js";
import { Pairing, PairingError } from "./pairing.js";
import type { Logger } from "./log.js";
import { Playback, PlaybackError, episodeNumbers } from "./playback.js";
import { ContentFilter } from "./profiles.js";
import { ReportStore } from "./reports.js";
import { JellyfinClient } from "./services/jellyfin.js";
import { publicSettings, sourceKey } from "./settings.js";
import { RemoteApp } from "./remoteapp.js";
import { SelfUpdate } from "./selfupdate.js";
import { statsWarnings } from "./stats.js";
import { sendFile } from "./streaming.js";
import { systemReport, type SystemReport } from "./system.js";
import { HostMonitor } from "@ultimatetv/shared/host";
import { parseVoice } from "./voice.js";

export interface ServerDeps {
  /** Overridable in tests so they don't shell out to ffmpeg/vainfo. */
  systemReport?: () => Promise<SystemReport>;
  logger?: boolean;
  /** Keeps the Hub's recent log lines for /api/diagnostics (with `logger`). */
  logRing?: LogRing;
  context?: HubContext;
  env?: NodeJS.ProcessEnv;
  /** Restarts the Hub after a move (Docker starts it again). Tests pass a fake. */
  restart?: () => void;
}

export const HUB_VERSION = "0.2.0";
/** The commit and date the Hub was built from (set by tools/hub/update.sh through the Docker build). */
export const HUB_BUILD = { commit: process.env.GIT_COMMIT || undefined, date: process.env.BUILD_DATE || undefined };

type Req<P = Record<string, string>, Q = Record<string, string | undefined>, B = unknown> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;

export async function buildServer(config: HubConfig, deps: ServerDeps = {}): Promise<FastifyInstance & { hub: HubContext; jobs: { alerts: Alerts; adSkipper: AdSkipper } }> {
  // With a log ring the logger runs at LOG_LEVEL (debug by default): the rolling file in
  // data/logs gets everything, docker logs info and up.
  const app = Fastify({ logger: deps.logger ? (deps.logRing ? { level: deps.env?.LOG_LEVEL ?? "debug", stream: deps.logRing.stream } : true) : false, bodyLimit: 2 * 1024 * 1024 });
  const log: Logger = app.log;
  const ctx = deps.context ?? new HubContext({ dataDir: config.dataDir, mediaRoot: config.mediaRoot, env: deps.env ?? {}, log, ...(config.demo ? { demo: true, ytdlp: null } : {}) });
  if (config.demo) seedDemo(ctx, config);
  const library = new Library(ctx);
  const playback = new Playback(ctx, library);
  const watchlist = new Watchlist(ctx.db, ctx.events);
  const reports = new ReportStore(path.join(config.dataDir, "probe-reports"));
  const getSystem = deps.systemReport ?? systemReport;
  app.addHook("onClose", async () => ctx.close());

  /** TV apps listening on the event socket: the phone's box controls need one. */
  let tvSockets = 0;
  const deviceSockets = new Map<string, Set<{ close(code?: number, reason?: string): void }>>();
  const hubBase = (req: FastifyRequest) => config.publicUrl ?? `${req.protocol}://${req.headers.host ?? `${req.hostname}:${config.port}`}`;
  /** The Hub's address for a phone: the TV may reach a Hub on the box itself at 127.0.0.1. */
  const phoneBase = (req: FastifyRequest) => phoneReachable(hubBase(req));
  const setupUrl = (req: FastifyRequest) => `${phoneBase(req)}/setup/`;

  // Pairing: only phones and screens that have paired (see pairing.ts) may control the TV.
  const pairing = new Pairing(ctx.db, config.pairing !== false, () => ctx.events.emit({ type: "devices.changed" }));
  const DEVICE_COOKIE = "utv_device";
  const header = (req: FastifyRequest, name: string) => {
    const v = req.headers[name];
    return typeof v === "string" && v ? v : undefined;
  };
  const bearer = (req: FastifyRequest) => /^Bearer\s+(\S+)$/i.exec(header(req, "authorization") ?? "")?.[1];
  const deviceToken = (req: FastifyRequest) => {
    const cookie = (header(req, "cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${DEVICE_COOKIE}=`));
    const b = bearer(req);
    return header(req, "x-device-token") ?? (b && !b.startsWith("utv_") ? b : undefined) ?? (cookie ? decodeURIComponent(cookie.slice(DEVICE_COOKIE.length + 1)) : undefined);
  };
  const apiKeyOf = (req: FastifyRequest) => header(req, "x-api-key") ?? bearer(req);
  const paired = new WeakMap<FastifyRequest, PairedDevice>();
  const deviceAsking = (req: FastifyRequest): PairedDevice | undefined => {
    if (!paired.has(req)) {
      const d = pairing.authenticate(deviceToken(req), req.ip);
      if (d) paired.set(req, d);
    }
    return paired.get(req);
  };
  /** Hands a paired browser its token as a cookie, so every page on the Hub sends it. */
  const keepToken = (reply: FastifyReply, token: string) =>
    reply.header("Set-Cookie", `${DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${10 * 365 * 86_400}; HttpOnly; SameSite=Strict`);
  /**
   * What each controlling route needs: "tv" a paired screen, "paired" any paired phone or screen,
   * "script" either of those or the API key (Home Assistant: pop-ups, news flashes, key presses).
   */
  const NEEDS = new Map<string, "tv" | "paired" | "script">([
    ["POST /api/remote/key", "script"],
    ["POST /api/remote/text", "script"],
    ["POST /api/remote/voice", "paired"],
    ["POST /api/flash", "script"],
    ["DELETE /api/flash", "script"],
    ["POST /api/notify", "script"],
    ["POST /api/notify/media", "script"],
    ["DELETE /api/notify/:id", "script"],
    ["DELETE /api/notify", "script"],
    ["PUT /api/scares", "script"],
    ["POST /api/scares/now", "script"],
    ["POST /api/scares/clips", "script"],
    ["DELETE /api/scares/clips/:id", "script"],
    ["POST /api/scares/mixes", "script"],
    ["DELETE /api/scares/mixes/:id", "script"],
    ["POST /api/scares/loop", "script"],
    ["POST /api/scares/packs", "paired"],
    ["POST /api/scares/packs/link", "paired"],
    ["DELETE /api/scares/packs/:id", "paired"],
    ["POST /api/scares/packs/export", "paired"],
    ["POST /api/scares/shares", "paired"],
    ["POST /api/scares/library/install", "paired"],
    ["POST /api/tv/call/:method", "paired"],
    ["POST /api/queue", "paired"],
    ["POST /api/queue/:id/move", "paired"],
    ["DELETE /api/queue/:id", "paired"],
    ["DELETE /api/queue", "paired"],
    ["POST /api/music/login", "paired"],
    ["POST /api/box/check", "paired"],
    ["POST /api/box/update", "paired"],
    ["POST /api/box/reload", "paired"],
    ["POST /api/box/stats", "paired"],
    ["GET /api/devices", "paired"],
    ["PATCH /api/devices/:id", "paired"],
    ["DELETE /api/devices/:id", "paired"],
    ["POST /api/devices/pending/:id", "paired"],
    ["DELETE /api/devices/pending/:id", "paired"],
    ["GET /api/pair/api-key", "paired"],
    ["POST /api/pair/api-key", "paired"],
    ["POST /api/tv/reply/:id", "tv"],
    ["POST /api/box/state", "tv"],
    ["GET /api/music/login/:id", "tv"],
    ["POST /api/music/login/:id/result", "tv"],
    ["GET /api/music/login/:id/status", "paired"],
    ["GET /api/pair/code", "tv"],
    ["GET /api/hub/move-out", "paired"],
    ["GET /api/remote/qr.svg", "tv"],
    ["GET /api/setup/qr.svg", "tv"],
    ["GET /api/music/login/qr.svg", "tv"],
    ["GET /api/screensaver", "paired"],
    ["GET /api/screensaver/photos", "paired"],
    ["GET /api/screensaver/photos/:id", "paired"],
    ["POST /api/watchlist", "paired"],
    ["POST /api/subtitles/download", "paired"],
    ["DELETE /api/watchlist/:id", "paired"],
    ["GET /api/alerts", "paired"],
    ["POST /api/alerts/check", "paired"],
    ["POST /api/alerts/test", "paired"],
    ["POST /api/alerts/playback", "tv"],
    ["POST /api/recordings/:id/adscan", "paired"],
    ["POST /api/cast/share/:id/answer", "tv"],
    ["POST /api/cast/share/:id/refuse", "tv"],
    ["POST /api/cast/share/:id/end", "tv"],
    ["POST /api/cast/link", "paired"],
    ["POST /api/tv/sleep", "script"],
    ["PATCH /api/scares/clips/:id", "script"],
    ["PUT /api/projections", "script"],
    ["POST /api/projections/now", "script"],
    ["POST /api/community/clips/:id/download", "script"],
  ]);
  const NOT_PAIRED = "Pair this phone with the TV first: on the TV, open Settings › Phones and remotes and scan the code";

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
  /** The Android client names itself ("phone:<id>") so it can share the IPTV connection politely. */
  const deviceOf = (req: FastifyRequest): string | undefined => {
    const v = req.headers["x-device"];
    return typeof v === "string" && /^phone:[\w-]{1,64}$/.test(v) ? v : undefined;
  };
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
    "PUT /api/guides/order",
    "PATCH /api/guides/:id",
    "DELETE /api/guides/:id",
    "POST /api/downloads",
    "DELETE /api/downloads/:id",
    "POST /api/software/hub/update",
    "POST /api/box/update",
    "POST /api/mix-channels",
    "PATCH /api/mix-channels/:id",
    "DELETE /api/mix-channels/:id",
    "POST /api/mix-channels/:id/curate",
    "POST /api/mix-channels/:id/shuffle",
    "POST /api/mix-channels/:id/videos",
    "POST /api/mix-channels/:id/files",
    "GET /api/mix/nas",
    "DELETE /api/mix-channels/:id/videos/:videoId",
    "GET /api/screensaver/nas",
    "PUT /api/alerts/settings",
    "PUT /api/adskip",
    "PUT /api/cast/settings",
  ]);
  app.addHook("preHandler", async (req) => {
    const route = `${req.method} ${req.routeOptions.url}`;
    const need = NEEDS.get(route) ?? (ADMIN_ROUTES.has(route) ? "paired" : undefined);
    if (need && pairing.enforced) {
      const device = deviceAsking(req);
      if (!device && !(need === "script" && pairing.checkApiKey(apiKeyOf(req)))) throw Object.assign(new Error(NOT_PAIRED), { statusCode: 401, code: "pair" });
      if (need === "tv" && device?.kind !== "tv") throw Object.assign(new Error("Only the TV can do that"), { statusCode: 403, code: "pair" });
    }
    if (ADMIN_ROUTES.has(route) && !viewer(req).admin) {
      throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PlaybackError) return reply.code(err.code === "busy" ? 409 : err.code === "not-found" ? 404 : 422).send({ error: err.message, code: err.code, recordings: err.recordings });
    if (err instanceof ConnectionBusyError) return reply.code(409).send({ error: err.message, code: "busy", recordings: err.blockingRecordings });
    if (err instanceof NotAllowedError) return reply.code(403).send({ error: err.message, code: "profile" });
    if (err instanceof PairingError) return reply.code(err.statusCode).send({ error: err.message, code: "pair" });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error({ err: String(err) }, "Request failed");
    const code = (err as { code?: unknown }).code;
    return reply.code(status).send({ error: err instanceof Error ? err.message : String(err), ...(code === "pin" || code === "pair" ? { code } : {}) });
  });

  // -------------------------------------------------------------------------
  // Health, status, probes

  app.get("/api/health", async () => ({ ok: true, version: HUB_VERSION, ...HUB_BUILD, ...(movedAway(ctx.db) ? { movedAway: true } : {}) }));
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

  // The phone's Stats page: both machines, the last playback samples and plain warnings.
  const hostMonitor = new HostMonitor();
  let systemCache: { at: number; report: SystemReport } | null = null;
  app.get("/api/stats", async () => {
    const s = ctx.settings.get();
    const disks = [
      { label: "Hub data", path: config.dataDir },
      { label: "Recordings", path: s.library.recordingsPath },
      { label: "Films", path: s.library.moviesPath },
      { label: "TV", path: s.library.tvPath },
    ];
    // The same NAS share often holds several folders: show each disk once.
    const host = await hostMonitor.stats(disks);
    const seen = new Set<string>();
    host.disks = host.disks.filter((d) => {
      const key = `${d.totalGb}/${d.freeGb}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!systemCache || Date.now() - systemCache.at > 10 * 60_000) systemCache = { at: Date.now(), report: await getSystem() };
    const box = boxReports.get();
    const connections = ctx.guard.status();
    const sources = s.iptv.map((src) => {
      const status = ctx.ingest.sourceStatus(src.id);
      return { name: src.name, host: new URL(src.url, "http://x").host, connections: src.connections, ...(status ? { status } : {}) };
    });
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const hubLog = deps.logRing?.list() ?? [];
    const hubErrors = hubLog.filter((l) => / (ERROR|FATAL) /.test(l) && l.slice(0, 24) >= hourAgo);
    const warnings = statsWarnings({ now: Date.now(), hub: host, box, sources, connections, hardwareTranscode: systemCache.report.renderNode ? systemCache.report.vaapi.available : false, hubErrors });
    return {
      at: new Date().toISOString(),
      warnings,
      tvConnected: tvSockets > 0,
      hub: {
        version: HUB_VERSION,
        ...(HUB_BUILD.commit ? { commit: HUB_BUILD.commit } : {}),
        ...(HUB_BUILD.date ? { builtAt: HUB_BUILD.date } : {}),
        uptimeS: Math.round(process.uptime()),
        processMb: Math.round(process.memoryUsage().rss / 2 ** 20),
        host,
        system: systemCache.report,
        connections,
        sources,
        channels: ctx.channels.count(),
        programmes: ctx.guide.count(),
        epgUpdatedAt: ctx.db.getKv<number>("epgUpdatedAt") ?? null,
        recordingNow: ctx.recordings.withStatus("recording").map((r) => `${r.programme.title} on ${r.channelName}`),
        log: hubLog.slice(-150),
      },
      box: box ? { receivedAt: box.receivedAt, report: { ...box.report, samples: box.report.samples.slice(-30), log: box.report.log.slice(-150), kscreen: { text: box.report.kscreen.text } } } : null,
    };
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
    if (body.omdbApiKey !== undefined) patch.omdbApiKey = body.omdbApiKey.trim();
    if (body.openSubtitles !== undefined) {
      // The setup page sends what was typed: a blank key leaves the old one, a blank username signs out.
      const o = body.openSubtitles ?? { apiKey: "" };
      const apiKey = String(o.apiKey ?? "").trim() || s.openSubtitles?.apiKey || "";
      const username = o.username !== undefined ? String(o.username).trim() : s.openSubtitles?.username;
      const password = o.password ? String(o.password) : username ? s.openSubtitles?.password : undefined;
      patch.openSubtitles = { apiKey, ...(username && password ? { username, password } : {}) };
    }
    if (body.library) patch.library = { ...s.library, ...body.library };
    if (body.recording) patch.recording = { ...s.recording, ...body.recording };
    if (body.playback) {
      const b = body.playback;
      patch.playback = { ...s.playback, ...b, subtitleStyle: cleanSubtitleStyle(b.subtitleStyle, s.playback.subtitleStyle), tvAppsMethod: TV_APPS_METHODS.includes(b.tvAppsMethod) ? b.tvAppsMethod : s.playback.tvAppsMethod };
    }
    if (body.numbering) patch.numbering = body.numbering;
    if (body.appName !== undefined) patch.appName = cleanAppName(body.appName);
    if (body.screensaver) {
      const ss = cleanScreensaver(body.screensaver, s.screensaver);
      if (ss.photosPath && ss.photosPath !== s.screensaver.photosPath) ss.photosPath = await ctx.photos.check(ss.photosPath);
      patch.screensaver = ss;
    }
    // An older TV or phone sends "auto" for dark with the seasons on.
    if (body.theme !== undefined && THEME_CHOICES.includes(body.theme)) Object.assign(patch, body.theme === "auto" ? { theme: "default", seasonal: true } : { theme: body.theme, seasonal: cleanLook(s).seasonal });
    if (typeof body.seasonal === "boolean") patch.seasonal = body.seasonal;
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

  // The TV's QR codes carry the pairing code, so scanning one also pairs the phone.
  const withPairCode = (req: FastifyRequest, url: string) => (pairing.enforced ? `${url}?pair=${pairing.currentCode(phoneBase(req)).code}` : url);
  app.get("/api/setup/qr.svg", async (req, reply) => {
    const svg = await QRCode.toString(withPairCode(req, setupUrl(req)), { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "no-store").send(svg);
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
  // A news flash along the bottom of the TV, typed on the phone. Kept so a TV that reconnects shows it too.
  let flash: NewsFlash | null = null;
  const currentFlash = () => {
    if (flash && flash.until !== null && flash.until <= Date.now()) flash = null;
    return flash && { ...flash, leftMs: flash.until === null ? null : flash.until - Date.now() };
  };
  app.get("/api/flash", async () => ({ flash: currentFlash() }));
  app.post("/api/flash", async (req: Req<Record<string, string>, Record<string, string>, { text?: string; label?: string; seconds?: number }>, reply) => {
    const text = String(req.body?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
    if (!text) return reply.code(400).send({ error: "Write the news first" });
    const seconds = Number(req.body?.seconds ?? 60);
    const now = Date.now();
    flash = {
      text,
      label: String(req.body?.label ?? "").trim().slice(0, 24) || "BBC NEWS",
      until: Number.isFinite(seconds) && seconds > 0 ? now + Math.min(seconds, 24 * 3600) * 1000 : null,
      leftMs: null,
      at: now,
    };
    const sent = currentFlash();
    ctx.events.emit({ type: "flash", flash: sent });
    return { flash: sent };
  });
  app.delete("/api/flash", async () => {
    flash = null;
    ctx.events.emit({ type: "flash", flash: null });
    return { ok: true };
  });
  // Pop-ups on the TV from the phone or anything on the home network (a doorbell, an alarm).
  await registerNotices(app, ctx, config.dataDir);
  // Jump scares and projected clips: clips the Hub keeps and cuts in over whatever is on, and the packs that share them (see scares.ts).
  const clipStore = await registerScares(app, ctx, config.dataDir, { phoneBase });
  // Seasonal projections and the community clip library (see projections.ts).
  const projections = new Projections(ctx, clipStore);
  registerProjections(app, projections);
  // Warnings before things break (see alerts.ts); checks start with the Hub's other jobs.
  const alerts = new Alerts(ctx);
  registerAlerts(app, ctx, alerts);
  // Advert breaks in recordings (see adskip.ts).
  const adSkipper = new AdSkipper(ctx, config.dataDir);
  await registerAdSkip(app, adSkipper, config.dataDir);
  // Laptops sharing their screen, links from phones (see cast.ts).
  const screenShares = new ScreenShares(ctx);
  registerCast(app, ctx, screenShares, {
    castUrl: (req) => (config.httpsPort ? `https://${new URL(phoneBase(req)).hostname}:${config.httpsPublicPort ?? config.httpsPort}/cast/` : null),
  });
  /** Sleep timer from a phone or a script: { minutes } , { end: true } or { off: true }. */
  app.post("/api/tv/sleep", async (req: Req<Record<string, string>, Record<string, string>, { minutes?: number; end?: boolean; off?: boolean }>, reply) => {
    const b = req.body ?? {};
    const minutes = Number(b.minutes);
    const choice = b.off ? { off: true as const } : b.end ? { end: true as const } : Number.isFinite(minutes) && minutes > 0 && minutes <= 600 ? { minutes: Math.round(minutes) } : null;
    if (!choice) return reply.code(400).send({ error: "Say how many minutes, end, or off" });
    ctx.events.emit({ type: "sleep", choice });
    return { ok: true, tvConnected: tvSockets > 0 };
  });
  await registerMove(app, {
    db: ctx.db,
    dataDir: config.dataDir,
    log,
    deviceAsking,
    pairingEnforced: pairing.enforced,
    travelFiles: () => ctx.mix.travelFiles(),
    mediaRoot: config.mediaRoot,
    restart: deps.restart ?? (() => setTimeout(() => process.exit(0), 500)),
  });
  /** A QR code for a web address the TV shows, such as Spotify's sign-in page. */
  app.get("/api/qr.svg", async (req: Req<Record<string, string>, { text?: string }>, reply) => {
    const text = String(req.query.text ?? "");
    if (!/^https:\/\/[^\s]{1,500}$/.test(text)) return reply.code(400).send({ error: "Only https addresses" });
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "public, max-age=600").send(svg);
  });
  // Logging the TV in to Deezer from the phone (see musiclogin.ts).
  const musicLogins = new MusicLogins();
  app.get("/music-login/", async (_req, reply) => reply.type("text/html").header("Cache-Control", "no-store").send(MUSIC_LOGIN_PAGE));
  app.get("/api/music/login/qr.svg", async (req, reply) => {
    const svg = await QRCode.toString(withPairCode(req, `${phoneBase(req)}/music-login/`), { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "no-store").send(svg);
  });
  app.post("/api/music/login", async (req: Req<Record<string, string>, Record<string, string>, { app?: string; email?: string; password?: string }>, reply) => {
    const email = String(req.body?.email ?? "").trim().slice(0, 200);
    const password = String(req.body?.password ?? "").slice(0, 200);
    if (req.body?.app !== "deezer" || !email || !password) return reply.code(400).send({ error: "Enter your email and password" });
    if (tvSockets === 0) return reply.code(409).send({ error: "The TV app isn't connected to the Hub. Is the box on?" });
    const id = musicLogins.add({ email, password });
    ctx.events.emit({ type: "music.login", app: "deezer", id });
    return { ok: true, id };
  });
  // The TV says how the login went; the phone page asks (the id is the phone's own, unguessable).
  app.post("/api/music/login/:id/result", async (req: Req<{ id: string }, Record<string, string>, { result?: string; message?: string }>, reply) => {
    const result = String(req.body?.result ?? "") as WebAppLoginResult;
    if (!["signed-in", "rejected", "check", "submitted", "partial", "no-form"].includes(result)) return reply.code(400).send({ error: "Unknown result" });
    const ok = musicLogins.report(req.params.id, { result, ...(req.body?.message ? { message: String(req.body.message) } : {}) });
    return ok ? { ok: true } : reply.code(404).send({ error: "No such login" });
  });
  app.get("/api/music/login/:id/status", async (req: Req<{ id: string }>, reply) => reply.header("Cache-Control", "no-store").send(musicLogins.status(req.params.id)));
  app.get("/api/music/login/:id", async (req: Req<{ id: string }>, reply) => {
    const login = musicLogins.take(req.params.id);
    return login ? reply.header("Cache-Control", "no-store").send(login) : reply.code(404).send({ error: "That login has gone; send it again" });
  });
  app.get("/api/remote/qr.svg", async (req, reply) => {
    const svg = await QRCode.toString(withPairCode(req, `${phoneBase(req)}/remote/`), { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "no-store").send(svg);
  });

  // -------------------------------------------------------------------------
  // Pairing phones and screens (see pairing.ts)

  /** Whether the asking browser or app is paired. Anyone may ask. */
  app.get("/api/pair", async (req) => {
    const device = deviceAsking(req);
    return { paired: Boolean(device) || !pairing.enforced, enforced: pairing.enforced, device: device ?? null };
  });
  /** A phone sends the code from the TV (typed, or from the QR code's address) and its name. */
  app.post("/api/pair", async (req: Req<Record<string, string>, Record<string, string>, { code?: string; name?: string }>, reply) => {
    const { token, device } = pairing.pair(req.body?.code, req.body?.name, req.ip);
    log.info({ device: device.name, ip: req.ip }, "Phone paired");
    return keepToken(reply, token).send({ token, device });
  });
  /** A screen running the TV app asks to join: let in at once if it's the first, otherwise it waits. */
  app.post("/api/pair/screen", async (req: Req<Record<string, string>, Record<string, string>, { name?: string }>, reply) => {
    const already = deviceAsking(req);
    if (already?.kind === "tv") return { device: already };
    const r = pairing.requestScreen(req.body?.name, req.ip);
    if ("pending" in r) return reply.code(202).send(r);
    log.info({ device: r.device.name, ip: req.ip }, "Screen paired");
    return keepToken(reply, r.token).send(r);
  });
  app.post("/api/pair/screen/:id", async (req: Req<{ id: string }, Record<string, string>, { secret?: string }>, reply) => {
    const r = pairing.collect(req.params.id, req.body?.secret);
    if (r === "waiting") return reply.code(202).send({ waiting: true });
    if (r === "gone") return reply.code(404).send({ error: "That request was turned down or ran out. Ask again.", code: "pair" });
    return keepToken(reply, r.token).send(r);
  });
  /** The code the TV shows under its QR code. */
  app.get("/api/pair/code", async (req) => pairing.currentCode(phoneBase(req)));
  /** Unpairs the asking device. */
  app.post("/api/pair/forget", async (req, reply) => {
    const device = deviceAsking(req);
    if (device) pairing.revoke(device.id);
    return reply.header("Set-Cookie", `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`).send({ ok: true });
  });
  /** The key for Home Assistant and scripts: X-Api-Key or Authorization: Bearer. */
  app.get("/api/pair/api-key", async () => ({ key: pairing.apiKey() }));
  app.post("/api/pair/api-key", async () => ({ key: pairing.newApiKey() }));

  app.get("/api/devices", async (req): Promise<DeviceList> => ({ devices: pairing.devices(), pending: pairing.pendingScreens(), me: deviceAsking(req)?.id ?? null, enforced: pairing.enforced }));
  app.patch("/api/devices/:id", async (req: Req<{ id: string }, Record<string, string>, { name?: string }>, reply) => {
    const d = pairing.rename(req.params.id, req.body?.name);
    return d ?? reply.code(404).send({ error: "That device has been removed" });
  });
  app.delete("/api/devices/:id", async (req: Req<{ id: string }>, reply) => {
    if (!pairing.revoke(req.params.id)) return reply.code(404).send({ error: "That device has been removed" });
    for (const s of deviceSockets.get(req.params.id) ?? []) s.close(4401, "Unpaired");
    return { ok: true };
  });
  app.post("/api/devices/pending/:id", async (req: Req<{ id: string }>, reply) => {
    const d = pairing.approve(req.params.id);
    return d ?? reply.code(404).send({ error: "That screen stopped asking. Ask again from it." });
  });
  app.delete("/api/devices/pending/:id", async (req: Req<{ id: string }>) => ({ ok: pairing.deny(req.params.id) }));

  const remoteApp = new RemoteApp(config.dataDir);
  app.get("/api/remote/app.apk", async (_req, reply) => {
    const apk = await remoteApp.open();
    if (!apk) return reply.code(503).type("text/plain").send("The Hub couldn't get the app from GitHub. Try again in a minute.");
    return reply
      .type("application/vnd.android.package-archive")
      .header("Content-Length", apk.size)
      .header("Content-Disposition", 'attachment; filename="ultimatetv-remote.apk"')
      .send(apk.stream);
  });

  const clientApp = new RemoteApp(config.dataDir, fetch, { tag: "client-app", file: "ultimatetv.apk" });
  app.get("/api/client/app.apk", async (_req, reply) => {
    const apk = await clientApp.open();
    if (!apk) return reply.code(503).type("text/plain").send("The Hub couldn't get the app from GitHub. Try again in a minute.");
    return reply
      .type("application/vnd.android.package-archive")
      .header("Content-Length", apk.size)
      .header("Content-Disposition", 'attachment; filename="ultimatetv.apk"')
      .send(apk.stream);
  });

  // QR codes for the two Android apps' download links, for the TV's and the phone's settings.
  // Anyone may ask: they carry no pairing code, and the apps pair themselves once installed.
  app.get("/api/apps/:app/qr.svg", async (req: Req<{ app: string }>, reply) => {
    if (req.params.app !== "client" && req.params.app !== "remote") return reply.code(404).send({ error: "No such app" });
    const svg = await QRCode.toString(`${phoneBase(req)}/api/${req.params.app}/app.apk`, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    return reply.type("image/svg+xml").header("Cache-Control", "no-store").send(svg);
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
    if (cmd.kind === "sleep") ctx.events.emit({ type: "sleep", choice: cmd.minutes === "off" ? { off: true } : cmd.minutes === "end" ? { end: true } : { minutes: cmd.minutes } });
    if (cmd.kind === "save") {
      // The profile the TV is on when the phone doesn't say: the voice came from the room.
      const who = viewer(req);
      const found = (await library.search(cmd.name, Date.now(), who.filter).catch(() => [])).find((r) => r.kind === "title" && r.title);
      watchlist.add(who.profile?.id ?? null, { ...(found?.title ? { title: found.title } : { name: cmd.name }), from: "voice" });
    }
    if (cmd.kind !== "none" && said) ctx.events.emit({ type: "remote.said", text: cmd.say });
    return { ...cmd, heard: said, tvConnected: tvSockets > 0 };
  });

  // The phone asks the TV app (what's playing, play this, seek, music); the TV answers at /api/tv/reply/:id.
  const TV_METHODS = new Set<TvMethod>(["now", "play", "seek", "track", "tvApps", "musicLibrary", "musicTracks", "musicPlay", "musicControl", "downloads", "download", "downloadRemove", "musicStatus", "musicSetup", "saveToNas", "sleep", "cast", "castApp", "castAirplay"]);
  const tvCalls = new Map<string, { resolve: (v: { result?: unknown; error?: string }) => void; timer: NodeJS.Timeout }>();
  let tvCallSeq = 0;
  app.post("/api/tv/call/:method", async (req: Req<{ method: string }, Record<string, string>, unknown>, reply) => {
    const method = req.params.method as TvMethod;
    if (!TV_METHODS.has(method)) return reply.code(404).send({ error: "Unknown TV call" });
    if (tvSockets === 0) return reply.code(409).send({ error: "The TV app isn't connected. Is the box on?", code: "tv-off" });
    const id = `c${Date.now().toString(36)}${(tvCallSeq++).toString(36)}`;
    const answer = await new Promise<{ result?: unknown; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        tvCalls.delete(id);
        resolve({ error: "The TV didn't answer. Its app may need updating (Settings › Updates › Box)." });
      }, 12_000);
      tvCalls.set(id, { resolve, timer });
      ctx.events.emit({ type: "tv.call", id, method, args: req.body ?? null });
    });
    if (answer.error !== undefined) return reply.code(502).send({ error: answer.error });
    return answer.result ?? null;
  });
  app.post("/api/tv/reply/:id", async (req: Req<{ id: string }, Record<string, string>, { result?: unknown; error?: string }>) => {
    const call = tvCalls.get(req.params.id);
    if (call) {
      clearTimeout(call.timer);
      tvCalls.delete(req.params.id);
      call.resolve(req.body ?? {});
    }
    return { ok: true };
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
    const software = req.body?.software ?? null;
    // Most reports don't check GitHub (the TV starting, stats toggled): keep the last check's answer
    // rather than flip the phone to "Couldn't check". Older box apps don't remember it themselves.
    const before = boxState?.software;
    if (software && !software.latest && before?.latest && before.branch === software.branch) {
      software.latest = before.latest;
      if (before.checkedAt) software.checkedAt = before.checkedAt;
    }
    boxState = { software, stats: Boolean(req.body?.stats), reportedAt: new Date().toISOString() };
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

  app.patch("/api/channels/:id", async (req: Req<{ id: string }, Record<string, string>, { favourite?: boolean; hidden?: boolean; number?: number; swap?: boolean; category?: ChannelCategory | null }>, reply) => {
    try {
      const c = ctx.channels.update(req.params.id, req.body ?? {});
      if (!c) return reply.code(404).send({ error: "No such channel" });
      ctx.events.emit({ type: "guide.updated" });
      return c;
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 409).send({ error: (err as Error).message });
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
    for (const c of channels) if (c.mix && programmes[c.id]) programmes[c.id] = guideBlocks(programmes[c.id]!);
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

  /** The order of the lists above the guide (after All channels), for the phone settings page. */
  app.put("/api/guides/order", async (req: Req<Record<string, string>, Record<string, string>, { order?: string[] }>) => {
    const order = ctx.guides.setOrder(req.body?.order ?? []);
    ctx.events.emit({ type: "guide.updated" });
    return { order };
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
    // Music video channels are the Hub's own files: nothing to record.
    if (p && ctx.channels.get(p.channelId)?.mix) throw Object.assign(new Error("Music video channels can't be recorded. They're on the NAS already."), { statusCode: 422 });
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

  // The play queue: what plays after this, ahead of the next episode.
  registerQueue(app, ctx, filterOf);
  registerSubtitles(app, ctx, (id, f) => library.details(id, f), filterOf, hubBase);
  registerWatchlist(
    app,
    watchlist,
    (req) => {
      const who = viewer(req);
      return { profileId: who.profile?.id ?? null, filter: who.filter };
    },
    (q, f) => library.search(q, Date.now(), f),
  );

  // The TV asks for the next episode while the current one plays; the answer comes straight back.
  app.post("/api/play/prefetch", async (req: Req<Record<string, string>, Record<string, string>, PlaybackRequest>) => {
    void playback.prefetch(req.body, filterOf(req)).catch((err) => ctx.log.warn({ err: String(err) }, "Next episode lookup failed"));
    return { ok: true };
  });
  app.post("/api/play", async (req: Req<Record<string, string>, Record<string, string>, PlaybackRequest & { force?: boolean }>) => {
    const holder = deviceOf(req);
    return playback.resolve(req.body, hubBase(req), filterOf(req), holder ? { holder } : {});
  });
  /** What the Android client downloads for offline viewing: like /api/play, but never live TV. */
  app.post("/api/offline", async (req: Req<Record<string, string>, Record<string, string>, PlaybackRequest & { smaller?: boolean }>, reply) => {
    const { smaller, ...request } = req.body ?? ({} as PlaybackRequest);
    if (request.kind === "channel") return reply.code(422).send({ error: "Live TV can't be downloaded. Record it, then download the recording." });
    const holder = deviceOf(req);
    const info = await playback.resolve(request, hubBase(req), filterOf(req), { download: true, smaller: Boolean(smaller), ...(holder ? { holder } : {}) });
    if (info.live) return reply.code(422).send({ error: "This is still recording. Download it once it has finished." });
    return info;
  });

  /**
   * Which of the box's downloads a profile may see: titles by their certificate (saved with the
   * download, so this works with Jellyfin out of reach), recordings by their channel.
   */
  app.post("/api/offline/allowed", async (req: Req<Record<string, string>, Record<string, string>, { items?: { id: string; title?: TitleRef; channelId?: string }[] }>) => {
    const f = filterOf(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const allowed = items.filter((i) => {
      if (!f.kids) return true;
      if (i.channelId) {
        const c = ctx.channels.get(i.channelId);
        return Boolean(c && f.channel(c));
      }
      return i.title ? f.ref(i.title) : false;
    });
    return { allowed: allowed.map((i) => i.id) };
  });

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
  // Music video channels

  app.get("/api/mix-channels", async () => ctx.mix.overview());

  app.post("/api/mix-channels", async (req: Req<Record<string, string>, Record<string, string>, Partial<MixChannel>>, reply) => {
    const c = ctx.mix.create(req.body ?? {});
    ctx.events.emit({ type: "guide.updated" });
    return reply.code(201).send(ctx.mix.info(c));
  });

  app.get("/api/mix-channels/:id", async (req: Req<{ id: string }>, reply) => {
    const c = ctx.mix.store.channel(req.params.id);
    if (!c) return reply.code(404).send({ error: "That channel has been deleted" });
    return { channel: ctx.mix.info(c), videos: ctx.mix.store.entries(c.id).map((e) => ({ ...e, video: { ...e.video, path: undefined, thumbPath: undefined } })) };
  });

  app.patch("/api/mix-channels/:id", async (req: Req<{ id: string }, Record<string, string>, Partial<MixChannel>>) => {
    const c = ctx.mix.update(req.params.id, req.body ?? {});
    ctx.events.emit({ type: "guide.updated" });
    return ctx.mix.info(c);
  });

  app.delete("/api/mix-channels/:id", async (req: Req<{ id: string }>) => {
    await ctx.mix.remove(req.params.id);
    return { ok: true };
  });

  /** Look for more videos now (otherwise channels short of their target are looked at every few hours). */
  app.post("/api/mix-channels/:id/curate", async (req: Req<{ id: string }>, reply) => {
    ctx.mix.curateSoon(req.params.id);
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/mix-channels/:id/shuffle", async (req: Req<{ id: string }>) => {
    ctx.mix.reshuffle(req.params.id);
    ctx.events.emit({ type: "guide.updated" });
    return { ok: true };
  });

  /** Adds a video by link or id. `origin` says who chose it ("llm: …"), shown on the TV. */
  app.post("/api/mix-channels/:id/videos", async (req: Req<{ id: string }, Record<string, string>, { url?: string; id?: string; origin?: string }>, reply) =>
    reply.code(201).send(await ctx.mix.addVideo(req.params.id, req.body ?? {})),
  );

  /** Video files already on the NAS: `paths` are files, or folders whose videos all go on. */
  app.post("/api/mix-channels/:id/files", async (req: Req<{ id: string }, Record<string, string>, { paths?: string[]; path?: string }>) => {
    const b = req.body ?? {};
    const paths = Array.isArray(b.paths) ? b.paths.map(String) : b.path ? [String(b.path)] : [];
    return ctx.mix.addFiles(req.params.id, paths);
  });

  // -------------------------------------------------------------------------
  // Screensaver

  /** The themes, and how many photos the chosen folder has. */
  app.get("/api/screensaver", async () => {
    const dir = ctx.settings.get().screensaver.photosPath;
    const info: ScreensaverInfo = { themes: SCREENSAVER_THEMES };
    if (dir) {
      try {
        info.photoCount = (await ctx.photos.list(dir)).length;
      } catch (err) {
        info.photoError = err instanceof Error ? err.message : String(err);
      }
    }
    return info;
  });

  /** Folders on the NAS and the pictures in them, for choosing the photos folder. */
  app.get("/api/screensaver/nas", async (req: Req<Record<string, string>, { dir?: string }>) => ctx.photos.browse(req.query.dir || undefined));

  app.get("/api/screensaver/photos", async () => {
    const dir = ctx.settings.get().screensaver.photosPath;
    return { photos: dir ? await ctx.photos.list(dir) : [] };
  });

  app.get("/api/screensaver/photos/:id", async (req: Req<{ id: string }>, reply) => {
    const file = await ctx.photos.file(ctx.settings.get().screensaver.photosPath, req.params.id);
    if (!file) return reply.code(404).send({ error: "That photo has gone" });
    reply.header("Cache-Control", "private, max-age=3600");
    return sendFile(req, reply, file);
  });

  /** The NAS shares, or a folder in them, for picking video files for a music channel. */
  app.get("/api/mix/nas", async (req: Req<Record<string, string>, { dir?: string }>) => ctx.mix.browseNas(req.query.dir || undefined));

  app.delete("/api/mix-channels/:id/videos/:videoId", async (req: Req<{ id: string; videoId: string }>) => {
    await ctx.mix.removeVideo(req.params.id, req.params.videoId);
    ctx.events.emit({ type: "guide.updated" });
    return { ok: true };
  });

  /** YouTube search, each result judged against a channel's rules: for choosing videos by hand or by an LLM. */
  app.get("/api/mix/search", async (req: Req<Record<string, string>, { q?: string; channel?: string; limit?: string }>) => ({
    results: await ctx.mix.search(req.query.q ?? "", req.query.channel, Math.min(Math.max(Number(req.query.limit) || 10, 1), 30)),
  }));

  app.get("/api/mix-channels/:id/logo.svg", async (req: Req<{ id: string }>, reply) => {
    const c = ctx.mix.store.channel(req.params.id);
    if (!c) return reply.code(404).send({ error: "No such channel" });
    return reply.type("image/svg+xml").header("Cache-Control", "public, max-age=3600").send(mixLogo(c.name, c.colour));
  });

  app.get("/api/mix/videos/:id/file", async (req: Req<{ id: string }>, reply) => {
    const file = ctx.mix.filePath(req.params.id);
    if (!file) return reply.code(404).send({ error: "That video isn't on the NAS" });
    if (config.demo && file.startsWith("/clips/")) return reply.redirect(file);
    return sendFile(req, reply, file);
  });

  app.get("/api/mix/videos/:id/thumb.jpg", async (req: Req<{ id: string }>, reply) => {
    if (config.demo) return reply.type("image/svg+xml").header("Cache-Control", "public, max-age=86400").send(demoArt("still", req.params.id));
    const file = ctx.mix.thumbPath(req.params.id);
    if (!file) return reply.code(404).send({ error: "No picture for that video" });
    reply.header("Cache-Control", "public, max-age=86400");
    return sendFile(req, reply, file);
  });

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
    async (req: Req<{ id: string }, Record<string, string>, { name?: string; colour?: string; maxCertification?: Certification; channelCategories?: ChannelCategory[]; allowedChannels?: string[]; subtitles?: SubtitleMode; pin?: string | null }>, reply) => {
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

  app.get("/api/home", async (req) => {
    const who = viewer(req);
    const home = await library.home(Date.now(), who.filter);
    // The watchlist ("Save for later") goes after Continue watching, or first when there's none.
    const saved = watchlist.list(who.profile?.id ?? null).filter((i) => i.title && who.filter.ref(i.title)).map((i) => i.title!);
    if (saved.length) {
      const at = home.rails.findIndex((r) => r.id === "continue") + 1 || (home.rails[0]?.id === "live" ? 1 : 0);
      home.rails.splice(at, 0, { id: "watchlist", title: "Saved for later", kind: "titles", items: saved.slice(0, 30) });
    }
    return home;
  });
  app.get("/api/browse/:kind", async (req: Req<{ kind: "movie" | "series" }>) => ({ rails: await library.browse(req.params.kind === "series" ? "series" : "movie", filterOf(req)) }));
  app.get("/api/titles/:id", async (req: Req<{ id: string }>) => library.details(req.params.id, filterOf(req)));
  app.get("/api/titles/:id/extras", async (req: Req<{ id: string }>) => library.extras(req.params.id, filterOf(req)));
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

  // Downloads to the NAS (Save to NAS), then added to Jellyfin.
  app.get("/api/downloads", async () => ({ downloads: ctx.downloads.list() }));
  app.post("/api/downloads", async (req: Req<Record<string, string>, Record<string, string>, { titleId: string; episodeId?: string; streamId?: string }>, reply) => {
    const { titleId, episodeId, streamId } = req.body;
    const ep = episodeId ? episodeNumbers(episodeId) : undefined;
    const streams = await library.streams(titleId, ep);
    // The version asked for (the one playing, or picked in Versions), else the best one to save.
    const chosen = streamId ? streams.find((s) => s.id === streamId && s.downloadable) : undefined;
    const pick = chosen ?? streams.find((s) => s.downloadable && s.ready && s.kind !== "xtream") ?? streams.find((s) => s.downloadable);
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
  app.get("/api/events", { websocket: true }, (socket, req) => {
    // Only paired screens hear what the phones ask of the TV. A TV app from before pairing (the box,
    // just after the Hub updated) is told to reload, which brings in the app that pairs itself.
    if (pairing.enforced && deviceAsking(req)?.kind !== "tv") {
      socket.send(JSON.stringify({ type: "box.command", command: "reload" }));
      socket.close(4401, "Pair this screen first");
      return;
    }
    const off = ctx.events.on((e) => socket.send(JSON.stringify(e)));
    tvSockets++;
    // Kept by device, so unpairing a screen cuts it off at once.
    const id = deviceAsking(req)?.id;
    if (id) deviceSockets.set(id, new Set([...(deviceSockets.get(id) ?? []), socket]));
    socket.on("close", () => {
      off();
      tvSockets--;
      if (id) deviceSockets.get(id)?.delete(socket);
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

  // The colours of every theme, and today's one put on straight away, for the phone remote and the
  // web pages: each loads this in its <head>, so it never flashes the wrong colours first.
  // `utvTheme.apply(name)` puts on another, which is how the settings page previews one.
  app.get("/theme.js", async (_req, reply) => {
    const palettes = Object.fromEntries(THEMES.map((t) => [t.id, { ...t.palette, "color-scheme": t.light ? "light" : "dark" }]));
    const themes = THEMES.map(({ id, name, detail, season }) => ({ id, name, detail, season }));
    const now = resolveTheme(ctx.settings.get());
    const js = `(function () {
  var P = ${JSON.stringify(palettes)};
  function apply(name) {
    var p = P[name] || P["default"], root = document.documentElement;
    for (var k in p) if (k.charAt(0) === "-") root.style.setProperty(k, p[k]);
    root.style.colorScheme = p["color-scheme"];
    root.dataset.theme = P[name] ? name : "default";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = p["--bg"];
  }
  window.utvTheme = { themes: ${JSON.stringify(themes)}, palettes: P, now: ${JSON.stringify(now)}, apply: apply };
  apply(${JSON.stringify(now)});
})();
`;
    return reply.type("text/javascript").header("Cache-Control", "no-cache").send(js);
  });

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
  // A laptop's screen share page (open it over HTTPS: see cast.ts).
  if (config.castDir) await serveDir(config.castDir, "/cast/", "Screen share page missing.");
  if (config.remoteDir) {
    const remoteDir = config.remoteDir;
    // The install name follows the app's name, so a renamed app installs as "GazosTV Remote".
    app.get("/remote/manifest.webmanifest", async (_req, reply) => {
      const manifest = JSON.parse(readFileSync(path.join(remoteDir, "manifest.webmanifest"), "utf8")) as Record<string, unknown>;
      const name = ctx.settings.get().appName;
      manifest.name = `${name} Remote`;
      manifest.description = `Control ${name} on the TV from your phone.`;
      return reply.type("application/manifest+json").header("Cache-Control", "no-cache").send(manifest);
    });
    await serveDir(remoteDir, "/remote/", "Phone remote missing.");
  }

  // Test clips are served with range requests so players can seek.
  if (existsSync(config.clipsDir)) {
    await app.register(fastifyStatic, { root: config.clipsDir, prefix: "/clips/", decorateReply: false, acceptRanges: true, cacheControl: false });
  }

  app.decorate("hub", ctx);
  app.decorate("jobs", { alerts, adSkipper });
  app.addHook("onClose", async () => {
    alerts.stop();
    adSkipper.stop();
  });
  return app as unknown as FastifyInstance & { hub: HubContext; jobs: { alerts: Alerts; adSkipper: AdSkipper } };
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

// Wires the Hub's services together. Built once at start-up; clients that depend on settings
// (Jellyfin, TMDB, TorBox, addons) are rebuilt when settings change.

import path from "node:path";
import type { Settings } from "@ultimatetv/shared";
import { ChannelStore } from "./channels.js";
import { ConnectionGuard } from "./connections.js";
import type { CropDetect } from "./cropdetect.js";
import { Db } from "./db.js";
import { GuideStore } from "./epg.js";
import { EventBus } from "./events.js";
import type { Fetch } from "./http.js";
import { CustomGuideStore } from "./guides.js";
import { Ingestor } from "./ingest/index.js";
import type { Logger } from "./log.js";
import { MixManager } from "./mixchannels.js";
import { ProfileStore } from "./profiles.js";
import { ProgressStore } from "./progress.js";
import { PlayQueue } from "./queue.js";
import { Recorder, type Remux } from "./recorder.js";
import { RecordingStore } from "./recordings.js";
import { LiveRelay } from "./relay.js";
import { Scheduler } from "./scheduler.js";
import { DownloadManager } from "./services/downloads.js";
import { JellyfinClient, type JellyfinAuth } from "./services/jellyfin.js";
import { AddonClient } from "./services/stremio.js";
import { TmdbClient } from "./services/tmdb.js";
import { TorboxClient } from "./services/torbox.js";
import { defaultSettings, SettingsStore, settingsFromEnv } from "./settings.js";
import { StreamProxy } from "./streaming.js";
import { spawnRun, YtDlp, type Run } from "./ytdlp.js";

export interface ContextOptions {
  dataDir: string;
  dbFile?: string;
  mediaRoot?: string;
  env?: NodeJS.ProcessEnv;
  log: Logger;
  fetchImpl?: Fetch;
  remux?: Remux;
  /** Runs yt-dlp; tests pass a fake. Default: the YTDLP_PATH binary (yt-dlp on the PATH). */
  ytdlp?: Run | null;
  /** Pause between YouTube searches and downloads (tests: 0). */
  mixPauseMs?: number;
  /** Free space music video downloads leave on the NAS (tests: 0). */
  mixMinFreeBytes?: number;
  /** Finds black bars in downloaded music videos (tests pass a fake). */
  mixCropDetect?: CropDetect;
  demo?: boolean;
}

export class HubContext {
  readonly db: Db;
  readonly settings: SettingsStore;
  readonly events = new EventBus();
  readonly channels: ChannelStore;
  readonly guide: GuideStore;
  readonly guard: ConnectionGuard;
  readonly relay: LiveRelay;
  readonly recordings: RecordingStore;
  readonly recorder: Recorder;
  readonly scheduler: Scheduler;
  readonly ingest: Ingestor;
  readonly progress: ProgressStore;
  readonly queue: PlayQueue;
  readonly profiles: ProfileStore;
  readonly guides: CustomGuideStore;
  readonly proxy: StreamProxy;
  readonly downloads: DownloadManager;
  readonly mix: MixManager;
  readonly log: Logger;
  readonly fetchImpl: Fetch;

  private jf: JellyfinClient | null = null;
  private tm: TmdbClient | null = null;
  private tb: TorboxClient | null = null;
  private addonClients: AddonClient[] = [];

  constructor(opts: ContextOptions) {
    this.log = opts.log;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.db = new Db(opts.dbFile ?? path.join(opts.dataDir, "hub.db"));
    const defaults = settingsFromEnv(opts.env ?? {}, defaultSettings(opts.mediaRoot));
    this.settings = new SettingsStore(this.db, defaults);
    // Environment variables fill in anything the saved settings don't have yet.
    const seeded = settingsFromEnv(opts.env ?? {}, this.settings.get());
    if (JSON.stringify(seeded) !== JSON.stringify(this.settings.get())) this.settings.update(seeded);

    this.channels = new ChannelStore(this.db);
    this.guide = new GuideStore(this.db);
    this.guard = new ConnectionGuard(() => this.settings.connectionLimit());
    this.relay = new LiveRelay(this.channels, this.guard, this.log, this.fetchImpl);
    this.recordings = new RecordingStore(this.db);
    this.progress = new ProgressStore(this.db);
    this.queue = new PlayQueue(this.db, this.events);
    this.profiles = new ProfileStore(this.db);
    this.guides = new CustomGuideStore(this.db);
    this.proxy = new StreamProxy(this.guard, this.fetchImpl);
    this.ingest = new Ingestor(this.db, this.settings, this.channels, this.guide, this.log, this.fetchImpl);
    const settingsStore = this.settings;
    const onLibraryChanged = (paths: string[]) => {
      const jf = this.jellyfin();
      if (jf) void jf.mediaUpdated(paths).catch((err) => this.log.warn({ err: String(err) }, "Jellyfin refresh failed"));
    };
    this.recorder = new Recorder({
      store: this.recordings,
      channels: this.channels,
      relay: this.relay,
      guard: this.guard,
      settings: this.settings,
      events: this.events,
      log: this.log,
      tmpDir: path.join(opts.dataDir, "recording-tmp"),
      catchup: {
        get settings() {
          return settingsStore.get();
        },
        timeZoneOf: (id) => this.ingest.sourceMeta(id)?.timeZone,
      },
      fetchImpl: this.fetchImpl,
      onLibraryChanged: (p) => onLibraryChanged([p]),
      ...(opts.remux ? { remux: opts.remux } : {}),
    });
    this.scheduler = new Scheduler({
      store: this.recordings,
      guide: this.guide,
      channels: this.channels,
      recorder: this.recorder,
      guard: this.guard,
      settings: this.settings,
      events: this.events,
      log: this.log,
    });
    this.downloads = new DownloadManager(this.db, this.settings, this.events, this.log, () => this.torbox(), onLibraryChanged, this.fetchImpl);
    const env = opts.env ?? {};
    const run = opts.ytdlp === undefined ? spawnRun(env.YTDLP_PATH || "yt-dlp") : opts.ytdlp;
    this.mix = new MixManager({
      db: this.db,
      channels: this.channels,
      guide: this.guide,
      settings: this.settings,
      events: this.events,
      log: this.log,
      ytdlp: run ? new YtDlp(run, (env.YTDLP_ARGS ?? "").split(/\s+/).filter(Boolean)) : null,
      ...(opts.demo ? { demo: true } : {}),
      ...(opts.mixPauseMs !== undefined ? { pauseMs: opts.mixPauseMs } : {}),
      ...(opts.mixMinFreeBytes !== undefined ? { minFreeBytes: opts.mixMinFreeBytes } : {}),
      ...(opts.mixCropDetect ? { cropDetect: opts.mixCropDetect } : {}),
    });
    this.settings.onChange((s) => this.rebuildClients(s));
    this.rebuildClients(this.settings.get());
  }

  private rebuildClients(s: Settings): void {
    this.jf = s.jellyfin ? new JellyfinClient(s.jellyfin, this.fetchImpl) : null;
    this.tm = s.tmdbApiKey ? new TmdbClient(s.tmdbApiKey, this.db, this.fetchImpl) : null;
    this.tb = s.torboxApiKey ? new TorboxClient(s.torboxApiKey, this.fetchImpl) : null;
    this.addonClients = s.addonUrls.map((u) => new AddonClient(u, this.fetchImpl));
  }

  jellyfin(): JellyfinClient | null {
    return this.jf;
  }

  tmdb(): TmdbClient | null {
    return this.tm;
  }

  torbox(): TorboxClient | null {
    return this.tb;
  }

  addons(): AddonClient[] {
    return this.addonClients;
  }

  saveJellyfin(auth: JellyfinAuth): void {
    this.settings.update({ jellyfin: auth });
  }

  close(): void {
    this.scheduler.stop();
    this.downloads.stop();
    this.mix.stop();
    this.relay.closeAll();
    this.db.close();
  }
}

// Wires the Hub's services together. Built once at start-up; clients that depend on settings
// (the media server, TMDB, TorBox, addons) are rebuilt when settings change.

import path from "node:path";
import { ArtGallery } from "./art.js";
import { PhotoFolder } from "./screensaver.js";
import type { Settings } from "@ultimatetv/shared";
import { ChannelStore } from "./channels.js";
import { ConnectionGuard } from "./connections.js";
import type { CropDetect } from "./cropdetect.js";
import type { VideoProbe } from "./nasvideos.js";
import { Db } from "./db.js";
import { GuideStore } from "./epg.js";
import { EventBus } from "./events.js";
import type { Fetch } from "./http.js";
import { CustomGuideStore } from "./guides.js";
import { Ingestor } from "./ingest/index.js";
import type { Logger } from "./log.js";
import { MixManager } from "./mixchannels.js";
import { NextAirings } from "./nextairing.js";
import { Radio } from "./radio.js";
import { PerfStore } from "./perf.js";
import { SelfTestStore } from "./selftest.js";
import { Podcasts } from "./podcasts.js";
import { ProfileStore } from "./profiles.js";
import { ContinueHidden } from "./continuehide.js";
import { HomeRows } from "./homerows.js";
import { KidsAsks } from "./kidsasks.js";
import { KidsAllow } from "./kidsallow.js";
import { KidsViewing } from "./kidsviewing.js";
import { KidsLockoutLog } from "./kidslockouts.js";
import { drainQueue, JellyfinProgressQueue, type DrainResult } from "./jfprogress.js";
import { ProgressStore } from "./progress.js";
import { PlayQueue } from "./queue.js";
import { Recorder, type Remux } from "./recorder.js";
import { RecordingStore } from "./recordings.js";
import { LiveRelay } from "./relay.js";
import { Scheduler } from "./scheduler.js";
import { DownloadManager } from "./services/downloads.js";
import { CombinedMedia } from "./services/combined.js";
import { EmbyClient, type EmbyAuth } from "./services/emby.js";
import { JellyfinClient, type JellyfinAuth } from "./services/jellyfin.js";
import type { MediaServer } from "./services/media.js";
import { PlexClient, type PlexAuth } from "./services/plex.js";
import { AddonClient } from "./services/stremio.js";
import { TmdbClient } from "./services/tmdb.js";
import { OmdbClient } from "./services/omdb.js";
import { OpenSubtitlesClient } from "./services/opensubtitles.js";
import { TorboxClient } from "./services/torbox.js";
import { defaultSettings, SettingsStore, settingsFromEnv } from "./settings.js";
import { addonKey, pausedKeys } from "./sourceoptions.js";
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
  /** Reads music video files linked from the NAS (tests pass a fake). */
  mixProbe?: VideoProbe;
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
  readonly continueHidden: ContinueHidden;
  /** Which Home rows each profile shows, and in what order (#99). */
  readonly homeRows: HomeRows;
  /** A parent's allow/block list per Kids profile (issue #110). */
  readonly kidsAllow: KidsAllow;
  /** What each Kids profile played, day by day, for the weekly summary (issue #110). */
  readonly kidsViewing: KidsViewing;
  /** Requests from Kids and Guest profiles for something a parent hasn't allowed (issue #224). */
  readonly kidsAsks: KidsAsks;
  /** PIN lockouts, kept for the weekly summary (issue #110). */
  readonly kidsLockouts: KidsLockoutLog;
  /** Jellyfin places saved while Jellyfin could not be reached (#80). */
  readonly jellyfinProgress: JellyfinProgressQueue;
  /** When a saved title is next on TV, matched against the guide (#74). */
  readonly nextAirings: NextAirings;
  /** The radio stations the household can start (#86). */
  readonly radio: Radio;
  /** The podcast shows it follows, and where it got to (#86). */
  readonly podcasts: Podcasts;
  /** The last finished on-box self-test, for the phone and /api/diagnostics (#105). */
  readonly perf: PerfStore;
  readonly selfTest: SelfTestStore;
  readonly queue: PlayQueue;
  readonly profiles: ProfileStore;
  readonly guides: CustomGuideStore;
  readonly proxy: StreamProxy;
  readonly downloads: DownloadManager;
  readonly mix: MixManager;
  readonly photos: PhotoFolder;
  readonly art: ArtGallery;
  readonly log: Logger;
  readonly fetchImpl: Fetch;

  /** The media servers this Hub is connected to (any of Jellyfin, Plex and Emby), as one. */
  private ms: MediaServer | null = null;
  private servers: MediaServer[] = [];
  private jf: JellyfinClient | null = null;
  private tm: TmdbClient | null = null;
  private om: OmdbClient | null = null;
  private os: OpenSubtitlesClient | null = null;
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
    this.continueHidden = new ContinueHidden(this.db, this.events);
    this.homeRows = new HomeRows(this.db, this.events);
    this.kidsAllow = new KidsAllow(this.db, this.events);
    this.kidsViewing = new KidsViewing(this.db);
    this.kidsAsks = new KidsAsks(this.db, this.events, this.kidsAllow);
    this.kidsLockouts = new KidsLockoutLog(this.db);
    this.jellyfinProgress = new JellyfinProgressQueue(this.db);
    this.nextAirings = new NextAirings(this.guide, this.channels);
    this.radio = new Radio(this.db, this.fetchImpl);
    this.podcasts = new Podcasts(this.db, this.fetchImpl);
    this.perf = new PerfStore(this.db);
    this.selfTest = new SelfTestStore(this.db);
    this.queue = new PlayQueue(this.db, this.events);
    this.profiles = new ProfileStore(this.db);
    this.guides = new CustomGuideStore(this.db);
    this.proxy = new StreamProxy(this.guard, this.fetchImpl);
    this.ingest = new Ingestor(this.db, this.settings, this.channels, this.guide, this.log, this.fetchImpl);
    const settingsStore = this.settings;
    const onLibraryChanged = async (paths: string[]) => {
      const media = this.media();
      if (!media) return { added: false, note: "Connect Jellyfin, Plex or Emby in Settings to have saves added there too." };
      return media.mediaUpdated(paths).catch((err) => {
        this.log.warn({ err: String(err), server: media.name }, "Library refresh failed");
        return { added: false, note: `Didn't answer (${String(err)}), so it'll appear after ${media.name}'s next scan.` };
      });
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
      onLibraryChanged: (p) => void onLibraryChanged([p]),
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
      queue: this.queue,
      // A prune deletes files, so tell the media server to rescan once the batch is gone (#98).
      refreshLibrary: () => void this.media()?.refreshLibrary().catch((err) => this.log.warn({ err: String(err) }, "Library refresh failed")),
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
      ...(opts.mixProbe ? { probe: opts.mixProbe } : {}),
      mediaRoot: opts.mediaRoot ?? "/mnt/nas",
    });
    this.photos = new PhotoFolder(opts.mediaRoot ?? "/mnt/nas");
    this.art = new ArtGallery({ dir: path.join(opts.dataDir, "art"), fetchImpl: this.fetchImpl, log: this.log, settings: () => this.settings.get().screensaver });
    this.settings.onChange((s) => this.rebuildClients(s));
    this.rebuildClients(this.settings.get());
  }

  private rebuildClients(s: Settings): void {
    // Any of Jellyfin, Plex and Emby, all at once (#217): one server is used as it is, more than one
    // are merged behind CombinedMedia. The order here is the order a title's copies are tried in.
    // A paused provider (Source options, #219) keeps its settings but has no client, so the
    // library, Versions and Play never reach it.
    const paused = new Set(pausedKeys(s));
    this.jf = s.jellyfin && !paused.has("jellyfin") ? new JellyfinClient(s.jellyfin, this.fetchImpl) : null;
    const list: (MediaServer | null)[] = [this.jf, s.plex && !paused.has("plex") ? new PlexClient(s.plex, this.fetchImpl) : null, s.emby && !paused.has("emby") ? new EmbyClient(s.emby, this.fetchImpl) : null];
    this.servers = list.filter((x): x is MediaServer => x !== null);
    this.ms = this.servers.length > 1 ? new CombinedMedia(this.servers) : (this.servers[0] ?? null);
    this.tm = s.tmdbApiKey ? new TmdbClient(s.tmdbApiKey, this.db, this.fetchImpl) : null;
    this.om = s.omdbApiKey ? new OmdbClient(s.omdbApiKey, this.db, this.fetchImpl) : null;
    this.os = s.openSubtitles?.apiKey ? new OpenSubtitlesClient(s.openSubtitles, this.db, this.fetchImpl, this.log) : null;
    this.tb = s.torboxApiKey && !paused.has("torbox") ? new TorboxClient(s.torboxApiKey, this.fetchImpl) : null;
    this.addonClients = s.addonUrls.filter((u) => !paused.has(addonKey(u))).map((u) => new AddonClient(u, this.fetchImpl));
    // Jellyfin is reachable again (it was just set up, or the Hub is home from a trip): send what was
    // watched while it wasn't (#80). Nothing to send is the usual case, so this costs nothing.
    if (this.jf && this.jellyfinProgress.size()) void this.flushJellyfinProgress().catch((err) => this.log.warn({ err: String(err) }, "Couldn't send Jellyfin its places"));
  }

  /** The media server the library is read from, whichever it is; null when none is set up. */
  media(): MediaServer | null {
    return this.ms;
  }

  /** Each connected media server on its own, in the order their copies of a title are listed. */
  mediaServers(): MediaServer[] {
    return this.servers;
  }

  /**
   * The Jellyfin client, when Jellyfin is connected. Kept apart from media() because the
   * offline progress queue (#80) is Jellyfin's own: only Jellyfin can be sent a place it missed.
   */
  jellyfin(): JellyfinClient | null {
    return this.jf;
  }

  /**
   * Sends Jellyfin the places saved while it couldn't be reached (#80). Called when the Hub starts
   * with Jellyfin configured, when Jellyfin is set up in Settings, and by the hourly tick. Jellyfin's
   * own place wins when it was played somewhere else more recently.
   */
  async flushJellyfinProgress(): Promise<DrainResult> {
    const jf = this.jf;
    if (!jf) return { sent: 0, skipped: 0, left: this.jellyfinProgress.size() };
    const out = await drainQueue({
      list: () => this.jellyfinProgress.list(),
      remove: (itemId) => this.jellyfinProgress.remove(itemId),
      send: async (place) => {
        await jf.reportProgress(place.itemId, place.positionMs, place.event, false);
        // A finished title is marked played, the same as the TV's "Mark as watched" does.
        if (place.played) await jf.markPlayed(place.itemId, true);
      },
      lookup: async (place) => {
        const item = await jf.item(place.itemId);
        const last = item.UserData?.LastPlayedDate ? Date.parse(item.UserData.LastPlayedDate) : 0;
        return { lastPlayedAt: Number.isFinite(last) ? last : 0, played: Boolean(item.UserData?.Played) };
      },
    });
    if (out.sent || out.skipped) {
      this.log.info(out, "Sent Jellyfin the places watched while it was away");
      this.events.emit({ type: "progress.changed" });
    }
    return out;
  }

  tmdb(): TmdbClient | null {
    return this.tm;
  }

  omdb(): OmdbClient | null {
    return this.om;
  }

  openSubtitles(): OpenSubtitlesClient | null {
    return this.os;
  }

  torbox(): TorboxClient | null {
    return this.tb;
  }

  addons(): AddonClient[] {
    return this.addonClients;
  }

  /** Connects Jellyfin, alongside any Plex or Emby server already connected. */
  saveJellyfin(auth: JellyfinAuth): void {
    this.settings.update({ jellyfin: auth });
  }

  /** Connects Plex, alongside any Jellyfin or Emby server already connected. */
  savePlex(auth: PlexAuth): void {
    this.settings.update({ plex: auth });
  }

  /** Connects Emby, alongside any Jellyfin or Plex server already connected. */
  saveEmby(auth: EmbyAuth): void {
    this.settings.update({ emby: auth });
  }

  close(): void {
    this.scheduler.dispose();
    this.downloads.stop();
    this.mix.stop();
    this.relay.closeAll();
    this.db.close();
  }
}

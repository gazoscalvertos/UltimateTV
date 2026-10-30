// Answers the phone remote: what's playing (for its Now Playing card and Stats page), and requests
// to play something, seek, pick a track, drive the music, download to the box or save to the NAS. The Hub relays each call as a
// "tv.call" event and waits for the answer posted back to /api/tv/reply/:id.

import type { GameAppId, PlaybackRequest, SleepChoice, SpotifyCommand, SpotifySetup, TitleRef, TvMethod, TvNow } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { backToTv, canCast, castSettings, castState, gamesAllowed, openGame, refreshCast, setAirplay, shareUrl } from "./cast";
import { api, hub } from "./api";
import { allEpisodes, canDownload, downloadToBox, episodeRequest, episodesOf, filmRequest, recordingRequest, removeFromBox, visibleDownloads } from "./downloads";
import { onHubEvent } from "./events";
import { music, spotify, spotifySetup, webApp } from "./music";
import { channels, liveChannelId, nowPlaying, play, playerState } from "./player";
import { saveEpisodes, saveToNas } from "./save";
import { sleep, setSleep } from "./sleep";
import { isKids, nav, profile } from "./store";
import { openTvApps } from "./tvapps";

/** What the phone's "On the TV box" list shows: no pictures (they're data: URLs on the box), just links to them. */
async function downloadsForPhone() {
  if (!canDownload()) throw new Error("The TV box needs updating before it can download (Settings › About on the TV)");
  const d = await agent.downloads();
  const visible = new Set(visibleDownloads().map((i) => i.id));
  return {
    ...d,
    items: d.items
      .filter((i) => !isKids() || visible.has(i.id))
      .sort((a, b) => b.addedAt - a.addedAt)
      .map(({ artwork: _artwork, ...i }) => i),
  };
}

/** A download asked for on the phone: a film, an episode, a season, a whole series or a recording. */
async function downloadFromPhone(a: { titleId?: string; episodeId?: string; season?: number; all?: boolean; recordingId?: string }) {
  if (a.recordingId) {
    const r = (await hub.planner()).recordings.find((x) => x.id === a.recordingId && x.status === "completed");
    if (!r) throw new Error("That recording isn't ready to download");
    await downloadToBox([recordingRequest(r)], r.programme.title);
  } else if (a.titleId) {
    // Through the Hub with the TV's profile, so a title Kids can't see can't be downloaded either.
    const t = await hub.title(a.titleId);
    if (t.kind === "movie") await downloadToBox([filmRequest(t)], t.name);
    else if (a.all) await downloadToBox((await allEpisodes(t)).map((e) => episodeRequest(t, e)), t.name);
    else if (a.season !== undefined) await downloadToBox((await episodesOf(t, a.season)).map((e) => episodeRequest(t, e)), `${t.name} series ${a.season}`);
    else {
      const m = /^s(\d+)e(\d+)$/.exec(a.episodeId ?? "");
      const e = m ? (await episodesOf(t, Number(m[1]))).find((x) => x.episode === Number(m[2])) : undefined;
      if (!e) throw new Error("Couldn't find that episode");
      await downloadToBox([episodeRequest(t, e)], `${t.name} ${a.episodeId!.toUpperCase()}`);
    }
  } else {
    throw new Error("Nothing to download");
  }
  return downloadsForPhone();
}

/**
 * Save to NAS asked for on the phone: what's playing (this exact copy), a film, an episode or a
 * series. Through the TV, so its profile decides (Kids can't, adults may need the PIN).
 */
async function saveFromPhone(a: { playing?: boolean; titleId?: string; episodeId?: string; season?: number }) {
  if (a.playing) {
    const np = nowPlaying();
    if (!np || np.req.kind !== "title" || !np.info.savable) throw new Error("What's playing can't be saved to the NAS");
    const req = { titleId: np.req.id, ...(np.req.episodeId ? { episodeId: np.req.episodeId } : {}), ...(np.info.streamId ? { streamId: np.info.streamId } : {}) };
    await saveToNas(req, [np.title?.name ?? np.info.title, np.info.subtitle].filter(Boolean).join(" "));
  } else if (a.titleId) {
    const t = await hub.title(a.titleId);
    if (t.kind === "series" && a.season !== undefined) await saveEpisodes(t, await episodesOf(t, a.season), `${t.name} series ${a.season}`);
    else await saveToNas({ titleId: t.id, ...(a.episodeId ? { episodeId: a.episodeId } : {}) }, a.episodeId ? `${t.name} ${a.episodeId.toUpperCase()}` : t.name);
  } else {
    throw new Error("Nothing to save");
  }
  return { ok: true };
}

async function now(): Promise<TvNow> {
  const np = nowPlaying();
  const p = profile();
  const [stats, info] = await Promise.all([np ? agent.stats().catch(() => null) : null, agent.info().catch(() => null)]);
  const s = spotify();
  const w = webApp();
  let playing: TvNow["playing"] = null;
  if (np) {
    playing = { kind: np.req.kind, id: np.req.id, title: np.title?.name ?? np.info.title, live: np.info.live };
    if (np.info.subtitle) playing.subtitle = np.info.subtitle;
    else if (np.title && np.info.title !== np.title.name) playing.subtitle = np.info.title;
    const art = np.info.artwork ?? np.title?.backdrop ?? np.title?.poster ?? np.info.logo;
    if (art) playing.artwork = art;
    if (np.info.source) playing.source = np.info.source.label;
    if (np.info.savable && np.req.kind === "title" && !np.downloadId && !isKids()) playing.savable = true;
    const c = np.req.kind === "channel" ? channels().find((x) => x.id === (liveChannelId() ?? np.req.id)) : undefined;
    if (c) playing.channel = { id: c.id, number: c.number, name: c.name };
  }
  return {
    at: new Date().toISOString(),
    profile: p ? { id: p.id, name: p.name, kind: p.kind } : null,
    screen: nav.current().name,
    playing,
    player: playerState(),
    stats,
    info,
    spotify: s.available && (s.status !== "stopped" || s.track) ? s : null,
    webApp: w.app ? w : null,
    ...(sleep().at ? { sleep: sleep() } : {}),
  };
}

/** The phone's Cast sheet: AirPlay, the laptop page, the games and who may use them. */
async function castForPhone() {
  await refreshCast();
  return { box: canCast(), state: castState(), settings: castSettings(), shareUrl: shareUrl(), kids: isKids(), gamesAllowed: gamesAllowed() };
}

const handlers: Record<TvMethod, (args: never) => Promise<unknown>> = {
  now,
  play: async (a: { req: PlaybackRequest; title?: TitleRef; fromStart?: boolean }) => {
    const ok = await play(a.req, { ...(a.title ? { title: a.title } : {}), ...(a.fromStart ? { fromStart: true } : {}) });
    if (!ok) throw new Error("It didn't start on the TV");
    return { ok };
  },
  seek: async (a: { ms: number; mode: "absolute" | "relative" | "live" }) => {
    if (a.mode === "live") await agent.goLive();
    else await agent.seek(a.ms, a.mode === "absolute" ? "absolute" : "relative");
    return { ok: true };
  },
  track: async (a: { audio?: number; subtitle?: number | null }) => {
    if (typeof a.audio === "number") await agent.setAudioTrack(a.audio);
    if (a.subtitle !== undefined) await agent.setSubtitleTrack(a.subtitle);
    return { ok: true };
  },
  // The phone's Cast sheet: over to the TV's own apps (Netflix and the rest).
  tvApps: async () => ({ ok: await openTvApps(false) }),
  musicLibrary: async (a: { kind: "playlists" | "albums" | "artists"; offset?: number }) => music().spotifyLibrary(a.kind, a.offset ?? 0),
  musicTracks: async (a: { uri: string }) => music().spotifyTracks(a.uri),
  musicPlay: async (a: { uri: string; skipTo?: string; shuffle?: boolean }) => {
    const opts: { skipTo?: string; shuffle?: boolean } = {};
    if (a.skipTo) opts.skipTo = a.skipTo;
    if (a.shuffle) opts.shuffle = true;
    await music().spotifyPlay(a.uri, opts);
    return { ok: true };
  },
  musicControl: async (a: SpotifyCommand) => {
    await music().spotifyControl(a);
    return { ok: true };
  },
  // The phone's Music page: is Spotify signed in (and how to), is Deezer.
  musicStatus: async () => ({ spotify: spotify(), deezer: { signedIn: webApp().signedIn ?? null }, setup: music() !== agent || agentHas("spotifySetup") }),
  musicSetup: async (a: SpotifySetup) => {
    await spotifySetup(a);
    return { spotify: spotify() };
  },
  downloads: async () => downloadsForPhone(),
  download: async (a: Parameters<typeof downloadFromPhone>[0]) => downloadFromPhone(a),
  saveToNas: async (a: Parameters<typeof saveFromPhone>[0]) => saveFromPhone(a),
  downloadRemove: async (a: { id: string }) => {
    if (isKids()) throw new Error("Ask a grown-up to delete downloads");
    await removeFromBox(a.id);
    return downloadsForPhone();
  },
  sleep: async (a: Partial<SleepChoice>) => ("minutes" in a || "end" in a || "off" in a ? setSleep(a as SleepChoice) : sleep()),
  cast: async () => castForPhone(),
  castApp: async (a: { id?: GameAppId; stop?: boolean }) => {
    if (!canCast()) throw new Error("Games open on the TV box");
    if (a.stop) await backToTv();
    else if (a.id) await openGame(a.id);
    return castForPhone();
  },
  castAirplay: async (a: { on: boolean }) => {
    if (!canCast()) throw new Error("AirPlay runs on the TV box");
    if (isKids()) throw new Error("Ask a grown-up to change AirPlay");
    await setAirplay(Boolean(a.on));
    return castForPhone();
  },
};

export function startPhoneBridge(): void {
  onHubEvent((e) => {
    if (e.type !== "tv.call") return;
    const handler = handlers[e.method] as ((args: unknown) => Promise<unknown>) | undefined;
    if (!handler) return;
    void (async () => {
      // A TV app open in a browser (development) answers too; let the box's answer win.
      if (!onBox) await new Promise((r) => setTimeout(r, 400));
      const body = await handler(e.args ?? {}).then(
        (result) => ({ result }),
        (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
      );
      await api(`/api/tv/reply/${encodeURIComponent(e.id)}`, { method: "POST", body }).catch(() => undefined);
    })();
  });
}

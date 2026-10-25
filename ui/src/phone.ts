// Answers the phone remote: what's playing (for its Now Playing card and Stats page), and requests
// to play something, seek, pick a track or drive the music. The Hub relays each call as a
// "tv.call" event and waits for the answer posted back to /api/tv/reply/:id.

import type { PlaybackRequest, SpotifyCommand, TitleRef, TvMethod, TvNow } from "@ultimatetv/shared";
import { agent, onBox } from "./agent";
import { api } from "./api";
import { onHubEvent } from "./events";
import { music, spotify, webApp } from "./music";
import { channels, liveChannelId, nowPlaying, play, playerState } from "./player";
import { nav, profile } from "./store";

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
  };
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

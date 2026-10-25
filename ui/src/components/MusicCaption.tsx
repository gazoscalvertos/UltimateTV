// The music channel caption: the lower third music TV shows over each video. The artist and song
// slide in as a video starts (and on tuning in), and "Next" takes over for the last five seconds.

import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { NowNext } from "@ultimatetv/shared";
import { playerState } from "../player";

/** How long the caption stays up as each video starts. */
const NOW_FROM = 1500;
const NOW_UNTIL = 11_000;
/** The caption shows what's next for the last few seconds of each video. */
const NEXT_FOR = 5000;

/** "Artist – Song" (or "Artist - Song") into its two halves. */
export function splitTitle(title: string): { artist: string; song: string } {
  const m = /^(.+?)\s+[–-]\s+(.+)$/.exec(title);
  return m ? { artist: m[1]!.trim(), song: m[2]!.trim() } : { artist: "", song: title };
}

export type CaptionMode = { kind: "now" | "next"; title: string } | null;

/**
 * What the caption shows. `elapsedMs`/`leftMs` are where the current video has got to, `fresh`
 * says the viewer has just tuned in (so the song is shown even part-way through).
 */
export function captionFor(now: string | undefined, next: string | undefined, elapsedMs: number, leftMs: number | undefined, fresh: boolean): CaptionMode {
  if (next && leftMs !== undefined && leftMs > 300 && leftMs <= NEXT_FOR) return { kind: "next", title: next };
  if (now && (fresh || (elapsedMs >= NOW_FROM && elapsedMs <= NOW_UNTIL))) return { kind: "now", title: now };
  return null;
}

export function MusicCaption(props: { titles: string[]; schedule: NowNext | undefined; logo?: string; channelName: string; tunedAt: number }) {
  const [clock, setClock] = createSignal(Date.now());
  const timer = setInterval(() => setClock(Date.now()), 250);
  onCleanup(() => clearInterval(timer));

  // Compared by what it shows, so the caption only animates in when that changes.
  const mode = createMemo((): CaptionMode => {
    const st = playerState();
    const t = clock();
    const fresh = t - props.tunedAt < 12_000;
    // On the box mpv says which video of the playlist is on and how far through it is.
    if (st.durationMs && (st.status === "playing" || st.status === "paused")) {
      const i = st.playlistPos ?? 0;
      return captionFor(props.titles[i], props.titles[i + 1], st.positionMs, st.durationMs - st.positionMs, fresh && i === 0);
    }
    // Otherwise (a browser) the channel's schedule is close enough.
    const s = props.schedule;
    if (!s?.now) return null;
    return captionFor(s.now.title, s.next?.title, t - s.now.start, s.now.end - t, fresh);
  }, null, { equals: (a, b) => a?.kind === b?.kind && a?.title === b?.title });

  return (
    <Show when={mode()} keyed>
      {(m) => {
        const { artist, song } = splitTitle(m.title);
        return (
          <div class="music-caption" classList={{ next: m.kind === "next" }}>
            <div class="music-caption-tag">
              <Show when={props.logo} fallback={<span>{props.channelName}</span>}>
                <img src={props.logo} alt="" />
              </Show>
            </div>
            <div class="music-caption-body">
              <span class="music-caption-label">{m.kind === "next" ? "Coming up next" : "Now playing"}</span>
              <span class="music-caption-artist">{artist || song}</span>
              <Show when={artist}>
                <span class="music-caption-song">{song}</span>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

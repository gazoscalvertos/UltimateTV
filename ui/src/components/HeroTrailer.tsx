// A muted trailer behind Home's hero, after a few seconds on it (#240, docs/hero-trailer.md). The
// still stays underneath the whole time, so any failure just leaves the still.
//
// Rules it keeps: off unless the profile switched it on; waits for the picture to be settled (the
// hero hasn't changed for a few seconds); loads the one trailer ahead while it waits; never runs
// while something is playing or the app is hidden; and gives up for the session if the box can't
// keep up (dropped frames), so a slow machine falls back to the still.

import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js";
import { hub } from "../api";
import { playerState, nowPlaying } from "../player";
import { profile } from "../store";
import { reportTrailerHealth, trailerGivenUp, trailerSrc } from "../trailerHealth";

/** How long the hero sits there before the trailer fades in. */
export const TRAILER_DELAY_MS = 4000;

export function HeroTrailer(props: { id: string }) {
  const wanted = () => Boolean(profile()?.heroTrailer) && !profile()?.accessibility?.reducedMotion && !trailerGivenUp();
  // Asked as soon as the hero shows, so the address is ready (and the first bytes buffering) by the time the delay is up.
  const [extras] = createResource(
    () => (wanted() ? props.id : null),
    (id) => hub.extras(id).catch(() => null),
  );
  const src = createMemo(() => {
    const t = extras()?.trailer;
    return t ? trailerSrc(t) : null;
  });
  const [due, setDue] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  const [hidden, setHidden] = createSignal(typeof document !== "undefined" && document.hidden);
  const busy = () => Boolean(nowPlaying()) || playerState().status === "playing" || playerState().status === "buffering" || playerState().status === "loading";

  createEffect(() => {
    props.id;
    setDue(false);
    setShown(false);
    const t = setTimeout(() => setDue(true), TRAILER_DELAY_MS);
    onCleanup(() => clearTimeout(t));
  });
  const onVisible = () => setHidden(document.hidden);
  document.addEventListener("visibilitychange", onVisible);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisible));

  let video: HTMLVideoElement | undefined;
  const go = () => due() && !busy() && !hidden() && wanted();
  createEffect(() => {
    const v = video;
    if (!v || !src()) return;
    if (!go()) {
      v.pause();
      setShown(false);
      return;
    }
    void Promise.resolve(v.play()).catch(() => undefined);
    // Check the box is keeping up after a few seconds of picture; if not, the still is all there'll be.
    const check = setTimeout(() => {
      const q = v.getVideoPlaybackQuality?.();
      if (q && q.totalVideoFrames > 30) reportTrailerHealth(q.droppedVideoFrames / q.totalVideoFrames);
    }, 6000);
    onCleanup(() => clearTimeout(check));
  });

  return (
    <Show when={wanted() && src()}>
      <video
        ref={video}
        class="hero-trailer"
        classList={{ shown: shown() && go() }}
        src={src()!}
        muted
        loop
        playsinline
        preload="auto"
        onPlaying={() => setShown(true)}
        onWaiting={() => setShown(false)}
        onError={() => setShown(false)}
      />
    </Show>
  );
}

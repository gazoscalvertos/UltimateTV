// Other screens on the TV, the app's side: AirPlay mirroring and games on the box (box/src/cast.ts),
// a laptop's screen shared from its browser (WebRTC, offer and answer through the Hub), and links
// sent from a phone. While one of them has the screen the TV app steps aside, and says welcome back
// when it ends. The Kids profile can't be cast to, and only opens games if a grown-up allows it.

import { createSignal } from "solid-js";
import type { CastSettings, CastState, GameAppId, ShareOffer } from "@ultimatetv/shared";
import { DEFAULT_CAST_SETTINGS, linkTitle } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { hub } from "./api";
import { choose } from "./components/Dialog";
import { onHubEvent } from "./events";
import { pauseAllMusic } from "./music";
import { nowPlaying, playerState, playLink } from "./player";
import { isKids, toast } from "./store";
import { featureOn } from "./features";

const NONE: CastState = { airplay: { installed: false, enabled: false, running: false, connected: false, name: "" }, apps: [], foreground: null };
const [castState, setCastState] = createSignal<CastState>(NONE);
const [castSettings, setCastSettings] = createSignal<CastSettings>(DEFAULT_CAST_SETTINGS);
const [shareUrl, setShareUrl] = createSignal<string | null>(null);
/** A laptop's screen showing on the TV. */
const [share, setShare] = createSignal<{ id: string; name: string; stream: MediaStream | null } | null>(null);
export { castState, castSettings, shareUrl, share };

export const canCast = () => agentHas("cast");

export async function refreshCast(): Promise<void> {
  if (canCast()) setCastState(await agent.cast().catch(() => NONE));
  const s = await hub.castSettings().catch(() => null);
  if (s) {
    setCastSettings(s.settings);
    setShareUrl(s.shareUrl);
  }
}

export async function saveCastSettings(patch: Partial<CastSettings>): Promise<void> {
  const s = await hub.saveCastSettings(patch);
  setCastSettings(s.settings);
  setShareUrl(s.shareUrl);
}

export async function setAirplay(on: boolean): Promise<CastState> {
  const s = await agent.castSettings({ airplay: on });
  setCastState(s);
  return s;
}

/** Pauses what's playing so a game or another screen can have the sound. */
async function stepAside(): Promise<void> {
  if (nowPlaying() && playerState().status === "playing") await agent.pause(true).catch(() => undefined);
  await pauseAllMusic();
}

export const gamesAllowed = () => !isKids() || castSettings().gamesForKids;

export async function openGame(id: GameAppId): Promise<CastState> {
  if (!gamesAllowed()) throw new Error("Ask a grown-up to turn on games for Kids (Settings › Cast and games)");
  await stepAside();
  const s = await agent.launchApp(id);
  setCastState(s);
  return s;
}

/** Closes the game, or ends the mirroring, and comes back to the TV app. */
export async function backToTv(): Promise<CastState> {
  const s = await agent.stopApp();
  setCastState(s);
  return s;
}

// ---- A laptop's screen, over WebRTC ----

let peer: RTCPeerConnection | null = null;

/** Waits for every ICE candidate: the Hub passes one answer, with no trickle. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    // On a home network the host candidates come within a second; don't hang on a slow STUN-less gather.
    setTimeout(resolve, 3000);
  });
}

async function acceptShare(offer: ShareOffer): Promise<void> {
  endShare(false);
  const pc = new RTCPeerConnection({ iceServers: [] });
  peer = pc;
  setShare({ id: offer.id, name: offer.name, stream: null });
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    setShare((s) => (s && s.id === offer.id ? { ...s, stream } : s));
  };
  pc.onconnectionstatechange = () => {
    if (peer !== pc) return;
    if (pc.connectionState === "failed") {
      toast("The screen share dropped. Try sharing again from the laptop.", "bad");
      endShare(true);
    } else if (pc.connectionState === "closed" || pc.connectionState === "disconnected") {
      // "disconnected" can recover on its own; give it a few seconds.
      setTimeout(() => peer === pc && pc.connectionState !== "connected" && endShare(true), pc.connectionState === "closed" ? 0 : 5000);
    }
  };
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await hub.answerShare(offer.id, pc.localDescription!.sdp);
    await stepAside();
  } catch (err) {
    toast(`Couldn't show that screen: ${err instanceof Error ? err.message : String(err)}`, "bad");
    endShare(true);
  }
}

/** Stops showing the laptop's screen (and tells the laptop, unless it's the one that stopped). */
export function endShare(tell = true): void {
  const s = share();
  peer?.close();
  peer = null;
  setShare(null);
  if (s && tell) void hub.endShare(s.id).catch(() => undefined);
}

async function offered(offer: ShareOffer): Promise<void> {
  if (isKids()) return void hub.refuseShare(offer.id, "The TV is on the Kids profile").catch(() => undefined);
  if (!castSettings().screenShare) return void hub.refuseShare(offer.id, "Screen sharing is turned off on the TV").catch(() => undefined);
  if (castState().foreground) return void hub.refuseShare(offer.id, "The TV is showing something else (a game or AirPlay)").catch(() => undefined);
  const pick = await choose({
    title: `Show the screen from ${offer.name}?`,
    message: `${offer.name} wants to show its ${offer.surface === "browser" ? "browser tab" : offer.surface === "window" ? "window" : "screen"} on the TV. Back stops it at any time.`,
    options: [
      { label: "Show it", value: "yes", icon: "laptop" },
      { label: "Not now", value: "no" },
    ],
  });
  if (pick === "yes") await acceptShare(offer);
  else void hub.refuseShare(offer.id, "Not now, said the TV").catch(() => undefined);
}

// ---- Starting up ----

export function startCast(): void {
  void refreshCast();
  if (canCast()) {
    agent.onCast((s) => {
      const was = castState().foreground;
      setCastState(s);
      const fg = s.foreground;
      document.documentElement.classList.toggle("mirroring", fg?.kind === "airplay");
      if (fg && !was) {
        if (fg.kind === "airplay" && !featureOn("cast")) {
          void backToTv();
          toast("Casting is switched off on this screen", "bad");
          return;
        }
        if (fg.kind === "airplay" && isKids()) {
          // Nobody casts onto the Kids profile.
          void backToTv();
          toast("Casting isn't allowed on the Kids profile", "bad");
          return;
        }
        void stepAside();
        if (fg.kind === "airplay") toast(`Showing a screen over AirPlay. Press Back to stop.`);
      }
      if (!fg && was) toast(was.kind === "app" ? `Welcome back from ${was.name}` : "AirPlay ended", "good");
    });
  }
  onHubEvent((e) => {
    if (e.type === "hello" || e.type === "settings.changed") void refreshCast();
    if (e.type === "cast.share") {
      if (featureOn("cast")) void offered(e.offer);
      else void hub.refuseShare(e.offer.id, "Casting is switched off on the TV").catch(() => undefined);
    }
    if (e.type === "cast.share.end" && share()?.id === e.id) {
      endShare(false);
      toast("The laptop stopped sharing", "good");
    }
    if (e.type === "cast.link") {
      if (!featureOn("cast")) return;
      if (isKids()) return toast("Links can't be sent to the Kids profile", "bad");
      if (castState().foreground || share()) return toast("A link came in while something else is on the screen", "bad");
      const title = e.link.title || linkTitle(e.link.url);
      toast(`Playing ${title}${e.link.from ? ` from ${e.link.from}` : ""}`);
      void playLink(e.link.url, title);
    }
  });
}
